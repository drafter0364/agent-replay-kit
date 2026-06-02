import { createRecorder, createReplayerFromFile } from "../dist/index.js";

export function createMcpTraceAdapter(recorder, mcpClient) {
  return {
    async callTool(request) {
      const callId = request.id ?? undefined;
      return recorder.tool(
        request.name,
        request.arguments ?? {},
        () => mcpClient.callTool(request),
        {
          framework: "mcp",
          mcpRequestId: request.id ?? null,
          sideEffect: request.sideEffect ?? "read",
          risk: request.risk ?? "low"
        },
        callId
      );
    }
  };
}

const tracePath = "traces/mcp-tool-wrapper.jsonl";
const recorder = createRecorder(tracePath, { agent: "mcp-example-agent" });

const fakeMcpClient = {
  async callTool(request) {
    return {
      content: [{ type: "text", text: `called ${request.name}` }]
    };
  }
};

await recorder.start({ prompt: "read project metadata through MCP" });
const adapter = createMcpTraceAdapter(recorder, fakeMcpClient);
await adapter.callTool({
  id: "mcp_call_1",
  name: "repo.read_file",
  arguments: { path: "README.md" },
  sideEffect: "read",
  risk: "low"
});
await recorder.end({ ok: true });

const replayer = await createReplayerFromFile(tracePath);
console.log(replayer.replayTool("repo.read_file", { path: "README.md" }));
