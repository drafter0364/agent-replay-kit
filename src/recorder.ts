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
import { createId, isJsonValue, isRecord, nowIso, toJsonValue } from "./utils.js";

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
  private state: "idle" | "started" | "ended" = "idle";
  readonly sessionId: string;

  constructor(
    readonly filePath: string,
    private readonly options: RecorderOptions = {}
  ) {
    validateRecorderOptions(options);
    this.sessionId = options.sessionId ?? createId("session");
  }

  async start(input?: JsonValue): Promise<SessionStartEvent> {
    if (this.state !== "idle") {
      throw new Error("TraceRecorder.start() can only be called once");
    }
    this.startedAt = Date.now();
    const event = await this.write<SessionStartEvent>({
      type: "session_start",
      schemaVersion: "1.0",
      sessionId: this.sessionId,
      agent: this.options.agent,
      runId: this.options.runId,
      input,
      metadata: this.options.metadata
    });
    this.state = "started";
    return event;
  }

  async modelMessage(event: Omit<ModelMessageEvent, "type" | "seq" | "timestamp" | "sessionId">): Promise<ModelMessageEvent> {
    this.assertRecording("modelMessage");
    return this.write<ModelMessageEvent>({
      type: "model_message",
      sessionId: this.sessionId,
      ...event
    });
  }

  async tool<T>(
    tool: string,
    args: JsonValue,
    run: () => Promise<T> | T,
    metadata?: JsonObject,
    callId = createId("call")
  ): Promise<T> {
    this.assertRecording("tool");
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
    this.assertRecording("toolCall");
    return this.write<ToolCallEvent>({
      type: "tool_call",
      sessionId: this.sessionId,
      callId,
      tool,
      args,
      metadata
    });
  }

  async toolResult(event: Omit<ToolResultEvent, "type" | "seq" | "timestamp" | "sessionId">): Promise<ToolResultEvent> {
    this.assertRecording("toolResult");
    return this.write<ToolResultEvent>({
      type: "tool_result",
      sessionId: this.sessionId,
      ...event
    });
  }

  async end(options: SessionEndOptions = {}): Promise<SessionEndEvent> {
    this.assertRecording("end");
    const event = await this.write<SessionEndEvent>({
      type: "session_end",
      sessionId: this.sessionId,
      ok: options.ok,
      summary: options.summary,
      durationMs: Date.now() - this.startedAt,
      metadata: options.metadata
    });
    this.state = "ended";
    return event;
  }

  private async write<T extends TraceEvent>(event: Omit<T, "seq" | "timestamp"> & Partial<Pick<T, "seq" | "timestamp">>): Promise<T> {
    const nextSeq = this.seq + 1;
    const fullEvent = {
      ...event,
      seq: nextSeq,
      timestamp: nowIso()
    } as T;
    await appendTraceEvent(this.filePath, fullEvent);
    this.seq = nextSeq;
    return fullEvent;
  }

  private assertRecording(method: string): void {
    if (this.state === "idle") {
      throw new Error(`TraceRecorder.${method}() requires start() to be called first`);
    }
    if (this.state === "ended") {
      throw new Error(`TraceRecorder.${method}() cannot be called after end()`);
    }
  }
}

export function createRecorder(filePath: string, options?: RecorderOptions): TraceRecorder {
  return new TraceRecorder(filePath, options);
}

function validateRecorderOptions(options: RecorderOptions): void {
  if ("sessionId" in options && (typeof options.sessionId !== "string" || options.sessionId.length === 0)) {
    throw new Error("RecorderOptions.sessionId must be a non-empty string");
  }
  if ("agent" in options && options.agent !== undefined && typeof options.agent !== "string") {
    throw new Error("RecorderOptions.agent must be a string");
  }
  if ("runId" in options && options.runId !== undefined && typeof options.runId !== "string") {
    throw new Error("RecorderOptions.runId must be a string");
  }
  if ("metadata" in options && options.metadata !== undefined) {
    if (!isRecord(options.metadata) || !isJsonValue(options.metadata)) {
      throw new Error("RecorderOptions.metadata must be a JSON object");
    }
  }
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
