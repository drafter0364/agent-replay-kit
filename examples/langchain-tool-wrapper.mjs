import { tool as langChainTool } from "@langchain/core/tools";
import * as z from "zod";
import { createRecorder, createReplayerFromFile } from "../dist/index.js";

// Requires: npm install @langchain/core zod.

export function createLangChainTraceAdapter(recorder) {
  return {
    tool(execute, options) {
      const { name, description, schema, sideEffect = "read", risk = "low" } = options;
      if (!name) {
        throw new Error("LangChain trace adapter requires a stable tool name");
      }

      return langChainTool(
        async (input, config) => {
          return recorder.tool(
            name,
            input ?? {},
            () => execute(input, config),
            {
              framework: "langchain-js",
              frameworkRunId: typeof config?.runId === "string" ? config.runId : undefined,
              sideEffect,
              risk
            }
          );
        },
        {
          name,
          description,
          schema
        }
      );
    }
  };
}

const tracePath = "traces/langchain-tool-wrapper.jsonl";
const recorder = createRecorder(tracePath, { agent: "langchain-example" });
const adapter = createLangChainTraceAdapter(recorder);

const readFile = adapter.tool(
  async ({ path }) => `read ${path}`,
  {
    name: "read_file",
    description: "Read a file from the repository",
    schema: z.object({ path: z.string() }),
    sideEffect: "read",
    risk: "low"
  }
);

await recorder.start({ prompt: "inspect the README" });
await readFile.invoke({ path: "README.md" });
await recorder.end({ ok: true });

const replayer = await createReplayerFromFile(tracePath);
console.log(replayer.replayTool("read_file", { path: "README.md" }));
