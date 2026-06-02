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

  it("preserves explicitly allowed URL hosts", () => {
    const events: TraceEvent[] = [
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1", seq: 1 },
      {
        type: "tool_call",
        sessionId: "s1",
        callId: "c1",
        tool: "http",
        args: {
          publicUrl: "https://github.com/drafter0364/agent-replay-kit",
          privateUrl: "https://private.example.com/token"
        },
        seq: 2
      },
      { type: "tool_result", sessionId: "s1", callId: "c1", tool: "http", ok: true, result: "ok", seq: 3 },
      { type: "session_end", sessionId: "s1", ok: true, seq: 4 }
    ];

    const raw = JSON.stringify(sanitizeTraceEvents(events, { allowedUrlHosts: ["github.com"] }));

    expect(raw).toContain("https://github.com/drafter0364/agent-replay-kit");
    expect(raw).not.toContain("private.example.com");
  });

  it("redacts common high-confidence service tokens", () => {
    const events: TraceEvent[] = [
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1", seq: 1 },
      {
        type: "tool_call",
        sessionId: "s1",
        callId: "c1",
        tool: "shell",
        args: {},
        seq: 2
      },
      {
        type: "tool_result",
        sessionId: "s1",
        callId: "c1",
        tool: "shell",
        ok: true,
        result:
          "ghp_abcdefghijklmnopqrstuvwxyzABCDE AKIAIOSFODNN7EXAMPLE xoxb-1234567890-abcdefghijkl npm_0123456789abcdef0123456789abcdef0123",
        seq: 3
      },
      { type: "session_end", sessionId: "s1", ok: true, seq: 4 }
    ];

    const sanitized = sanitizeTraceEventsWithReport(events);
    const raw = JSON.stringify(sanitized.events);

    expect(raw).not.toContain("ghp_abcdefghijklmnopqrstuvwxyzABCDE");
    expect(raw).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(raw).not.toContain("xoxb-1234567890-abcdefghijkl");
    expect(raw).not.toContain("npm_0123456789abcdef0123456789abcdef0123");
    expect(sanitized.report.redactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "github-token", confidence: "high" }),
        expect.objectContaining({ rule: "aws-access-key", confidence: "high" }),
        expect.objectContaining({ rule: "slack-token", confidence: "high" }),
        expect.objectContaining({ rule: "npm-token", confidence: "high" })
      ])
    );
  });
});
