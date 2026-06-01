import { describe, expect, it } from "vitest";
import { ReplayMismatchError, TraceReplayer } from "../src/index.js";
import type { TraceEvent } from "../src/types.js";

const events: TraceEvent[] = [
  { type: "session_start", schemaVersion: "1.0", sessionId: "s1" },
  { type: "tool_call", callId: "c1", tool: "shell", args: { command: "npm test" } },
  { type: "tool_result", callId: "c1", tool: "shell", ok: true, result: { exitCode: 0 } }
];

describe("TraceReplayer", () => {
  it("returns recorded tool results in strict order", () => {
    const replayer = new TraceReplayer(events);

    expect(replayer.replayTool("shell", { command: "npm test" })).toEqual({ exitCode: 0 });
    expect(replayer.consumedCount()).toBe(1);
  });

  it("rejects mismatched args in strict mode", () => {
    const replayer = new TraceReplayer(events);

    expect(() => replayer.replayTool("shell", { command: "npm run build" })).toThrow(ReplayMismatchError);
  });

  it("can replay by tool name only when requested", () => {
    const replayer = new TraceReplayer(events, { matchMode: "tool-only" });

    expect(replayer.replayTool("shell", { command: "different" })).toEqual({ exitCode: 0 });
  });
});
