import { describe, expect, it } from "vitest";
import { summarizeTrace } from "../src/index.js";
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
});
