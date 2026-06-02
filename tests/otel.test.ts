import { describe, expect, it } from "vitest";
import { exportTraceToOtel } from "../src/index.js";
import type { TraceEvent } from "../src/types.js";

describe("OpenTelemetry-style export", () => {
  it("exports session, model, and tool spans", () => {
    const events: TraceEvent[] = [
      {
        type: "session_start",
        schemaVersion: "1.0",
        sessionId: "s1",
        agent: "demo-agent",
        timestamp: "2026-01-01T00:00:00.000Z",
        seq: 1
      },
      { type: "model_message", role: "assistant", content: "run tests", timestamp: "2026-01-01T00:00:01.000Z", seq: 2 },
      {
        type: "tool_call",
        callId: "c1",
        tool: "shell",
        args: { command: "npm test" },
        metadata: { sideEffect: "read", risk: "low" },
        timestamp: "2026-01-01T00:00:02.000Z",
        seq: 3
      },
      {
        type: "tool_result",
        callId: "c1",
        tool: "shell",
        ok: true,
        result: { exitCode: 0 },
        durationMs: 25,
        timestamp: "2026-01-01T00:00:03.000Z",
        seq: 4
      },
      { type: "session_end", ok: true, timestamp: "2026-01-01T00:00:04.000Z", seq: 5 }
    ];

    const exported = exportTraceToOtel(events);

    expect(exported.resource.serviceName).toBe("agent-replay-kit");
    expect(exported.spans.map((span) => span.name)).toEqual(["agent.session demo-agent", "model.message assistant", "tool.shell"]);
    expect(exported.spans[0].traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(exported.spans[2]).toMatchObject({
      kind: "CLIENT",
      attributes: {
        "tool.name": "shell",
        "tool.side_effect": "read",
        "tool.duration_ms": 25,
        "tool.ok": true
      },
      status: { code: "OK" }
    });
  });
});
