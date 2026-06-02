import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendTraceEvent, readTraceFile, writeTraceFile } from "../src/index.js";
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
});
