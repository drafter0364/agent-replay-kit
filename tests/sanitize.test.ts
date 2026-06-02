import { describe, expect, it } from "vitest";
import { sanitizeTraceEvents, sanitizeTraceEventsWithReport } from "../src/index.js";
import type { TraceEvent } from "../src/types.js";

describe("trace sanitizer", () => {
  it("redacts secret keys and sensitive strings recursively", () => {
    const events: TraceEvent[] = [
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1", seq: 1 },
      {
        type: "tool_call",
        sessionId: "s1",
        callId: "c1",
        tool: "http",
        seq: 2,
        args: {
          apiKey: "sk-testsecret123456",
          email: "maintainer@example.com",
          url: "https://private.example.com/path?q=1",
          path: "C:\\Users\\dev\\repo\\file.ts"
        }
      },
      { type: "tool_result", sessionId: "s1", callId: "c1", tool: "http", ok: true, result: "Bearer test-token-123", seq: 3 },
      { type: "session_end", sessionId: "s1", ok: true, seq: 4 }
    ];

    const raw = JSON.stringify(sanitizeTraceEvents(events));
    expect(raw).not.toContain("sk-testsecret123456");
    expect(raw).not.toContain("maintainer@example.com");
    expect(raw).not.toContain("private.example.com");
    expect(raw).not.toContain("C:\\Users");
    expect(raw).toContain("[REDACTED]");
  });

  it("returns a redaction report and validates sanitized traces", () => {
    const events: TraceEvent[] = [
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1", seq: 1 },
      { type: "tool_call", sessionId: "s1", callId: "c1", tool: "http", args: { token: "abc" }, seq: 2 },
      { type: "tool_result", sessionId: "s1", callId: "c1", tool: "http", ok: true, result: "owner@example.com", seq: 3 },
      { type: "session_end", sessionId: "s1", ok: true, seq: 4 }
    ];

    const sanitized = sanitizeTraceEventsWithReport(events);

    expect(sanitized.report.ok).toBe(true);
    expect(sanitized.report.redactionCount).toBeGreaterThanOrEqual(2);
    expect(sanitized.report.redactions.map((redaction) => redaction.path)).toEqual(
      expect.arrayContaining(["$[1].args.token", "$[2].result"])
    );
  });
});
