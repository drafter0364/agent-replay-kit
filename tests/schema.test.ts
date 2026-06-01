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
});
