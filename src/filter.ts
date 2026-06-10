import { readTraceFile, writeTraceFile } from "./io.js";
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
  const events = await readTraceFile(inputPath);
  const filtered = filterTrace(events, options);
  await writeTraceFile(outputPath, filtered);
  return {
    inputEventCount: events.length,
    outputEventCount: filtered.length,
    matchedInteractionCount: Math.max(0, filtered.filter((event) => event.type === "tool_call").length)
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
