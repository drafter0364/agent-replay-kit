import type { TraceEvent, TraceValidationResult } from "./types.js";
import { isJsonValue, isRecord } from "./utils.js";

export const DEFAULT_MAX_TRACE_LINE_LENGTH = 1024 * 1024;

export interface ParseTraceLineOptions {
  maxLineLength?: number;
}

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
  } else if ("seq" in value && typeof value.seq === "number" && (!Number.isInteger(value.seq) || value.seq < 1)) {
    errors.push("event.seq must be a positive integer");
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
  if ("hash" in value && typeof value.hash !== "string") {
    errors.push("event.hash must be a string");
  }
  if ("prevHash" in value && typeof value.prevHash !== "string") {
    errors.push("event.prevHash must be a string");
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

export function parseTraceLine(line: string, lineNumber = 0, options: ParseTraceLineOptions = {}): TraceEvent {
  const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_TRACE_LINE_LENGTH;
  if (line.length > maxLineLength) {
    throw new Error(`Trace line ${lineNumber} exceeds max length ${maxLineLength}`);
  }

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
  if (value.schemaVersion !== "1.0") {
    errors.push("session_start.schemaVersion must be 1.0");
  }
  if (typeof value.sessionId !== "string" || value.sessionId.length === 0) {
    errors.push("session_start.sessionId must be a non-empty string");
  }
  if ("agent" in value && typeof value.agent !== "string") {
    errors.push("session_start.agent must be a string");
  }
  if ("runId" in value && typeof value.runId !== "string") {
    errors.push("session_start.runId must be a string");
  }
  if ("input" in value && !isJsonValue(value.input)) {
    errors.push("session_start.input must be a JSON value");
  }
}

function validateModelMessage(value: Record<string, unknown>, errors: string[]): void {
  if (!["system", "user", "assistant", "tool"].includes(String(value.role))) {
    errors.push("model_message.role must be system, user, assistant, or tool");
  }
  if ("content" in value && typeof value.content !== "string") {
    errors.push("model_message.content must be a string");
  }
  if ("toolCalls" in value && !Array.isArray(value.toolCalls)) {
    errors.push("model_message.toolCalls must be an array");
  } else if (Array.isArray(value.toolCalls)) {
    value.toolCalls.forEach((toolCall, index) => {
      if (!isRecord(toolCall)) {
        errors.push(`model_message.toolCalls[${index}] must be an object`);
        return;
      }
      if (typeof toolCall.callId !== "string" || toolCall.callId.length === 0) {
        errors.push(`model_message.toolCalls[${index}].callId must be a non-empty string`);
      }
      if (typeof toolCall.tool !== "string" || toolCall.tool.length === 0) {
        errors.push(`model_message.toolCalls[${index}].tool must be a non-empty string`);
      }
      if (!("args" in toolCall)) {
        errors.push(`model_message.toolCalls[${index}].args is required`);
      } else if (!isJsonValue(toolCall.args)) {
        errors.push(`model_message.toolCalls[${index}].args must be a JSON value`);
      }
    });
  }
}

function validateToolCall(value: Record<string, unknown>, errors: string[]): void {
  if (typeof value.callId !== "string" || value.callId.length === 0) {
    errors.push("tool_call.callId must be a non-empty string");
  }
  if (typeof value.tool !== "string" || value.tool.length === 0) {
    errors.push("tool_call.tool must be a non-empty string");
  }
  if (!("args" in value)) {
    errors.push("tool_call.args is required");
  } else if (!isJsonValue(value.args)) {
    errors.push("tool_call.args must be a JSON value");
  }
}

function validateToolResult(value: Record<string, unknown>, errors: string[]): void {
  if (typeof value.callId !== "string" || value.callId.length === 0) {
    errors.push("tool_result.callId must be a non-empty string");
  }
  if (typeof value.tool !== "string" || value.tool.length === 0) {
    errors.push("tool_result.tool must be a non-empty string");
  }
  if (typeof value.ok !== "boolean") {
    errors.push("tool_result.ok must be a boolean");
  }
  if (value.ok === false && (!isRecord(value.error) || typeof value.error.message !== "string")) {
    errors.push("tool_result.error.message is required when ok is false");
  }
  if (value.ok === true && !("result" in value)) {
    errors.push("tool_result.result is required when ok is true");
  }
  if ("result" in value && !isJsonValue(value.result)) {
    errors.push("tool_result.result must be a JSON value");
  }
  if (isRecord(value.error)) {
    if ("name" in value.error && typeof value.error.name !== "string") {
      errors.push("tool_result.error.name must be a string");
    }
    if ("stack" in value.error && typeof value.error.stack !== "string") {
      errors.push("tool_result.error.stack must be a string");
    }
  }
  if ("durationMs" in value && typeof value.durationMs !== "number") {
    errors.push("tool_result.durationMs must be a number");
  } else if ("durationMs" in value && typeof value.durationMs === "number" && value.durationMs < 0) {
    errors.push("tool_result.durationMs must be non-negative");
  }
}

function validateAssertion(value: Record<string, unknown>, errors: string[]): void {
  if (typeof value.name !== "string" || value.name.length === 0) {
    errors.push("assertion.name must be a non-empty string");
  }
  if (typeof value.ok !== "boolean") {
    errors.push("assertion.ok must be a boolean");
  }
  if ("message" in value && typeof value.message !== "string") {
    errors.push("assertion.message must be a string");
  }
}

function validateSessionEnd(value: Record<string, unknown>, errors: string[]): void {
  if ("ok" in value && typeof value.ok !== "boolean") {
    errors.push("session_end.ok must be a boolean");
  }
  if ("durationMs" in value && typeof value.durationMs !== "number") {
    errors.push("session_end.durationMs must be a number");
  } else if ("durationMs" in value && typeof value.durationMs === "number" && value.durationMs < 0) {
    errors.push("session_end.durationMs must be non-negative");
  }
  if ("summary" in value && typeof value.summary !== "string") {
    errors.push("session_end.summary must be a string");
  }
}
