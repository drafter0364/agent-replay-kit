# CI Regression Example

An agent project can store a known-good trace and assert that future runs keep important behavior.

```bash
agent-replay assert examples/traces/sample.jsonl \
  --must-call shell \
  --must-not-call send_message \
  --max-shell-calls 2 \
  --forbid-command-pattern "rm -rf"
```

Suggested GitHub Actions step:

```yaml
- name: Check agent trace policy
  run: |
    npm ci
    npm run build
    node dist/cli.js assert examples/traces/sample.jsonl \
      --must-call shell \
      --max-shell-calls 2 \
      --forbid-command-pattern "rm -rf"
```
