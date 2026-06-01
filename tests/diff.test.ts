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
});
