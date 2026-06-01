import type {
  AssertionEvent,
  ModelMessageEvent,
  SessionEndEvent,
  SessionStartEvent,
  ToolCallEvent,
  ToolResultEvent,
  TraceEvent,
  TraceValidationResult
} from "./types.js";
import { isRecord } from "./utils.js";

const eventTypes = new Set([
  "session_start",
  "model_message",
  "tool_call",
  "tool_result",
  "assertion",
  "session_end"
]);

export function validateTraceEvent(value: unknown): TraceValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["event must be an object"] };
  }

  if (typeof value.type !== "string" || !eventTypes.has(value.type)) {
    errors.push("event.type must be a supported trace event type");
    return { ok: false, errors };
  }

  if ("seq" in value && typeof value.seq !== "number") {
    errors.push("event.seq must be a number");
  }
  if ("timestamp" in value && typeof value.timestamp !== "string") {
    errors.push("event.timestamp must be an ISO string");
  }
  if ("sessionId" in value && typeof value.sessionId !== "string") {
    errors.push("event.sessionId must be a string");
  }
  if ("metadata" in value && !isRecord(value.metadata)) {
    errors.push("event.metadata must be an object");
  }

  switch (value.type) {
    case "session_start":
      validateSessionStart(value, errors);
      break;
    case "model_message":
      validateModelMessage(value, errors);
      break;
    case "tool_call":
      validateToolCall(value, errors);
      break;
    case "tool_result":
      validateToolResult(value, errors);
      break;
    case "assertion":
      validateAssertion(value, errors);
      break;
    case "session_end":
      validateSessionEnd(value, errors);
      break;
  }

  return { ok: errors.length === 0, errors };
}

export function isTraceEvent(value: unknown): value is TraceEvent {
  return validateTraceEvent(value).ok;
}

export function assertTraceEvent(value: unknown): asserts value is TraceEvent {
  const result = validateTraceEvent(value);
  if (!result.ok) {
    throw new Error(`Invalid trace event: ${result.errors.join("; ")}`);
  }
}

export function parseTraceLine(line: string, lineNumber = 0): TraceEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON on trace line ${lineNumber}: ${message}`);
  }

  const result = validateTraceEvent(parsed);
  if (!result.ok) {
    throw new Error(`Invalid trace event on line ${lineNumber}: ${result.errors.join("; ")}`);
  }

  return parsed as TraceEvent;
}

function validateSessionStart(value: Record<string, unknown>, errors: string[]): void {
  const event = value as Partial<SessionStartEvent>;
  if (event.schemaVersion !== "1.0") {
    errors.push("session_start.schemaVersion must be 1.0");
  }
  if (typeof event.sessionId !== "string" || event.sessionId.length === 0) {
    errors.push("session_start.sessionId must be a non-empty string");
  }
  if ("agent" in event && typeof event.agent !== "string") {
    errors.push("session_start.agent must be a string");
  }
}

function validateModelMessage(value: Record<string, unknown>, errors: string[]): void {
  const event = value as Partial<ModelMessageEvent>;
  if (!["system", "user", "assistant", "tool"].includes(String(event.role))) {
    errors.push("model_message.role must be system, user, assistant, or tool");
  }
  if ("content" in event && typeof event.content !== "string") {
    errors.push("model_message.content must be a string");
  }
  if ("toolCalls" in event && !Array.isArray(event.toolCalls)) {
    errors.push("model_message.toolCalls must be an array");
  }
}

function validateToolCall(value: Record<string, unknown>, errors: string[]): void {
  const event = value as Partial<ToolCallEvent>;
  if (typeof event.callId !== "string" || event.callId.length === 0) {
    errors.push("tool_call.callId must be a non-empty string");
  }
  if (typeof event.tool !== "string" || event.tool.length === 0) {
    errors.push("tool_call.tool must be a non-empty string");
  }
  if (!("args" in event)) {
    errors.push("tool_call.args is required");
  }
}

function validateToolResult(value: Record<string, unknown>, errors: string[]): void {
  const event = value as Partial<ToolResultEvent>;
  if (typeof event.callId !== "string" || event.callId.length === 0) {
    errors.push("tool_result.callId must be a non-empty string");
  }
  if (typeof event.tool !== "string" || event.tool.length === 0) {
    errors.push("tool_result.tool must be a non-empty string");
  }
  if (typeof event.ok !== "boolean") {
    errors.push("tool_result.ok must be a boolean");
  }
  if (event.ok === false && (!event.error || typeof event.error.message !== "string")) {
    errors.push("tool_result.error.message is required when ok is false");
  }
  if ("durationMs" in event && typeof event.durationMs !== "number") {
    errors.push("tool_result.durationMs must be a number");
  }
}

function validateAssertion(value: Record<string, unknown>, errors: string[]): void {
  const event = value as Partial<AssertionEvent>;
  if (typeof event.name !== "string" || event.name.length === 0) {
    errors.push("assertion.name must be a non-empty string");
  }
  if (typeof event.ok !== "boolean") {
    errors.push("assertion.ok must be a boolean");
  }
}

function validateSessionEnd(value: Record<string, unknown>, errors: string[]): void {
  const event = value as Partial<SessionEndEvent>;
  if ("ok" in event && typeof event.ok !== "boolean") {
    errors.push("session_end.ok must be a boolean");
  }
  if ("durationMs" in event && typeof event.durationMs !== "number") {
    errors.push("session_end.durationMs must be a number");
  }
  if ("summary" in event && typeof event.summary !== "string") {
    errors.push("session_end.summary must be a string");
  }
}
