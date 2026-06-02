# CI Regression Example

An agent project can store a known-good trace and assert that future runs keep important behavior.

```bash
agent-replay assert examples/traces/sample.jsonl \
  --must-call shell \
  --must-not-call send_message \
  --max-shell-calls 2 \
  --forbid-command-pattern "rm -rf"
```

The same policy can be stored in JSON:

```bash
agent-replay assert examples/traces/sample.jsonl --policy examples/agent-replay.policy.json
```

Compare a current run against a golden trace:

```bash
agent-replay test \
  --baseline examples/traces/sample.jsonl \
  --actual examples/traces/sample.jsonl \
  --policy examples/agent-replay.policy.json
```

Suggested GitHub Actions step:

```yaml
- name: Check agent trace policy
  run: |
    npm ci
    npm run build
    node dist/cli.js assert examples/traces/sample.jsonl \
      --policy examples/agent-replay.policy.json
    node dist/cli.js test \
      --baseline examples/traces/sample.jsonl \
      --actual examples/traces/sample.jsonl \
      --policy examples/agent-replay.policy.json
```
