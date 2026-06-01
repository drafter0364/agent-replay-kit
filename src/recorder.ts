import { appendTraceEvent } from "./io.js";
import type {
  JsonObject,
  JsonValue,
  ModelMessageEvent,
  SessionEndEvent,
  SessionStartEvent,
  ToolCallEvent,
  ToolResultEvent,
  TraceEvent
} from "./types.js";
import { createId, nowIso, toJsonValue } from "./utils.js";

export interface RecorderOptions {
  sessionId?: string;
  agent?: string;
  runId?: string;
  metadata?: JsonObject;
}

export interface SessionEndOptions {
  ok?: boolean;
  summary?: string;
  metadata?: JsonObject;
}

export class TraceRecorder {
  private seq = 0;
  private startedAt = Date.now();
  readonly sessionId: string;

  constructor(
    readonly filePath: string,
    private readonly options: RecorderOptions = {}
  ) {
    this.sessionId = options.sessionId ?? createId("session");
  }

  async start(input?: JsonValue): Promise<SessionStartEvent> {
    this.startedAt = Date.now();
    return this.write({
      type: "session_start",
      schemaVersion: "1.0",
      sessionId: this.sessionId,
      agent: this.options.agent,
      runId: this.options.runId,
      input,
      metadata: this.options.metadata
    });
  }

  async modelMessage(event: Omit<ModelMessageEvent, "type" | "seq" | "timestamp" | "sessionId">): Promise<ModelMessageEvent> {
    return this.write({
      type: "model_message",
      sessionId: this.sessionId,
      ...event
    });
  }

  async tool<T>(
    tool: string,
    args: JsonValue,
    run: () => Promise<T> | T,
    metadata?: JsonObject
  ): Promise<T> {
    const callId = createId("call");
    await this.toolCall(tool, args, callId, metadata);

    const started = Date.now();
    try {
      const result = await run();
      await this.toolResult({
        callId,
        tool,
        ok: true,
        result: toJsonValue(result),
        durationMs: Date.now() - started,
        metadata
      });
      return result;
    } catch (error) {
      await this.toolResult({
        callId,
        tool,
        ok: false,
        error: serializeError(error),
        durationMs: Date.now() - started,
        metadata
      });
      throw error;
    }
  }

  async toolCall(tool: string, args: JsonValue, callId = createId("call"), metadata?: JsonObject): Promise<ToolCallEvent> {
    return this.write({
      type: "tool_call",
      sessionId: this.sessionId,
      callId,
      tool,
      args,
      metadata
    });
  }

  async toolResult(event: Omit<ToolResultEvent, "type" | "seq" | "timestamp" | "sessionId">): Promise<ToolResultEvent> {
    return this.write({
      type: "tool_result",
      sessionId: this.sessionId,
      ...event
    });
  }

  async end(options: SessionEndOptions = {}): Promise<SessionEndEvent> {
    return this.write({
      type: "session_end",
      sessionId: this.sessionId,
      ok: options.ok,
      summary: options.summary,
      durationMs: Date.now() - this.startedAt,
      metadata: options.metadata
    });
  }

  private async write<T extends TraceEvent>(event: Omit<T, "seq" | "timestamp"> & Partial<Pick<T, "seq" | "timestamp">>): Promise<T> {
    const fullEvent = {
      ...event,
      seq: ++this.seq,
      timestamp: nowIso()
    } as T;
    await appendTraceEvent(this.filePath, fullEvent);
    return fullEvent;
  }
}

export function createRecorder(filePath: string, options?: RecorderOptions): TraceRecorder {
  return new TraceRecorder(filePath, options);
}

function serializeError(error: unknown): { name?: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  return { message: String(error) };
}
