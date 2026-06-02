import { describe, expect, it } from "vitest";
import { renderTraceValidationMarkdown, validateTrace, validateTraceText } from "../src/index.js";
import type { TraceEvent } from "../src/types.js";

describe("trace validation", () => {
  it("accepts a complete trace", () => {
    const events: TraceEvent[] = [
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1", seq: 1 },
      { type: "tool_call", sessionId: "s1", callId: "c1", tool: "shell", args: { command: "npm test" }, seq: 2 },
      { type: "tool_result", sessionId: "s1", callId: "c1", tool: "shell", ok: true, result: { exitCode: 0 }, seq: 3 },
      { type: "session_end", sessionId: "s1", ok: true, seq: 4 }
    ];

    expect(validateTrace(events)).toEqual({ ok: true, eventCount: 4, diagnostics: [] });
  });

  it("reports trace-level corruption", () => {
    const events: TraceEvent[] = [
      { type: "tool_result", callId: "missing", tool: "shell", ok: true, result: null, seq: 1 },
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1", seq: 1 },
      { type: "tool_call", callId: "c1", tool: "shell", args: {}, seq: 3 },
      { type: "session_end", ok: true, seq: 4 },
      { type: "model_message", role: "assistant", content: "late", seq: 5 }
    ];
    const report = validateTrace(events);

    expect(report.ok).toBe(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "trace-event-before-session-start",
        "trace-orphan-tool-result",
        "trace-session-start-not-first",
        "trace-seq-not-monotonic",
        "trace-event-after-session-end",
        "trace-missing-tool-result"
      ])
    );
    expect(renderTraceValidationMarkdown(report)).toContain("Status: fail");
  });

  it("validates text without throwing on invalid lines", () => {
    const report = validateTraceText("{bad}\n{\"type\":\"session_start\",\"schemaVersion\":\"1.0\",\"sessionId\":\"s1\"}");

    expect(report.ok).toBe(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain("trace-line-invalid-json");
    expect(report.eventCount).toBe(1);
  });
});
