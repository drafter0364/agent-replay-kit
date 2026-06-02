import { describe, expect, it } from "vitest";
import { parseTraceLine, validateTraceEvent } from "../src/schema.js";

describe("trace schema", () => {
  it("accepts a valid tool call event", () => {
    const result = validateTraceEvent({
      type: "tool_call",
      callId: "call_1",
      tool: "shell",
      args: { command: "npm test" }
    });

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("rejects malformed tool result errors", () => {
    const result = validateTraceEvent({
      type: "tool_result",
      callId: "call_1",
      tool: "shell",
      ok: false
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("tool_result.error.message is required when ok is false");
  });

  it("adds line context when parsing invalid JSONL", () => {
    expect(() => parseTraceLine("{", 3)).toThrow(/line 3/);
  });

  it("validates session_start optional fields", () => {
    expect(
      validateTraceEvent({
        type: "session_start",
        schemaVersion: "1.0",
        sessionId: "s1",
        runId: "run-1",
        input: { prompt: "hello" }
      }).ok
    ).toBe(true);

    const result = validateTraceEvent({
      type: "session_start",
      schemaVersion: "1.0",
      sessionId: "s1",
      runId: 12
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("session_start.runId must be a string");
  });

  it("validates model tool call structure", () => {
    const result = validateTraceEvent({
      type: "model_message",
      role: "assistant",
      toolCalls: [{ callId: "", tool: "shell" }]
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("model_message.toolCalls[0].callId must be a non-empty string");
    expect(result.errors).toContain("model_message.toolCalls[0].args is required");
  });

  it("requires successful tool results to include JSON result values", () => {
    const result = validateTraceEvent({
      type: "tool_result",
      callId: "c1",
      tool: "shell",
      ok: true
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("tool_result.result is required when ok is true");
  });

  it("rejects negative durations and oversized lines", () => {
    expect(
      validateTraceEvent({
        type: "session_end",
        durationMs: -1
      }).errors
    ).toContain("session_end.durationMs must be non-negative");

    expect(() => parseTraceLine("{\"type\":\"session_end\"}", 1, { maxLineLength: 5 })).toThrow(/exceeds max length/);
  });
});
