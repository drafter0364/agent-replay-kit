import { describe, expect, it } from "vitest";
import { diffTraces, renderTraceDiffMarkdown } from "../src/index.js";
import type { TraceEvent } from "../src/types.js";

describe("trace diff", () => {
  it("ignores timestamp and sequence churn", () => {
    const before: TraceEvent[] = [{ type: "tool_call", seq: 1, timestamp: "a", callId: "c1", tool: "shell", args: {} }];
    const after: TraceEvent[] = [{ type: "tool_call", seq: 9, timestamp: "b", callId: "c1", tool: "shell", args: {} }];

    expect(diffTraces(before, after).changed).toBe(false);
  });

  it("reports modified events", () => {
    const before: TraceEvent[] = [{ type: "tool_call", callId: "c1", tool: "shell", args: { command: "npm test" } }];
    const after: TraceEvent[] = [{ type: "tool_call", callId: "c1", tool: "shell", args: { command: "npm run build" } }];
    const diff = diffTraces(before, after);

    expect(diff.summary.modified).toBe(1);
    expect(renderTraceDiffMarkdown(diff)).toContain("Changed tool_call -> tool_call");
  });

  it("handles empty trace arrays", () => {
    expect(diffTraces([], []).changed).toBe(false);
    expect(diffTraces([], []).summary).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 0 });

    const single: TraceEvent[] = [{ type: "tool_call", callId: "c1", tool: "shell", args: {} }];
    expect(diffTraces([], single).summary.added).toBe(1);
    expect(diffTraces(single, []).summary.removed).toBe(1);
  });

  it("reports removed events when before has more entries", () => {
    const before: TraceEvent[] = [
      { type: "tool_call", callId: "c1", tool: "shell", args: {} },
      { type: "tool_call", callId: "c2", tool: "read_file", args: {} }
    ];
    const after: TraceEvent[] = [{ type: "tool_call", callId: "c1", tool: "shell", args: {} }];
    const diff = diffTraces(before, after);

    expect(diff.changed).toBe(true);
    expect(diff.summary.removed).toBe(1);
    expect(diff.changes[0].kind).toBe("removed");
  });

  it("reports added events when after has more entries", () => {
    const before: TraceEvent[] = [{ type: "tool_call", callId: "c1", tool: "shell", args: {} }];
    const after: TraceEvent[] = [
      { type: "tool_call", callId: "c1", tool: "shell", args: {} },
      { type: "tool_call", callId: "c2", tool: "read_file", args: {} }
    ];
    const diff = diffTraces(before, after);

    expect(diff.changed).toBe(true);
    expect(diff.summary.added).toBe(1);
    expect(diff.changes[0].kind).toBe("added");
  });

  it("semantically matches tool calls by callId when model messages are inserted", () => {
    const before: TraceEvent[] = [
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1" },
      { type: "tool_call", callId: "c1", tool: "shell", args: { command: "npm test" } },
      { type: "tool_result", callId: "c1", tool: "shell", ok: true, result: { exitCode: 0 } },
      { type: "session_end", ok: true }
    ];
    const after: TraceEvent[] = [
      { type: "session_start", schemaVersion: "1.0", sessionId: "s1" },
      { type: "model_message", role: "assistant", content: "I will run tests." },
      { type: "tool_call", callId: "c1", tool: "shell", args: { command: "npm test" } },
      { type: "tool_result", callId: "c1", tool: "shell", ok: true, result: { exitCode: 0 } },
      { type: "session_end", ok: true }
    ];
    const diff = diffTraces(before, after, { mode: "semantic" });

    expect(diff.mode).toBe("semantic");
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].after?.type).toBe("model_message");
  });
});
