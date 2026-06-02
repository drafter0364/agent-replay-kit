import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendTraceEvent, readTraceFile, readTraceFileStream, writeTraceFile } from "../src/index.js";
import { withTempDir } from "./helpers.js";

describe("trace io", () => {
  it("writes, appends, and reads trace files", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "nested", "trace.jsonl");
      await writeTraceFile(tracePath, [{ type: "session_start", schemaVersion: "1.0", sessionId: "s1" }]);
      await appendTraceEvent(tracePath, { type: "session_end", ok: true });

      expect((await readTraceFile(tracePath)).map((event) => event.type)).toEqual(["session_start", "session_end"]);
    });
  });

  it("adds file context to read errors", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "missing.jsonl");

      await expect(readTraceFile(tracePath)).rejects.toThrow(`Failed to read trace file ${tracePath}`);
    });
  });

  it("reads traces as an async stream", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl");
      await writeTraceFile(tracePath, [
        { type: "session_start", schemaVersion: "1.0", sessionId: "s1" },
        { type: "session_end", ok: true }
      ]);

      const types: string[] = [];
      for await (const event of readTraceFileStream(tracePath)) {
        types.push(event.type);
      }

      expect(types).toEqual(["session_start", "session_end"]);
    });
  });

  it("reads and writes gzip trace files", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl.gz");
      await writeTraceFile(tracePath, [
        { type: "session_start", schemaVersion: "1.0", sessionId: "s1" },
        { type: "session_end", ok: true }
      ]);

      expect((await readTraceFile(tracePath)).map((event) => event.type)).toEqual(["session_start", "session_end"]);
      await expect(appendTraceEvent(tracePath, { type: "session_end" })).rejects.toThrow("Cannot append trace events to gzip");
    });
  });
});
