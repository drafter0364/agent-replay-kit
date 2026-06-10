import { describe, expect, it } from "vitest";
import { RecordedToolError, ReplayMismatchError, TraceReplayer } from "../src/index.js";
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

  it("replays by call id without consuming positionally", () => {
    const multiEvents: TraceEvent[] = [
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1" },
      { type: "tool_call", callId: "c1", tool: "shell", args: { command: "npm test" } },
      { type: "tool_result", callId: "c1", tool: "shell", ok: true, result: { exitCode: 0 } },
      { type: "tool_call", callId: "c2", tool: "read_file", args: { path: "README.md" } },
      { type: "tool_result", callId: "c2", tool: "read_file", ok: true, result: "readme" }
    ];
    const replayer = new TraceReplayer(multiEvents, { matchMode: "call-id" });

    expect(replayer.replayToolByCallId("c2", { tool: "read_file", args: { path: "README.md" } })).toBe("readme");
    expect(replayer.remaining().map((interaction) => interaction.call.callId)).toEqual(["c1"]);
    expect(replayer.consumedCount()).toBe(1);
    expect(() => replayer.replayToolByCallId("c2")).toThrow(ReplayMismatchError);
  });

  it("throws RecordedToolError when recorded tool failed", () => {
    const failEvents: TraceEvent[] = [
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1" },
      { type: "tool_call", callId: "c1", tool: "http", args: { url: "https://example.test" } },
      { type: "tool_result", callId: "c1", tool: "http", ok: false, error: { name: "NetworkError", message: "timeout" } }
    ];

    let caught: unknown;
    const replayer = new TraceReplayer(failEvents);
    try {
      replayer.replayTool("http", { url: "https://example.test" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RecordedToolError);
    expect((caught as RecordedToolError).recorded.error?.name).toBe("NetworkError");
    expect((caught as RecordedToolError).name).toBe("NetworkError");
    expect((caught as RecordedToolError).message).toBe("timeout");
    expect(replayer.consumedCount()).toBe(1);
  });

  it("rejects positional replay in call-id mode", () => {
    const replayer = new TraceReplayer(events, { matchMode: "call-id" });

    expect(() => replayer.replayTool("shell", { command: "npm test" })).toThrow(ReplayMismatchError);
  });

  it("rejects orphan tool results during replay setup", () => {
    const invalidEvents: TraceEvent[] = [
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1" },
      { type: "tool_result", callId: "missing", tool: "shell", ok: true, result: { exitCode: 0 } }
    ];

    expect(() => new TraceReplayer(invalidEvents)).toThrow(/has no matching tool_call/);
  });

  it("rejects duplicate or inconsistent tool interactions during replay setup", () => {
    const duplicateCallEvents: TraceEvent[] = [
      { type: "tool_call", callId: "c1", tool: "shell", args: {} },
      { type: "tool_call", callId: "c1", tool: "shell", args: {} }
    ];
    const mismatchedResultEvents: TraceEvent[] = [
      { type: "tool_call", callId: "c1", tool: "shell", args: {} },
      { type: "tool_result", callId: "c1", tool: "http", ok: true, result: {} }
    ];
    const duplicateResultEvents: TraceEvent[] = [
      { type: "tool_call", callId: "c1", tool: "shell", args: {} },
      { type: "tool_result", callId: "c1", tool: "shell", ok: true, result: {} },
      { type: "tool_result", callId: "c1", tool: "shell", ok: true, result: {} }
    ];

    expect(() => new TraceReplayer(duplicateCallEvents)).toThrow(/duplicate tool_call/);
    expect(() => new TraceReplayer(mismatchedResultEvents)).toThrow(/does not match tool_call tool/);
    expect(() => new TraceReplayer(duplicateResultEvents)).toThrow(/duplicate tool_result/);
  });
});
