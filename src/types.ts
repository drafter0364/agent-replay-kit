export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type TraceEventType =
  | "session_start"
  | "model_message"
  | "tool_call"
  | "tool_result"
  | "assertion"
  | "session_end";

export interface TraceBaseEvent {
  type: TraceEventType;
  seq?: number;
  timestamp?: string;
  sessionId?: string;
  metadata?: JsonObject;
  hash?: string;
  prevHash?: string;
}

export interface SessionStartEvent extends TraceBaseEvent {
  type: "session_start";
  schemaVersion: "1.0";
  sessionId: string;
  agent?: string;
  runId?: string;
  input?: JsonValue;
}

export interface ModelMessageEvent extends TraceBaseEvent {
  type: "model_message";
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  toolCalls?: Array<{
    callId: string;
    tool: string;
    args: JsonValue;
  }>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface ToolCallEvent extends TraceBaseEvent {
  type: "tool_call";
  callId: string;
  tool: string;
  args: JsonValue;
}

export interface ToolResultEvent extends TraceBaseEvent {
  type: "tool_result";
  callId: string;
  tool: string;
  ok: boolean;
  result?: JsonValue;
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
  durationMs?: number;
}

export interface AssertionEvent extends TraceBaseEvent {
  type: "assertion";
  name: string;
  ok: boolean;
  message?: string;
}

export interface SessionEndEvent extends TraceBaseEvent {
  type: "session_end";
  ok?: boolean;
  durationMs?: number;
  summary?: string;
}

export type TraceEvent =
  | SessionStartEvent
  | ModelMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | AssertionEvent
  | SessionEndEvent;

export interface RecordedToolInteraction {
  call: ToolCallEvent;
  result?: ToolResultEvent;
}

export type ReplayMatchMode = "strict" | "tool-only" | "call-id";

export interface TraceValidationResult {
  ok: boolean;
  errors: string[];
}

export interface TraceDiagnostic {
  code: string;
  message: string;
  line?: number;
  seq?: number;
  eventType?: TraceEventType;
}

export interface TraceValidationReport {
  ok: boolean;
  eventCount: number;
  diagnostics: TraceDiagnostic[];
}
