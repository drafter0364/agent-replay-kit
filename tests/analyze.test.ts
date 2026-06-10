import { describe, expect, it } from "vitest";
import { analyzeTrace, renderTraceAnalysisMarkdown } from "../src/index.js";
import type { TraceEvent } from "../src/types.js";

describe("trace analysis", () => {
  it("passes clean traces", () => {
    const events: TraceEvent[] = [
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1" },
      { type: "tool_call", callId: "c1", tool: "read_file", args: { path: "README.md" }, metadata: { sideEffect: "read" } },
      { type: "tool_result", callId: "c1", tool: "read_file", ok: true },
      { type: "tool_call", callId: "c2", tool: "write_file", args: { path: "README.md" }, metadata: { sideEffect: "write" } },
      { type: "tool_result", callId: "c2", tool: "write_file", ok: true },
      { type: "session_end", ok: true }
    ];

    const report = analyzeTrace(events);

    expect(report.ok).toBe(true);
    expect(report.summary).toEqual({ findings: 0, warnings: 0, errors: 0 });
    expect(renderTraceAnalysisMarkdown(report)).toContain("- none");
  });

  it("flags repeated calls, early writes, noisy shell use, and masked failures", () => {
    const events: TraceEvent[] = [
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1" },
      { type: "tool_call", callId: "c1", tool: "write_file", args: { path: "a.ts" }, metadata: { sideEffect: "write" } },
      { type: "tool_result", callId: "c1", tool: "write_file", ok: true },
      { type: "tool_call", callId: "c2", tool: "shell", args: { command: "npm test" } },
      { type: "tool_result", callId: "c2", tool: "shell", ok: false, error: { message: "failed" } },
      { type: "tool_call", callId: "c3", tool: "shell", args: { command: "npm test" } },
      { type: "tool_result", callId: "c3", tool: "shell", ok: true },
      { type: "session_end", ok: true }
    ];

    const report = analyzeTrace(events, { maxShellCalls: 1 });

    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.rule)).toEqual([
      "repeated-tool-call",
      "excessive-shell-calls",
      "write-before-read",
      "failed-tool-session-ok"
    ]);
    expect(report.summary).toEqual({ findings: 4, warnings: 3, errors: 1 });
    expect(renderTraceAnalysisMarkdown(report)).toContain("failed-tool-session-ok");
  });

  it("flags external actions before verification reads", () => {
    const events: TraceEvent[] = [
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1" },
      { type: "tool_call", callId: "c1", tool: "send_message", args: { text: "done" }, metadata: { sideEffect: "external-state" } },
      { type: "tool_result", callId: "c1", tool: "send_message", ok: true },
      { type: "tool_call", callId: "c2", tool: "read_file", args: { path: "README.md" }, metadata: { sideEffect: "read" } },
      { type: "tool_result", callId: "c2", tool: "read_file", ok: true },
      { type: "session_end", ok: true }
    ];

    const report = analyzeTrace(events);

    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.rule)).toContain("external-action-before-verification");
  });

  it("does not flag external actions after a verification read", () => {
    const events: TraceEvent[] = [
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1" },
      { type: "tool_call", callId: "c1", tool: "read_file", args: { path: "README.md" }, metadata: { sideEffect: "read" } },
      { type: "tool_result", callId: "c1", tool: "read_file", ok: true },
      { type: "tool_call", callId: "c2", tool: "http_post", args: { url: "https://example.test" }, metadata: { sideEffect: "network" } },
      { type: "tool_result", callId: "c2", tool: "http_post", ok: true },
      { type: "session_end", ok: true }
    ];

    const report = analyzeTrace(events);

    expect(report.findings.map((finding) => finding.rule)).not.toContain("external-action-before-verification");
  });
});
