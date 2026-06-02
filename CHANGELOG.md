# Changelog

## Unreleased

- Initial trace schema for sessions, model messages, tool calls, tool results, assertions, and session endings.
- Added TypeScript SDK for recording and replaying tool calls.
- Added CLI commands for record, replay, diff, sanitize, assert, and inspect.
- Added sanitizer, assertion engine, trace summary, examples, and documentation.
- Added trace validation hardening and a `validate` CLI command.
- Added sanitizer validation and redaction reports.
- Added JSON assertion policies and safer forbidden command rules.
- Added semantic trace diffing and golden trace regression testing.
- Improved trace file I/O diagnostics and CLI JSON parse errors.
- Added sanitizer URL host allowlisting.
- Added contract assertions for required args, tool duration, failed tools, and successful session end.
- Added a composite GitHub Action wrapper.
- Added a framework-neutral adapter contract.
- Added side-effect classification assertions for tool metadata.
- Added timeline JSON export for trace inspection.
- Added a runnable MCP-style trace adapter example.
- Added call-id replay mode for out-of-order tool replay.
