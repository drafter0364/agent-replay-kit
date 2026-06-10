import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { readTraceFile, writeTraceFile } from "../src/index.js";
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
      await expect(runCli(["inspect", tracePath, "--format", "timeline-json"], io)).resolves.toBe(0);
      await expect(runCli(["analyze", tracePath, "--format", "json"], io)).resolves.toBe(0);
      await expect(runCli(["export-otel", tracePath], io)).resolves.toBe(0);
      await expect(runCli(["validate", tracePath, "--format", "json"], io)).resolves.toBe(0);
      await expect(runCli(["replay", tracePath, "--tool", "shell", "--args-json", "{\"command\":\"npm test\"}"], io)).resolves.toBe(0);
      await expect(runCli(["replay", tracePath, "--call-id", "call_1"], io)).resolves.toBe(1);
      const sanitizedPath = join(dir, "public.jsonl");
      await expect(runCli(["sanitize", tracePath, "--out", sanitizedPath, "--format", "json"], io)).resolves.toBe(0);
      expect((await readTraceFile(sanitizedPath)).length).toBe(4);
      await expect(runCli(["bundle", tracePath, "--out", join(dir, "repro.zip"), "--format", "json"], io)).resolves.toBe(0);
      await expect(runCli(["assert", tracePath, "--must-call", "shell"], io)).resolves.toBe(0);
      expect(output.join("")).toContain("\"exitCode\": 0");
      expect(output.join("")).toContain("\"eventCount\": 4");
      expect(output.join("")).toContain("\"slowestTools\"");
      expect(output.join("")).toContain("\"findings\": 0");
      expect(output.join("")).toContain("\"serviceName\": \"agent-replay-kit\"");
      expect(output.join("")).toContain("\"redactionCount\"");
      expect(output.join("")).toContain("\"manifest\"");
    });
  });

  it("filters traces from the CLI", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl");
      const filteredPath = join(dir, "filtered.jsonl");
      const io = { stdout: (_text: string) => undefined, stderr: (_text: string) => undefined };

      await import("node:fs/promises").then(({ writeFile }) =>
        writeFile(
          tracePath,
          [
            "{\"type\":\"session_start\",\"schemaVersion\":\"1.0\",\"sessionId\":\"s1\"}",
            "{\"type\":\"tool_call\",\"callId\":\"c1\",\"tool\":\"shell\",\"args\":{\"command\":\"npm test\"},\"metadata\":{\"sideEffect\":\"write\"}}",
            "{\"type\":\"tool_result\",\"callId\":\"c1\",\"tool\":\"shell\",\"ok\":true,\"result\":{\"exitCode\":0}}",
            "{\"type\":\"tool_call\",\"callId\":\"c2\",\"tool\":\"read_file\",\"args\":{\"path\":\"README.md\"},\"metadata\":{\"sideEffect\":\"read\"}}",
            "{\"type\":\"tool_result\",\"callId\":\"c2\",\"tool\":\"read_file\",\"ok\":false,\"error\":{\"message\":\"missing\"}}",
            "{\"type\":\"session_end\",\"ok\":true}"
          ].join("\n") + "\n",
          "utf8"
        )
      );

      await expect(runCli(["filter", tracePath, "--out", filteredPath, "--tool", "read_file", "--ok", "false"], io)).resolves.toBe(0);
      expect((await readTraceFile(filteredPath)).map((event) => event.type)).toEqual([
        "session_start",
        "tool_call",
        "tool_result",
        "session_end"
      ]);
    });
  });

  it("seals and verifies trace integrity from the CLI", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl");
      const sealedPath = join(dir, "sealed.jsonl");
      const io = { stdout: (_text: string) => undefined, stderr: (_text: string) => undefined };

      await runCli(["record", "--out", tracePath, "--tool", "shell", "--args-json", "{\"command\":\"npm test\"}"], io);

      await expect(runCli(["seal", tracePath, "--out", sealedPath], io)).resolves.toBe(0);
      await expect(runCli(["verify-integrity", sealedPath], io)).resolves.toBe(0);
      await expect(runCli(["verify-integrity", tracePath], io)).resolves.toBe(1);
    });
  });

  it("passes sanitizer URL allowlist hosts through the CLI", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl");
      const sanitizedPath = join(dir, "public.jsonl");
      const io = { stdout: (_text: string) => undefined, stderr: (_text: string) => undefined };

      await runCli(
        [
          "record",
          "--out",
          tracePath,
          "--tool",
          "http",
          "--args-json",
          "{\"url\":\"https://github.com/drafter0364/agent-replay-kit\"}",
          "--result-json",
          "{\"ok\":true}"
        ],
        io
      );
      await expect(runCli(["sanitize", tracePath, "--out", sanitizedPath, "--allow-url-host", "github.com"], io)).resolves.toBe(0);

      expect(JSON.stringify(await readTraceFile(sanitizedPath))).toContain("https://github.com/drafter0364/agent-replay-kit");
    });
  });

  it("replays recorded results by call id from the CLI", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl");
      await import("node:fs/promises").then(({ writeFile }) =>
        writeFile(
          tracePath,
          [
            "{\"type\":\"session_start\",\"schemaVersion\":\"1.0\",\"sessionId\":\"s1\"}",
            "{\"type\":\"tool_call\",\"callId\":\"c1\",\"tool\":\"shell\",\"args\":{\"command\":\"npm test\"}}",
            "{\"type\":\"tool_result\",\"callId\":\"c1\",\"tool\":\"shell\",\"ok\":true,\"result\":{\"exitCode\":0}}",
            "{\"type\":\"session_end\",\"ok\":true}"
          ].join("\n") + "\n",
          "utf8"
        )
      );
      const output: string[] = [];
      const io = { stdout: (text: string) => output.push(text), stderr: (text: string) => output.push(text) };

      await expect(runCli(["replay", tracePath, "--call-id", "c1", "--tool", "shell"], io)).resolves.toBe(0);
      expect(output.join("")).toContain("\"exitCode\": 0");
    });
  });

  it("prints help and reports common argument errors", async () => {
    const output: string[] = [];
    const io = { stdout: (text: string) => output.push(text), stderr: (text: string) => output.push(text) };

    await expect(runCli(["--help"], io)).resolves.toBe(0);
    await expect(runCli(["unknown"], io)).resolves.toBe(2);
    await expect(runCli(["record", "--out", "trace.jsonl"], io)).resolves.toBe(1);
    await expect(runCli(["record", "--out", "trace.jsonl", "--tool", "shell", "--args-json", "{"], io)).resolves.toBe(1);

    expect(output.join("")).toContain("agent-replay <command>");
    expect(output.join("")).toContain("Unknown command");
    expect(output.join("")).toContain("Missing --tool");
    expect(output.join("")).toContain("Failed to parse --args-json");
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

      await import("node:fs/promises").then(({ writeFile }) =>
        writeFile(
          two,
          [
            "{\"type\":\"session_start\",\"schemaVersion\":\"1.0\",\"sessionId\":\"s1\"}",
            "{\"type\":\"tool_call\",\"callId\":\"c1\",\"tool\":\"shell\",\"args\":{\"command\":\"npm test\"}}",
            "{\"type\":\"tool_result\",\"callId\":\"c1\",\"tool\":\"shell\",\"ok\":false,\"error\":{\"message\":\"failed\"}}",
            "{\"type\":\"session_end\",\"ok\":true}"
          ].join("\n") + "\n",
          "utf8"
        )
      );
      await expect(runCli(["analyze", two], io)).resolves.toBe(1);
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
      await expect(runCli(["test", "--baseline", tracePath, "--actual", tracePath, "--policy", policyPath], io)).resolves.toBe(0);
    });
  });

  it("loads command options from a config file and lets CLI flags override them", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl");
      const configPath = join(dir, "assert-config.json");
      const io = { stdout: (_text: string) => undefined, stderr: (_text: string) => undefined };

      await runCli(["record", "--out", tracePath, "--tool", "shell", "--args-json", "{\"command\":\"npm test\"}"], io);
      await import("node:fs/promises").then(({ writeFile }) =>
        writeFile(configPath, JSON.stringify({ mustCall: ["shell"], maxShellCalls: 0, format: "json" }), "utf8")
      );

      await expect(runCli(["assert", tracePath, "--config-file", configPath, "--max-shell-calls", "2"], io)).resolves.toBe(0);
      await expect(runCli(["assert", tracePath, "--config-file", configPath], io)).resolves.toBe(1);
    });
  });

  it("reports invalid config files as command failures", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl");
      const configPath = join(dir, "bad-config.json");
      const output: string[] = [];
      const io = { stdout: (text: string) => output.push(text), stderr: (text: string) => output.push(text) };

      await runCli(["record", "--out", tracePath, "--tool", "shell", "--args-json", "{\"command\":\"npm test\"}"], io);
      await import("node:fs/promises").then(({ writeFile }) => writeFile(configPath, "[1,2,3]", "utf8"));

      await expect(runCli(["assert", tracePath, "--config-file", configPath], io)).resolves.toBe(1);
      expect(output.join("")).toContain("Config file");
      expect(output.join("")).toContain("must be a JSON object");
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

  it("validates gzip trace files from the CLI", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl.gz");
      const io = { stdout: (_text: string) => undefined, stderr: (_text: string) => undefined };

      await writeTraceFile(tracePath, [
        { type: "session_start", schemaVersion: "1.0", sessionId: "s1", seq: 1 },
        { type: "session_end", sessionId: "s1", ok: true, seq: 2 }
      ]);

      await expect(runCli(["validate", tracePath], io)).resolves.toBe(0);
    });
  });
});
