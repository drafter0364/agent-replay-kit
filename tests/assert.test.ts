import { describe, expect, it } from "vitest";
import { assertTrace, renderAssertionMarkdown } from "../src/index.js";
import type { TraceEvent } from "../src/types.js";

const events: TraceEvent[] = [
  { type: "tool_call", callId: "c1", tool: "read_file", args: { path: "README.md" } },
  { type: "tool_call", callId: "c2", tool: "shell", args: { command: "npm test" } },
  { type: "tool_call", callId: "c3", tool: "shell", args: { command: "rm -rf dist" } }
];

describe("trace assertions", () => {
  it("passes required tool assertions", () => {
    const report = assertTrace(events, { mustCall: ["read_file"], mustNotCall: ["send_message"] });

    expect(report.ok).toBe(true);
  });

  it("fails shell count and forbidden command assertions", () => {
    const report = assertTrace(events, { maxShellCalls: 1, forbiddenCommandPatterns: ["rm -rf"] });

    expect(report.ok).toBe(false);
    expect(renderAssertionMarkdown(report)).toContain("FAIL");
  });
});
