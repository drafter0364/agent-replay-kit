import { describe, expect, it } from "vitest";
import { assertTraceEvent, isTraceEvent, parseTraceLine, validateTraceEvent } from "../src/schema.js";

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

  it("rejects invalid nested metadata values", () => {
    const result = validateTraceEvent({
      type: "tool_call",
      callId: "c1",
      tool: "shell",
      args: {},
      metadata: { nested: { invalid: undefined } }
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("event.metadata must be a JSON object");
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

  it("accepts a valid assertion event", () => {
    expect(
      validateTraceEvent({
        type: "assertion",
        name: "must-call:shell",
        ok: true,
        message: "Tool shell was called"
      }).ok
    ).toBe(true);

    const result = validateTraceEvent({ type: "assertion", ok: true });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("assertion.name must be a non-empty string");
  });

  it("identifies trace events via isTraceEvent type guard", () => {
    expect(isTraceEvent({ type: "session_start", schemaVersion: "1.0", sessionId: "s1" })).toBe(true);
    expect(isTraceEvent({ type: "tool_call", callId: "c1", tool: "shell", args: {} })).toBe(true);
    expect(isTraceEvent({ type: "unknown_type" })).toBe(false);
    expect(isTraceEvent(null)).toBe(false);
    expect(isTraceEvent("string")).toBe(false);
  });

  it("asserts trace events and throws on invalid input", () => {
    expect(() => assertTraceEvent({ type: "session_start", schemaVersion: "1.0", sessionId: "s1" })).not.toThrow();
    expect(() => assertTraceEvent({ type: "not_a_type" })).toThrow(/Invalid trace event/);
    expect(() => assertTraceEvent(null)).toThrow(/event must be an object/);
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

  it("rejects excessively deep or large JSON payloads", () => {
    let deep: unknown = "leaf";
    for (let index = 0; index < 21; index += 1) {
      deep = { nested: deep };
    }
    const oversizedArgs = Array.from({ length: 1001 }, () => "x");

    const deepResult = validateTraceEvent({
      type: "session_start",
      schemaVersion: "1.0",
      sessionId: "s1",
      input: deep
    });
    const largeResult = validateTraceEvent({
      type: "tool_call",
      callId: "c1",
      tool: "shell",
      args: oversizedArgs
    });

    expect(deepResult.ok).toBe(false);
    expect(deepResult.errors.join("\n")).toContain("session_start.input exceeds max depth");
    expect(largeResult.ok).toBe(false);
    expect(largeResult.errors.join("\n")).toContain("tool_call.args exceeds max array length");
  });
});
