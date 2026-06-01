import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRecorder, createReplayerFromFile } from "../dist/index.js";

const tracePath = fileURLToPath(new URL("../traces/basic-agent.jsonl", import.meta.url));
await mkdir(dirname(tracePath), { recursive: true });

const recorder = createRecorder(tracePath, { agent: "basic-example" });
await recorder.start({ prompt: "run a deterministic check" });

const result = await recorder.tool("shell", { command: "npm test" }, async () => {
  return { exitCode: 0, stdout: "example result" };
});

await recorder.end({ ok: result.exitCode === 0 });

const replayer = await createReplayerFromFile(tracePath);
const replayed = replayer.replayTool("shell", { command: "npm test" });

console.log(`Recorded and replayed exit code: ${replayed.exitCode}`);
