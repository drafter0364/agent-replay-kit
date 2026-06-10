import { readTraceFile } from "./io.js";
import type { JsonValue, RecordedToolInteraction, ReplayMatchMode, ToolResultEvent, TraceEvent } from "./types.js";
import { stableStringify } from "./utils.js";

export interface ReplayOptions {
  matchMode?: ReplayMatchMode;
}

export interface ReplayMismatchDetails {
  expectedTool?: string;
  actualTool?: string;
  expectedArgs?: JsonValue;
  actualArgs?: JsonValue;
  callId?: string;
}

export class ReplayMismatchError extends Error {
  constructor(
    message: string,
    readonly details: ReplayMismatchDetails = {}
  ) {
    super(message);
    this.name = "ReplayMismatchError";
  }
}

export class RecordedToolError extends Error {
  constructor(readonly recorded: ToolResultEvent) {
    super(recorded.error?.message ?? `Recorded tool ${recorded.tool} failed`);
    this.name = recorded.error?.name ?? "RecordedToolError";
  }
}

export class TraceReplayer {
  private index = 0;
  private readonly consumedCallIds = new Set<string>();
  private readonly byCallId: Map<string, RecordedToolInteraction>;
  readonly interactions: RecordedToolInteraction[];

  constructor(events: TraceEvent[], private readonly options: ReplayOptions = {}) {
    this.interactions = collectToolInteractions(events);
    this.byCallId = new Map(this.interactions.map((interaction) => [interaction.call.callId, interaction]));
  }

  replayTool<T = JsonValue>(tool: string, args: JsonValue): T {
    const matchMode = this.options.matchMode ?? "strict";
    if (matchMode === "call-id") {
      throw new ReplayMismatchError("replayTool() cannot be used with call-id match mode; use replayToolByCallId()");
    }

    const interaction = this.interactions[this.index];
    if (!interaction) {
      throw new ReplayMismatchError(`No recorded tool call remains for ${tool}`, { actualTool: tool });
    }

    if (interaction.call.tool !== tool) {
      throw new ReplayMismatchError(`Expected tool ${interaction.call.tool}, received ${tool}`, {
        expectedTool: interaction.call.tool,
        actualTool: tool,
        callId: interaction.call.callId
      });
    }

    if (matchMode === "strict" && stableStringify(interaction.call.args) !== stableStringify(args)) {
      throw new ReplayMismatchError(`Tool args mismatch for ${tool}`, {
        expectedTool: tool,
        actualTool: tool,
        expectedArgs: interaction.call.args,
        actualArgs: args,
        callId: interaction.call.callId
      });
    }

    this.index += 1;
    if (!interaction.result) {
      throw new ReplayMismatchError(`Recorded tool call ${interaction.call.callId} has no result`);
    }

    if (!interaction.result.ok) {
      throw new RecordedToolError(interaction.result);
    }

    return interaction.result.result as T;
  }

  replayToolByCallId<T = JsonValue>(callId: string, expected?: { tool?: string; args?: JsonValue }): T {
    const interaction = this.byCallId.get(callId);
    if (!interaction) {
      throw new ReplayMismatchError(`No recorded tool call found for callId ${callId}`, { callId });
    }

    if (this.consumedCallIds.has(callId)) {
      throw new ReplayMismatchError(`Recorded tool call ${callId} has already been replayed`, { callId });
    }

    if (expected?.tool && interaction.call.tool !== expected.tool) {
      throw new ReplayMismatchError(`Expected tool ${interaction.call.tool}, received ${expected.tool}`, {
        expectedTool: interaction.call.tool,
        actualTool: expected.tool,
        callId
      });
    }

    if (expected?.args !== undefined && stableStringify(interaction.call.args) !== stableStringify(expected.args)) {
      throw new ReplayMismatchError(`Tool args mismatch for callId ${callId}`, {
        expectedTool: interaction.call.tool,
        actualTool: expected.tool ?? interaction.call.tool,
        expectedArgs: interaction.call.args,
        actualArgs: expected.args,
        callId
      });
    }

    this.consumedCallIds.add(callId);
    if (!interaction.result) {
      throw new ReplayMismatchError(`Recorded tool call ${interaction.call.callId} has no result`);
    }

    if (!interaction.result.ok) {
      throw new RecordedToolError(interaction.result);
    }

    return interaction.result.result as T;
  }

  remaining(): RecordedToolInteraction[] {
    if ((this.options.matchMode ?? "strict") === "call-id") {
      return this.interactions.filter((interaction) => !this.consumedCallIds.has(interaction.call.callId));
    }
    return this.interactions.slice(this.index);
  }

  consumedCount(): number {
    if ((this.options.matchMode ?? "strict") === "call-id") {
      return this.consumedCallIds.size;
    }
    return this.index;
  }
}

export async function createReplayerFromFile(filePath: string, options?: ReplayOptions): Promise<TraceReplayer> {
  return new TraceReplayer(await readTraceFile(filePath), options);
}

export function collectToolInteractions(events: TraceEvent[]): RecordedToolInteraction[] {
  const interactions: RecordedToolInteraction[] = [];
  const byCallId = new Map<string, RecordedToolInteraction>();

  for (const event of events) {
    if (event.type === "tool_call") {
      if (byCallId.has(event.callId)) {
        throw new ReplayMismatchError(`Invalid trace: duplicate tool_call callId ${event.callId}`);
      }
      const interaction = { call: event };
      interactions.push(interaction);
      byCallId.set(event.callId, interaction);
    }

    if (event.type === "tool_result") {
      const interaction = byCallId.get(event.callId);
      if (!interaction) {
        throw new ReplayMismatchError(`Invalid trace: tool_result ${event.callId} has no matching tool_call`);
      }
      if (interaction.call.tool !== event.tool) {
        throw new ReplayMismatchError(
          `Invalid trace: tool_result ${event.callId} tool ${event.tool} does not match tool_call tool ${interaction.call.tool}`
        );
      }
      if (interaction.result) {
        throw new ReplayMismatchError(`Invalid trace: duplicate tool_result callId ${event.callId}`);
      }
      interaction.result = event;
    }
  }

  return interactions;
}
