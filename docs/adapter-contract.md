# Adapter Contract

Agent Replay Kit adapters translate a framework-specific agent run into the framework-neutral JSONL trace schema. Keep adapters thin: they should map lifecycle events, preserve useful metadata, and avoid changing the core replay semantics.

## Mapping model

| Framework concept | Trace event |
|---|---|
| Agent run starts | `session_start` |
| User/model text message | `model_message` |
| Model proposes a tool call | `model_message.toolCalls` and/or `tool_call` |
| Tool execution starts | `tool_call` |
| Tool execution succeeds | `tool_result` with `ok: true` |
| Tool execution fails | `tool_result` with `ok: false` |
| Agent run finishes | `session_end` |

## Required adapter behavior

Adapters should:

- Call `recorder.start()` exactly once before recording tools.
- Call `recorder.end()` exactly once after the run completes or fails.
- Preserve the framework's tool call id when one exists.
- Use stable tool names that match the agent framework's public tool identifiers.
- Store framework-specific fields under `metadata`, not top-level schema fields.
- Treat prompt, model output, tool args, and tool results as untrusted trace content.
- Keep replay deterministic: do not add fuzzy matching or model-dependent behavior in an adapter.

## Metadata conventions

Adapters may add the following metadata keys:

```json
{
  "framework": "mcp",
  "frameworkRunId": "run_123",
  "provider": "openai",
  "model": "gpt-4.1",
  "sideEffect": "read",
  "risk": "low"
}
```

Supported `sideEffect` values:

- `read`
- `write`
- `network`
- `external-state`
- `secret-access`

These values are optional but useful for policy assertions and timeline summaries.

Policy files can constrain side effects:

```json
{
  "forbiddenSideEffects": ["external-state"],
  "maxSideEffectCalls": {
    "network": 1
  },
  "requiredSideEffectOrder": ["read", "write"]
}
```

## Adapter shape

A minimal adapter should expose a wrapper rather than require users to rewrite their agent:

```ts
import { createRecorder } from "agent-replay-kit";

const recorder = createRecorder("traces/run.jsonl", {
  agent: "my-framework-agent"
});

await recorder.start({ prompt: "inspect this repository" });

const result = await recorder.tool(
  "read_file",
  { path: "README.md" },
  () => framework.tools.readFile("README.md"),
  {
    framework: "my-framework",
    sideEffect: "read",
    risk: "low"
  }
);

await recorder.end({ ok: true });
```

See `examples/mcp-tool-wrapper.mjs` for a runnable MCP-style tool adapter example that does not require an MCP SDK dependency.
See `examples/openai-agents-tool-wrapper.mjs` for an OpenAI Agents SDK function-tool wrapper example. It intentionally keeps `@openai/agents` outside the core package dependencies.

## Error mapping

When a framework tool fails, adapters should still emit a `tool_result` event:

```json
{
  "type": "tool_result",
  "callId": "call_1",
  "tool": "shell",
  "ok": false,
  "error": {
    "name": "Error",
    "message": "command failed"
  }
}
```

Do not swallow tool errors. Record them, then preserve the framework's normal error behavior.

## Package boundaries

Core must remain framework-neutral. Framework adapters should live in examples, adapter packages, or clearly separated modules. They should not add OpenAI, LangChain, MCP, or OpenTelemetry dependencies to the core package unless the project intentionally creates a dedicated integration package.
