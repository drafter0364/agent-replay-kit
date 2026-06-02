import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundleTraceFile, writeTraceFile } from "../src/index.js";
import { withTempDir } from "./helpers.js";

describe("trace repro bundle", () => {
  it("writes a zip bundle with sanitized trace, report, environment, and policy", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "private.jsonl");
      const policyPath = join(dir, "agent-replay.policy.json");
      const outPath = join(dir, "repro.zip");

      await writeTraceFile(tracePath, [
        { type: "session_start", schemaVersion: "1.0", sessionId: "s1", seq: 1 },
        {
          type: "tool_call",
          callId: "c1",
          tool: "http",
          args: { apiKey: "sk-testsecret123456", url: "https://private.example.com" },
          seq: 2
        },
        { type: "tool_result", callId: "c1", tool: "http", ok: true, result: "ok", seq: 3 },
        { type: "session_end", ok: true, seq: 4 }
      ]);
      await writeFile(policyPath, JSON.stringify({ mustCall: ["http"] }), "utf8");

      const manifest = await bundleTraceFile(tracePath, outPath, {
        policyPath,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        packageVersion: "test"
      });
      const zip = await readFile(outPath);
      const zipText = zip.toString("utf8");

      expect(zip.subarray(0, 2).toString("utf8")).toBe("PK");
      expect(manifest.files.policy).toBe("policy.json");
      expect(zipText).toContain("manifest.json");
      expect(zipText).toContain("trace.sanitized.jsonl");
      expect(zipText).toContain("redaction-report.json");
      expect(zipText).toContain("environment.json");
      expect(zipText).toContain("policy.json");
      expect(zipText).not.toContain("sk-testsecret123456");
      expect(zipText).not.toContain("private.example.com");
      expect(zipText).toContain("[REDACTED]");
      expect(zipText).toContain("\"mustCall\":[\"http\"]");
    });
  });
});
