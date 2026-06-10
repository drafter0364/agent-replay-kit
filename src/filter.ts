import { ensureParentDir, readTraceFile, readTraceFileStream, writeTraceFile } from "./io.js";
import { collectToolInteractions } from "./replay.js";
import type { JsonValue, RecordedToolInteraction, TraceEvent } from "./types.js";
import { isRecord, stableStringify } from "./utils.js";

export interface TraceFilterOptions {
  tools?: string[];
  callIds?: string[];
  sideEffects?: string[];
  ok?: boolean;
  metadata?: Record<string, JsonValue>;
}

export interface TraceFilterReport {
  inputEventCount: number;
  outputEventCount: number;
  matchedInteractionCount: number;
}

export function filterTrace(events: TraceEvent[], options: TraceFilterOptions = {}): TraceEvent[] {
  if (!hasActiveFilter(options)) {
    return [...events];
  }

  const indexedEvents = new Map<TraceEvent, number>();
  events.forEach((event, index) => {
    indexedEvents.set(event, index);
  });

  const includedIndexes = new Set<number>();
  const interactions = collectToolInteractions(events);
  let matchedInteractionCount = 0;

  for (const interaction of interactions) {
    if (!matchesInteraction(interaction, options)) {
      continue;
    }
    matchedInteractionCount += 1;
    includedIndexes.add(indexedEvents.get(interaction.call)!);
    if (interaction.result) {
      includedIndexes.add(indexedEvents.get(interaction.result)!);
    }
  }

  if (matchedInteractionCount === 0) {
    return includeSessionBoundaryEvents(events);
  }

  events.forEach((event, index) => {
    if (event.type === "session_start" || event.type === "session_end") {
      includedIndexes.add(index);
    }
  });

  return events.filter((_event, index) => includedIndexes.has(index));
}

export async function filterTraceFile(
  inputPath: string,
  outputPath: string,
  options: TraceFilterOptions = {}
): Promise<TraceFilterReport> {
  const events = hasActiveFilter(options) ? await filterTraceFileStream(inputPath, outputPath, options) : await copyTraceFile(inputPath, outputPath);
  return {
    inputEventCount: events.length,
    outputEventCount: events.filtered.length,
    matchedInteractionCount: events.matchedInteractionCount
  };
}

function hasActiveFilter(options: TraceFilterOptions): boolean {
  return (
    (options.tools?.length ?? 0) > 0 ||
    (options.callIds?.length ?? 0) > 0 ||
    (options.sideEffects?.length ?? 0) > 0 ||
    options.ok !== undefined ||
    Object.keys(options.metadata ?? {}).length > 0
  );
}

function matchesInteraction(interaction: RecordedToolInteraction, options: TraceFilterOptions): boolean {
  if (options.tools && !options.tools.includes(interaction.call.tool)) {
    return false;
  }
  if (options.callIds && !options.callIds.includes(interaction.call.callId)) {
    return false;
  }
  if (options.sideEffects && !options.sideEffects.includes(getSideEffect(interaction.call.metadata))) {
    return false;
  }
  if (options.ok !== undefined && interaction.result?.ok !== options.ok) {
    return false;
  }
  if (options.metadata && !matchesMetadata(interaction.call.metadata, options.metadata)) {
    return false;
  }
  return true;
}

function includeSessionBoundaryEvents(events: TraceEvent[]): TraceEvent[] {
  return events.filter((event) => event.type === "session_start" || event.type === "session_end");
}

function getSideEffect(metadata: TraceEvent["metadata"]): string {
  return typeof metadata?.sideEffect === "string" ? metadata.sideEffect : "";
}

function matchesMetadata(metadata: TraceEvent["metadata"], filters: Record<string, JsonValue>): boolean {
  return Object.entries(filters).every(([path, expected]) => stableStringify(getMetadataValue(metadata, path)) === stableStringify(expected));
}

function getMetadataValue(metadata: TraceEvent["metadata"], path: string): JsonValue | undefined {
  let current: unknown = metadata;
  for (const segment of path.split(".")) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current as JsonValue | undefined;
}

async function filterTraceFileStream(
  inputPath: string,
  outputPath: string,
  options: TraceFilterOptions
): Promise<{ length: number; filtered: TraceEvent[]; matchedInteractionCount: number }> {
  await ensureParentDir(outputPath);

  let inputEventCount = 0;
  let matchedInteractionCount = 0;
  let sessionStart: TraceEvent | undefined;
  let sessionEnd: TraceEvent | undefined;
  const outputEntries: Array<{ index: number; event: TraceEvent }> = [];
  const pendingInteractions = new Map<string, { interaction: RecordedToolInteraction; index: number }>();
  const completedResults = new Set<string>();

  for await (const event of readTraceFileStream(inputPath)) {
    inputEventCount += 1;
    const eventIndex = inputEventCount - 1;

    if (event.type === "session_start") {
      sessionStart = event;
      continue;
    }
    if (event.type === "session_end") {
      sessionEnd = event;
      continue;
    }
    if (event.type === "tool_call") {
      if (pendingInteractions.has(event.callId) || completedResults.has(event.callId)) {
        throw new Error(`Invalid trace: duplicate tool_call callId ${event.callId}`);
      }
      pendingInteractions.set(event.callId, {
        interaction: { call: event },
        index: eventIndex
      });
      continue;
    }
    if (event.type === "tool_result") {
      const pending = pendingInteractions.get(event.callId);
      if (!pending) {
        if (completedResults.has(event.callId)) {
          throw new Error(`Invalid trace: duplicate tool_result callId ${event.callId}`);
        }
        throw new Error(`Invalid trace: tool_result ${event.callId} has no matching tool_call`);
      }
      if (pending.interaction.call.tool !== event.tool) {
        throw new Error(
          `Invalid trace: tool_result ${event.callId} tool ${event.tool} does not match tool_call tool ${pending.interaction.call.tool}`
        );
      }

      pending.interaction.result = event;
      if (matchesInteraction(pending.interaction, options)) {
        matchedInteractionCount += 1;
        outputEntries.push(
          { index: pending.index, event: pending.interaction.call },
          { index: eventIndex, event }
        );
      }
      pendingInteractions.delete(event.callId);
      completedResults.add(event.callId);
    }
  }

  for (const pending of pendingInteractions.values()) {
    if (!matchesInteraction(pending.interaction, options)) {
      continue;
    }
    matchedInteractionCount += 1;
    outputEntries.push({ index: pending.index, event: pending.interaction.call });
  }

  const filtered = outputEntries.sort((left, right) => left.index - right.index).map((entry) => entry.event);

  const outputEvents = [
    ...(sessionStart ? [sessionStart] : []),
    ...filtered,
    ...(sessionEnd ? [sessionEnd] : [])
  ];
  await writeTraceFile(outputPath, outputEvents);

  return {
    length: inputEventCount,
    filtered: outputEvents,
    matchedInteractionCount
  };
}

async function copyTraceFile(
  inputPath: string,
  outputPath: string
): Promise<{ length: number; filtered: TraceEvent[]; matchedInteractionCount: number }> {
  const events = await readTraceFile(inputPath);
  await writeTraceFile(outputPath, events);
  return {
    length: events.length,
    filtered: events,
    matchedInteractionCount: Math.max(0, events.filter((event) => event.type === "tool_call").length)
  };
}
