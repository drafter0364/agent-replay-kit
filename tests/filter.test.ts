import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filterTrace, filterTraceFile, readTraceFile, writeTraceFile } from "../src/index.js";
import type { TraceEvent } from "../src/types.js";
import { withTempDir } from "./helpers.js";

const events: TraceEvent[] = [
  { type: "session_start", schemaVersion: "1.0", sessionId: "s1", seq: 1 },
  { type: "model_message", sessionId: "s1", role: "assistant", content: "checking tools", seq: 2 },
  {
    type: "tool_call",
    sessionId: "s1",
    callId: "c1",
    tool: "shell",
    args: { command: "npm test" },
    metadata: { sideEffect: "write", framework: "local", audit: { retries: 0 } },
    seq: 3
  },
  { type: "tool_result", sessionId: "s1", callId: "c1", tool: "shell", ok: true, result: { exitCode: 0 }, seq: 4 },
  {
    type: "tool_call",
    sessionId: "s1",
    callId: "c2",
    tool: "read_file",
    args: { path: "README.md" },
    metadata: { sideEffect: "read", framework: "mcp", audit: { retries: 1 } },
    seq: 5
  },
  { type: "tool_result", sessionId: "s1", callId: "c2", tool: "read_file", ok: false, error: { message: "missing" }, seq: 6 },
  { type: "session_end", sessionId: "s1", ok: false, seq: 7 }
];

describe("trace filter", () => {
  it("returns the original trace when no filters are set", () => {
    expect(filterTrace(events)).toEqual(events);
  });

  it("filters matching tool interactions and keeps session boundaries", () => {
    const filtered = filterTrace(events, { tools: ["shell"] });

    expect(filtered.map((event) => event.type)).toEqual(["session_start", "tool_call", "tool_result", "session_end"]);
    expect(filtered[1]).toMatchObject({ type: "tool_call", tool: "shell", callId: "c1" });
    expect(filtered[2]).toMatchObject({ type: "tool_result", tool: "shell", callId: "c1", ok: true });
  });

  it("supports side-effect and ok filters", () => {
    const filtered = filterTrace(events, { sideEffects: ["read"], ok: false });

    expect(filtered.map((event) => event.type)).toEqual(["session_start", "tool_call", "tool_result", "session_end"]);
    expect(filtered[1]).toMatchObject({ tool: "read_file", callId: "c2" });
    expect(filtered[2]).toMatchObject({ tool: "read_file", callId: "c2", ok: false });
  });

  it("supports metadata filtering with dotted paths", () => {
    const filtered = filterTrace(events, { metadata: { framework: "mcp", "audit.retries": 1 } });

    expect(filtered.map((event) => event.type)).toEqual(["session_start", "tool_call", "tool_result", "session_end"]);
    expect(filtered[1]).toMatchObject({ tool: "read_file", callId: "c2" });
    expect(filtered[2]).toMatchObject({ tool: "read_file", callId: "c2", ok: false });
  });

  it("writes filtered traces to disk", async () => {
    await withTempDir(async (dir) => {
      const inputPath = join(dir, "trace.jsonl");
      const outputPath = join(dir, "filtered.jsonl");
      await writeTraceFile(inputPath, events);

      const report = await filterTraceFile(inputPath, outputPath, { callIds: ["c2"] });

      expect(report).toEqual({
        inputEventCount: 7,
        outputEventCount: 4,
        matchedInteractionCount: 1
      });
    });
  });

  it("preserves order for interleaved calls and late results", async () => {
    await withTempDir(async (dir) => {
      const inputPath = join(dir, "trace.jsonl");
      const outputPath = join(dir, "filtered.jsonl");
      const interleavedEvents: TraceEvent[] = [
        { type: "session_start", schemaVersion: "1.0", sessionId: "s1" },
        { type: "tool_call", callId: "c1", tool: "shell", args: { command: "npm test" } },
        { type: "tool_call", callId: "c2", tool: "read_file", args: { path: "README.md" } },
        { type: "tool_result", callId: "c1", tool: "shell", ok: true, result: { exitCode: 0 } },
        { type: "tool_result", callId: "c2", tool: "read_file", ok: true, result: "ok" },
        { type: "session_end", ok: true }
      ];
      await writeTraceFile(inputPath, interleavedEvents);

      const report = await filterTraceFile(inputPath, outputPath, { tools: ["shell", "read_file"] });
      const filtered = await readTraceFile(outputPath);

      expect(report.matchedInteractionCount).toBe(2);
      expect(filtered.map((event: TraceEvent) => event.type)).toEqual([
        "session_start",
        "tool_call",
        "tool_call",
        "tool_result",
        "tool_result",
        "session_end"
      ]);
      expect(filtered[1]).toMatchObject({ callId: "c1" });
      expect(filtered[2]).toMatchObject({ callId: "c2" });
      expect(filtered[3]).toMatchObject({ callId: "c1" });
      expect(filtered[4]).toMatchObject({ callId: "c2" });
    });
  });
});
