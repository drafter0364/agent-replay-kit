# Agent Replay Kit

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Agent Replay Kit is open-source infrastructure for debugging and regression-testing tool-using AI agents. It records agent tool calls as JSONL traces, replays recorded tool results, compares trace changes, sanitizes sensitive data, and turns agent behavior into CI assertions.

[Chinese README](README.zh-CN.md) | [Trace schema](docs/trace-schema.md) | [Roadmap](ROADMAP.md)

## Why this exists

Tool-using agents are hard to debug because the model, tools, and environment can all change between runs. Traditional software has logs, tests, fixtures, and replay. Agent workflows need the same primitives.

Agent Replay Kit gives maintainers a small deterministic core:

- Record tool calls and results from any agent runtime.
- Replay recorded tool results without executing side effects.
- Diff traces after prompt, model, or tool changes.
- Sanitize traces before sharing them in issues.
- Assert behavior in CI, such as required tools or forbidden shell commands.

## Quick start

From a local clone:

```bash
npm install
npm run build
```

Create a trace with the CLI:

```bash
node dist/cli.js record \
  --out traces/demo.jsonl \
  --tool shell \
  --args-json '{"command":"npm test"}' \
  --result-json '{"exitCode":0}'
```

Inspect and replay it:

```bash
node dist/cli.js inspect traces/demo.jsonl
node dist/cli.js validate traces/demo.jsonl
node dist/cli.js replay traces/demo.jsonl --tool shell --args-json '{"command":"npm test"}'
```

Add CI assertions:

```bash
node dist/cli.js assert traces/demo.jsonl \
  --must-call shell \
  --max-shell-calls 3 \
  --forbid-command-prefix "rm -rf"
```

JSON policies can also express behavior contracts: required tool order, required tool arguments, maximum tool duration, no failed tools, and successful session ending.

## SDK example

```ts
import { createRecorder, createReplayerFromFile } from "agent-replay-kit";

const recorder = createRecorder("traces/run.jsonl", {
  agent: "my-agent"
});

await recorder.start({ prompt: "check the repository" });

const result = await recorder.tool("shell", { command: "npm test" }, async () => {
  return { exitCode: 0, stdout: "tests passed" };
});

await recorder.end({ ok: result.exitCode === 0 });

const replayer = await createReplayerFromFile("traces/run.jsonl");
const replayed = replayer.replayTool("shell", { command: "npm test" });
```

## CLI reference

```text
agent-replay record --out trace.jsonl --tool name [--args-json '{}'] [--result-json '{}']
agent-replay replay trace.jsonl [--tool name --args-json '{}']
agent-replay diff old.jsonl new.jsonl [--mode positional|semantic] [--format markdown|json]
agent-replay sanitize trace.jsonl --out public.jsonl [--allow-url-host github.com] [--format text|json]
agent-replay assert trace.jsonl [--policy policy.json] [--must-call tool] [--must-not-call tool] [--max-shell-calls n]
agent-replay test --baseline golden.jsonl --actual current.jsonl [--policy policy.json]
agent-replay validate trace.jsonl [--format markdown|json]
agent-replay inspect trace.jsonl [--format markdown|json]
```

## GitHub Action

```yaml
- uses: drafter0364/agent-replay-kit@main
  with:
    mode: validate-and-assert
    trace: traces/latest.jsonl
    policy: agent-replay.policy.json
```

Supported modes are `validate`, `assert`, `validate-and-assert`, and `test`.

## Trace format

Traces are newline-delimited JSON. Each line is one event:

```json
{"type":"tool_call","callId":"call_1","tool":"shell","args":{"command":"npm test"}}
{"type":"tool_result","callId":"call_1","tool":"shell","ok":true,"result":{"exitCode":0}}
```

See [docs/trace-schema.md](docs/trace-schema.md) for the event model.

## Project status

This project is an early infrastructure toolkit. The current release focuses on a framework-neutral trace format and deterministic local workflows. Framework adapters are intentionally not part of the first version so the core stays small and auditable.

Good first contributions:

- More sanitizer rules with focused tests.
- Additional CI assertion predicates.
- Trace adapters for specific agent runtimes.
- Example traces from real open-source maintenance workflows.

## Development

```bash
npm install
npm run check
```

`npm run check` runs TypeScript type checking, unit tests, and the build.

## Security

Traces can contain private code, credentials, API responses, and local paths. Treat raw traces as sensitive. Use `agent-replay sanitize` before sharing traces publicly, and report sanitizer bypasses through [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
