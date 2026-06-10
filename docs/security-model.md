# Security Model

Agent Replay Kit is designed for local deterministic analysis. It does not execute recorded tools during replay.

## Trusted and untrusted data

Trace content is untrusted input. It may include model output, tool arguments, API responses, source snippets, shell output, credentials, or local paths.

The library validates event structure before parsing trace files, but it does not claim that trace content is safe to display in every context.

## Replay safety

`TraceReplayer` returns recorded tool results. It does not call the original tool implementation. This makes replay suitable for regression tests where shell commands, network calls, or paid APIs should not run again.

## Sanitization limits

The default sanitizer redacts common secrets, bearer tokens, high-confidence service tokens such as GitHub, AWS access, Slack, and npm tokens, sensitive key names such as `privateKey`, `auth`, `passphrase`, and `connectionString`, email addresses, URLs, and local paths including common Unix locations such as `/etc`, `/opt`, `/root`, and `~/.ssh`. It is a safety layer, not a guarantee. Review sanitized traces before publishing them.

Recommended workflow:

```bash
agent-replay sanitize private.jsonl --out public.jsonl
agent-replay inspect public.jsonl
```

The sanitize command reports how many redactions were applied. Use JSON output when you need a machine-readable redaction audit:

```bash
agent-replay sanitize private.jsonl --out public.jsonl --format json
```

By default, URLs are redacted. Public documentation hosts can be explicitly preserved:

```bash
agent-replay sanitize private.jsonl --out public.jsonl --allow-url-host github.com
```

For issue reports, create a repro bundle instead of sharing raw traces:

```bash
agent-replay bundle private.jsonl --out repro.zip --policy agent-replay.policy.json
```

The bundle contains a sanitized trace, redaction report, environment fingerprint, manifest, and optional policy file. It does not include the original trace.

## Dangerous command assertions

CI assertions can flag command patterns:

```bash
agent-replay assert trace.jsonl --forbid-command-prefix "rm -rf"
```

This is a policy check over recorded arguments. It is not a sandbox.

Prefer literal or prefix checks for common dangerous commands. Regex patterns are supported for local policy files, but Agent Replay Kit rejects invalid patterns, patterns longer than 200 characters, and simple nested-quantifier shapes that commonly cause catastrophic backtracking.
