import { describe, expect, it } from "vitest";
import { sealTraceEvents, verifyTraceIntegrity } from "../src/index.js";
import type { TraceEvent } from "../src/types.js";

const events: TraceEvent[] = [
  { type: "session_start", schemaVersion: "1.0", sessionId: "s1", seq: 1 },
  { type: "tool_call", callId: "c1", tool: "shell", args: { command: "npm test" }, seq: 2 },
  { type: "tool_result", callId: "c1", tool: "shell", ok: true, result: { exitCode: 0 }, seq: 3 },
  { type: "session_end", ok: true, seq: 4 }
];

describe("trace integrity", () => {
  it("seals and verifies trace events", () => {
    const sealed = sealTraceEvents(events);

    expect(sealed.every((event) => event.hash && event.prevHash)).toBe(true);
    expect(verifyTraceIntegrity(sealed)).toEqual({ ok: true, eventCount: 4, diagnostics: [] });
  });

  it("detects tampered event content", () => {
    const sealed = sealTraceEvents(events);
    const tampered = sealed.map((event) =>
      event.type === "tool_call" ? { ...event, args: { command: "npm run build" } } : event
    );
    const report = verifyTraceIntegrity(tampered);

    expect(report.ok).toBe(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain("trace-integrity-hash-mismatch");
  });

  it("requires hashes on every event", () => {
    const report = verifyTraceIntegrity(events);

    expect(report.ok).toBe(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain("trace-integrity-missing-hash");
  });
});
