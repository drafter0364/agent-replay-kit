import { createRecorder, createReplayerFromFile } from "../dist/index.js";

export function createRecordedTools(recorder) {
  return {
    readFile: (path, readFileImpl) => {
      return recorder.tool("read_file", { path }, () => readFileImpl(path));
    },
    shell: (command, shellImpl) => {
      return recorder.tool("shell", { command }, () => shellImpl(command));
    }
  };
}

const tracePath = "traces/tool-wrapper.jsonl";
const recorder = createRecorder(tracePath, { agent: "tool-wrapper-example" });
await recorder.start();

const tools = createRecordedTools(recorder);
await tools.readFile("README.md", async (path) => `read ${path}`);
await tools.shell("npm test", async (command) => ({ command, exitCode: 0 }));
await recorder.end({ ok: true });

const replayer = await createReplayerFromFile(tracePath);
console.log(replayer.replayTool("read_file", { path: "README.md" }));
console.log(replayer.replayTool("shell", { command: "npm test" }));
