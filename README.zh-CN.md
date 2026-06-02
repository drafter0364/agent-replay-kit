# Agent Replay Kit

Agent Replay Kit 是面向工具调用型 AI Agent 的开源工程基础设施。它可以把 Agent 的工具调用记录成 JSONL trace，之后进行回放、对比、脱敏和 CI 回归断言。

[English README](README.md) | [Trace schema](docs/trace-schema.md) | [Roadmap](ROADMAP.md)

## 为什么需要它

Agent 出错时通常很难复现：模型输出可能变化，工具返回值可能变化，代码仓库和运行环境也可能变化。传统软件有日志、测试、fixture 和 replay；Agent 工程也需要类似的基础设施。

Agent Replay Kit 提供一个小而确定性的核心：

- 记录任意 Agent runtime 的工具调用和结果。
- 在回放时返回历史工具结果，避免再次执行有副作用的工具。
- 对比 prompt、模型或工具变更前后的 trace。
- 对 trace 进行脱敏，方便在 issue 或 PR 中分享。
- 在 CI 中断言 Agent 行为，例如必须调用某工具、禁止危险 shell 命令。

## 快速开始

```bash
npm install
npm run build
```

用 CLI 创建一条 trace：

```bash
node dist/cli.js record \
  --out traces/demo.jsonl \
  --tool shell \
  --args-json '{"command":"npm test"}' \
  --result-json '{"exitCode":0}'
```

查看并回放：

```bash
node dist/cli.js inspect traces/demo.jsonl
node dist/cli.js validate traces/demo.jsonl
node dist/cli.js replay traces/demo.jsonl --tool shell --args-json '{"command":"npm test"}'
```

CI 断言示例：

```bash
node dist/cli.js assert traces/demo.jsonl \
  --must-call shell \
  --max-shell-calls 3 \
  --forbid-command-prefix "rm -rf"
```

JSON policy 还可以表达 Agent 行为契约：工具调用顺序、必需参数、最长工具耗时、禁止失败工具，以及 session 必须成功结束。

## SDK 示例

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

## 命令行

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

## 当前边界

第一版不绑定特定 Agent 框架，也不提供 Web UI 或数据库存储。项目优先保证 trace schema、SDK、CLI、脱敏和断言能力稳定可测。

后续可以扩展 OpenAI Agents SDK、LangChain、MCP、OpenTelemetry 和 HTML trace viewer。

## 开发

```bash
npm install
npm run check
```

## 安全

原始 trace 可能包含私有代码、凭据、API 响应和本地路径。公开分享前请先运行 `agent-replay sanitize`。安全问题请参考 [SECURITY.md](SECURITY.md)。

## 许可证

MIT。详见 [LICENSE](LICENSE)。
