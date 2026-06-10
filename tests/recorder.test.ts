import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRecorder, readTraceFile } from "../src/index.js";
import { withTempDir } from "./helpers.js";

describe("TraceRecorder", () => {
  it("records a session and wrapped tool result", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl");
      const recorder = createRecorder(tracePath, { sessionId: "session_1", agent: "demo-agent" });

      await recorder.start({ prompt: "check repo" });
      const result = await recorder.tool("shell", { command: "npm test" }, () => ({ exitCode: 0 }));
      await recorder.end({ ok: true });

      expect(result).toEqual({ exitCode: 0 });
      const events = await readTraceFile(tracePath);
      expect(events.map((event) => event.type)).toEqual(["session_start", "tool_call", "tool_result", "session_end"]);
      expect(events[0]).toMatchObject({ sessionId: "session_1", agent: "demo-agent" });
      expect(events[2]).toMatchObject({ type: "tool_result", ok: true, result: { exitCode: 0 } });
    });
  });

  it("records failed tools before rethrowing", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl");
      const recorder = createRecorder(tracePath, { sessionId: "session_2" });
      await recorder.start();

      await expect(
        recorder.tool("http", { url: "https://example.test" }, () => {
          throw new Error("network failed");
        })
      ).rejects.toThrow("network failed");

      const events = await readTraceFile(tracePath);
      expect(events[2]).toMatchObject({
        type: "tool_result",
        ok: false,
        error: { message: "network failed" }
      });
    });
  });

  it("enforces the recorder lifecycle", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl");
      const recorder = createRecorder(tracePath);

      await expect(recorder.tool("shell", { command: "npm test" }, () => ({ exitCode: 0 }))).rejects.toThrow(
        "requires start()"
      );

      await recorder.start();
      await expect(recorder.start()).rejects.toThrow("can only be called once");
      await recorder.end({ ok: true });

      await expect(recorder.modelMessage({ role: "assistant", content: "done" })).rejects.toThrow("after end()");
      await expect(recorder.end({ ok: true })).rejects.toThrow("after end()");
    });
  });

  it("uses monotonic sequence numbers", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl");
      const recorder = createRecorder(tracePath, { sessionId: "session_seq" });

      await recorder.start();
      await recorder.tool("read_file", { path: "README.md" }, () => "ok");
      await recorder.end({ ok: true });

      const events = await readTraceFile(tracePath);
      expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    });
  });

  it("allows adapters to preserve framework call ids", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl");
      const recorder = createRecorder(tracePath, { sessionId: "session_adapter" });

      await recorder.start();
      await recorder.tool("mcp.read_file", { path: "README.md" }, () => "ok", { framework: "mcp" }, "mcp_call_1");
      await recorder.end({ ok: true });

      const events = await readTraceFile(tracePath);
      expect(events[1]).toMatchObject({ type: "tool_call", callId: "mcp_call_1", metadata: { framework: "mcp" } });
      expect(events[2]).toMatchObject({ type: "tool_result", callId: "mcp_call_1" });
    });
  });

  it("rejects invalid recorder options at construction time", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl");

      expect(() => createRecorder(tracePath, { sessionId: "" })).toThrow("RecorderOptions.sessionId must be a non-empty string");
      expect(() => createRecorder(tracePath, { agent: 123 as never })).toThrow("RecorderOptions.agent must be a string");
      expect(() => createRecorder(tracePath, { runId: 123 as never })).toThrow("RecorderOptions.runId must be a string");
      expect(() => createRecorder(tracePath, { metadata: [] as never })).toThrow("RecorderOptions.metadata must be a JSON object");
      expect(() => createRecorder(tracePath, { metadata: { invalid: undefined } as never })).toThrow(
        "RecorderOptions.metadata must be a JSON object"
      );
    });
  });

  it("rejects invalid event payloads before writing them", async () => {
    await withTempDir(async (dir) => {
      const tracePath = join(dir, "trace.jsonl");
      const recorder = createRecorder(tracePath);

      await recorder.start();
      await expect(recorder.modelMessage({ role: "narrator" as never, content: "bad role" })).rejects.toThrow(
        "model_message.role must be system, user, assistant, or tool"
      );
      await expect(recorder.toolCall("shell", undefined as never)).rejects.toThrow("tool_call.args is required");
      await expect(recorder.end({ metadata: [] as never })).rejects.toThrow("event.metadata must be a JSON object");
      await recorder.end({ ok: true });

      const events = await readTraceFile(tracePath);
      expect(events.map((event) => event.type)).toEqual(["session_start", "session_end"]);
      expect(events.map((event) => event.seq)).toEqual([1, 2]);
    });
  });
});
