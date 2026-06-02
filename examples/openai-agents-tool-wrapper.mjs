import { Agent, run, tool as openaiTool } from "@openai/agents";
import { z } from "zod";
import { createRecorder, createReplayerFromFile } from "../dist/index.js";

// Requires: npm install @openai/agents zod, plus an OpenAI API key in the environment.

export function createOpenAIAgentsTraceAdapter(recorder) {
  return {
    tool(options) {
      const { execute, sideEffect = "read", risk = "low", ...toolOptions } = options;
      if (!toolOptions.name) {
        throw new Error("OpenAI Agents trace adapter requires a stable tool name");
      }

      return openaiTool({
        ...toolOptions,
        async execute(input, context, details) {
          return recorder.tool(
            toolOptions.name,
            input ?? {},
            () => execute(input, context, details),
            {
              framework: "openai-agents-js",
              provider: "openai",
              sideEffect,
              risk
            }
          );
        }
      });
    },

    async run(agent, input, runOptions) {
      await recorder.start({ input });
      try {
        const result = await run(agent, input, runOptions);
        await recorder.end({ ok: true, summary: summarizeRunResult(result) });
        return result;
      } catch (error) {
        await recorder.end({ ok: false, summary: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }
  };
}

const tracePath = "traces/openai-agents-tool-wrapper.jsonl";
const recorder = createRecorder(tracePath, { agent: "openai-agents-example" });
const adapter = createOpenAIAgentsTraceAdapter(recorder);

const getWeather = adapter.tool({
  name: "get_weather",
  description: "Get the weather for a given city",
  parameters: z.object({ city: z.string() }),
  sideEffect: "network",
  risk: "low",
  async execute({ city }) {
    return `The weather in ${city} is sunny.`;
  }
});

const agent = new Agent({
  name: "Weather assistant",
  instructions: "Answer weather questions by using tools.",
  tools: [getWeather]
});

await adapter.run(agent, "What is the weather in San Francisco?");

const replayer = await createReplayerFromFile(tracePath);
console.log(replayer.replayTool("get_weather", { city: "San Francisco" }));

function summarizeRunResult(result) {
  if (typeof result?.finalOutput === "string") {
    return result.finalOutput;
  }
  return "OpenAI Agents SDK run completed";
}
