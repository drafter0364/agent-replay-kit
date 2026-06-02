import { describe, expect, it } from "vitest";
import { testGoldenTraceRegression } from "../src/index.js";
import type { TraceEvent } from "../src/types.js";

const baseline: TraceEvent[] = [
  { type: "session_start", schemaVersion: "1.0", sessionId: "s1", seq: 1 },
  { type: "tool_call", sessionId: "s1", callId: "c1", tool: "shell", args: { command: "npm test" }, seq: 2 },
  { type: "tool_result", sessionId: "s1", callId: "c1", tool: "shell", ok: true, result: { exitCode: 0 }, seq: 3 },
  { type: "session_end", sessionId: "s1", ok: true, seq: 4 }
];

describe("golden trace regression", () => {
  it("allows model message changes", () => {
    const actual: TraceEvent[] = [
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1", seq: 1 },
      { type: "model_message", sessionId: "s1", role: "assistant", content: "different wording", seq: 2 },
      { type: "tool_call", sessionId: "s1", callId: "c1", tool: "shell", args: { command: "npm test" }, seq: 3 },
      { type: "tool_result", sessionId: "s1", callId: "c1", tool: "shell", ok: true, result: { exitCode: 0 }, seq: 4 },
      { type: "session_end", sessionId: "s1", ok: true, seq: 5 }
    ];

    expect(testGoldenTraceRegression(baseline, actual, { mustCall: ["shell"] }).ok).toBe(true);
  });

  it("fails when tool behavior changes", () => {
    const actual = baseline.map((event) =>
      event.type === "tool_call" ? { ...event, args: { command: "npm run build" } } : event
    );
    const report = testGoldenTraceRegression(baseline, actual, { mustCall: ["shell"] });

    expect(report.ok).toBe(false);
    expect(report.regressionChanges.map((change) => change.message).join("\n")).toContain("tool_call:c1");
  });
});
