# Trace Schema

Agent Replay Kit stores traces as newline-delimited JSON. Each line is one event. The first stable schema version is `1.0`.

## Event types

### `session_start`

Starts a trace session.

```json
{
  "type": "session_start",
  "schemaVersion": "1.0",
  "sessionId": "session_123",
  "agent": "repo-maintainer-agent",
  "runId": "github-run-123",
  "input": {
    "prompt": "review this pull request"
  }
}
```

### `model_message`

Stores an optional model-facing message. This event is useful when users want prompt or response diffs, but tool replay does not require it.

```json
{
  "type": "model_message",
  "role": "assistant",
  "content": "I will run tests first."
}
```

### `tool_call`

Records that an agent requested a tool.

```json
{
  "type": "tool_call",
  "callId": "call_1",
  "tool": "shell",
  "args": {
    "command": "npm test"
  }
}
```

### `tool_result`

Records the result for a previous `tool_call`.

```json
{
  "type": "tool_result",
  "callId": "call_1",
  "tool": "shell",
  "ok": true,
  "result": {
    "exitCode": 0
  },
  "durationMs": 1200
}
```

Failures are represented without throwing away the original error:

```json
{
  "type": "tool_result",
  "callId": "call_2",
  "tool": "http",
  "ok": false,
  "error": {
    "name": "Error",
    "message": "request timed out"
  }
}
```

### `assertion`

Stores an assertion result when a trace is checked in CI.

```json
{
  "type": "assertion",
  "name": "must-call:shell",
  "ok": true,
  "message": "Tool shell was called"
}
```

### `session_end`

Ends a trace session.

```json
{
  "type": "session_end",
  "ok": true,
  "durationMs": 2400,
  "summary": "All checks passed"
}
```

## Common fields

All events may include:

- `seq`: monotonic sequence number assigned by the recorder.
- `timestamp`: ISO timestamp assigned by the recorder.
- `sessionId`: trace session identifier.
- `metadata`: small JSON object for framework-specific data.

## Replay semantics

Replay consumes `tool_call` events in order and returns the matching `tool_result`.

- `strict` mode requires the tool name and arguments to match.
- `tool-only` mode requires only the tool name to match.
- Recorded failed tool results are replayed as errors.
- Missing results are treated as trace corruption.

## Trace validation

`agent-replay validate trace.jsonl` validates both individual events and the full trace:

- `session_start` must be the first event.
- `session_end` must appear once and no events may follow it.
- `seq` values, when present, must be positive and strictly increasing.
- `tool_result` must match a previous `tool_call`.
- Each `tool_call` must have at most one result.
- Event JSONL lines are limited to 1 MB by default.

## Privacy model

The schema is intentionally plain JSON so traces are easy to inspect and sanitize. Raw traces should still be treated as sensitive until `agent-replay sanitize` has been applied and reviewed.
