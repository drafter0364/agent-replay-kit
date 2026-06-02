import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { readTraceFile } from "../src/index.js";
import { withTempDir } from "./helpers.js";

describe("CLI", () => {
  it("records, inspects, replays, and asserts a trace", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl");
      const output: string[] = [];
      const io = { stdout: (text: string) => output.push(text), stderr: (text: string) => output.push(text) };

      await expect(
        runCli([
          "record",
          "--out",
          tracePath,
          "--tool",
          "shell",
          "--args-json",
          "{\"command\":\"npm test\"}",
          "--result-json",
          "{\"exitCode\":0}"
        ], io)
      ).resolves.toBe(0);

      expect((await readTraceFile(tracePath)).length).toBe(4);
      await expect(runCli(["inspect", tracePath, "--format", "json"], io)).resolves.toBe(0);
      await expect(runCli(["validate", tracePath, "--format", "json"], io)).resolves.toBe(0);
      await expect(runCli(["replay", tracePath, "--tool", "shell", "--args-json", "{\"command\":\"npm test\"}"], io)).resolves.toBe(0);
      const sanitizedPath = join(dir, "public.jsonl");
      await expect(runCli(["sanitize", tracePath, "--out", sanitizedPath, "--format", "json"], io)).resolves.toBe(0);
      expect((await readTraceFile(sanitizedPath)).length).toBe(4);
      await expect(runCli(["assert", tracePath, "--must-call", "shell"], io)).resolves.toBe(0);
      expect(output.join("")).toContain("\"exitCode\": 0");
      expect(output.join("")).toContain("\"eventCount\": 4");
      expect(output.join("")).toContain("\"redactionCount\"");
    });
  });

  it("returns failing exit codes for changed diffs and failed assertions", async () => {
    await withTempDir(async (dir) => {
      const one = join(dir, "one.jsonl");
      const two = join(dir, "two.jsonl");
      const io = { stdout: (_text: string) => undefined, stderr: (_text: string) => undefined };

      await runCli(["record", "--out", one, "--tool", "shell", "--args-json", "{\"command\":\"npm test\"}"], io);
      await runCli(["record", "--out", two, "--tool", "shell", "--args-json", "{\"command\":\"npm run build\"}"], io);

      await expect(runCli(["diff", one, two], io)).resolves.toBe(1);
      await expect(runCli(["assert", one, "--must-not-call", "shell"], io)).resolves.toBe(1);
    });
  });

  it("loads assertion policy files", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl");
      const policyPath = join(dir, "policy.json");
      const io = { stdout: (_text: string) => undefined, stderr: (_text: string) => undefined };

      await runCli(["record", "--out", tracePath, "--tool", "shell", "--args-json", "{\"command\":\"npm test\"}"], io);
      await import("node:fs/promises").then(({ writeFile }) =>
        writeFile(policyPath, JSON.stringify({ mustCall: ["shell"], forbiddenCommandPrefixes: ["rm -rf"] }), "utf8")
      );

      await expect(runCli(["assert", tracePath, "--policy", policyPath], io)).resolves.toBe(0);
    });
  });

  it("reports validation failures from the CLI", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "invalid.jsonl");
      await import("node:fs/promises").then(({ writeFile }) =>
        writeFile(tracePath, "{\"type\":\"tool_call\",\"callId\":\"c1\",\"tool\":\"shell\",\"args\":{}}\n", "utf8")
      );
      const output: string[] = [];
      const io = { stdout: (text: string) => output.push(text), stderr: (text: string) => output.push(text) };

      await expect(runCli(["validate", tracePath], io)).resolves.toBe(1);
      expect(output.join("")).toContain("trace-missing-session-start");
    });
  });
});
