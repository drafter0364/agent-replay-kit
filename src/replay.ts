import { readTraceFile } from "./io.js";
import type { JsonValue, RecordedToolInteraction, ReplayMatchMode, ToolResultEvent, TraceEvent } from "./types.js";
import { stableStringify } from "./utils.js";

export interface ReplayOptions {
  matchMode?: ReplayMatchMode;
}

export class ReplayMismatchError extends Error {
  constructor(message: string) {
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
  readonly interactions: RecordedToolInteraction[];

  constructor(events: TraceEvent[], private readonly options: ReplayOptions = {}) {
    this.interactions = collectToolInteractions(events);
  }

  replayTool<T = JsonValue>(tool: string, args: JsonValue): T {
    const interaction = this.interactions[this.index];
    if (!interaction) {
      throw new ReplayMismatchError(`No recorded tool call remains for ${tool}`);
    }

    const matchMode = this.options.matchMode ?? "strict";
    if (interaction.call.tool !== tool) {
      throw new ReplayMismatchError(`Expected tool ${interaction.call.tool}, received ${tool}`);
    }

    if (matchMode === "strict" && stableStringify(interaction.call.args) !== stableStringify(args)) {
      throw new ReplayMismatchError(`Tool args mismatch for ${tool}`);
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

  remaining(): RecordedToolInteraction[] {
    return this.interactions.slice(this.index);
  }

  consumedCount(): number {
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
      const interaction = { call: event };
      interactions.push(interaction);
      byCallId.set(event.callId, interaction);
    }

    if (event.type === "tool_result") {
      const interaction = byCallId.get(event.callId);
      if (interaction) {
        interaction.result = event;
      }
    }
  }

  return interactions;
}
