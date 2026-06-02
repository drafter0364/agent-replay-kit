import { describe, expect, it } from "vitest";
import { buildTraceTimeline, summarizeTrace } from "../src/index.js";
import type { TraceEvent } from "../src/types.js";

describe("trace inspect", () => {
  it("summarizes sessions, tool calls, failures, and assertions", () => {
    const events: TraceEvent[] = [
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1", agent: "demo" },
      { type: "tool_call", callId: "c1", tool: "shell", args: {} },
      { type: "tool_result", callId: "c1", tool: "shell", ok: false, error: { message: "boom" } },
      { type: "assertion", name: "must-call:shell", ok: true }
    ];

    expect(summarizeTrace(events)).toEqual({
      eventCount: 4,
      sessionId: "s1",
      agent: "demo",
      toolCalls: { shell: 1 },
      failedTools: 1,
      assertions: { passed: 1, failed: 0 }
    });
  });

  it("builds timeline-json data for viewer and telemetry use", () => {
    const events: TraceEvent[] = [
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1", agent: "demo", seq: 1 },
      { type: "tool_call", callId: "c1", tool: "http", args: {}, metadata: { sideEffect: "network" }, seq: 2 },
      { type: "tool_result", callId: "c1", tool: "http", ok: false, error: { message: "boom" }, durationMs: 50, seq: 3 },
      { type: "session_end", ok: false, durationMs: 60, seq: 4 }
    ];

    const timeline = buildTraceTimeline(events);

    expect(timeline.sessionId).toBe("s1");
    expect(timeline.durationMs).toBe(60);
    expect(timeline.items[1]).toMatchObject({ tool: "http", sideEffect: "network" });
    expect(timeline.slowestTools[0]).toMatchObject({ tool: "http", durationMs: 50 });
    expect(timeline.failedTools).toHaveLength(1);
    expect(timeline.alternation.map((item) => item.to)).toEqual(["session_start", "tool_call", "tool_result", "session_end"]);
  });
});
