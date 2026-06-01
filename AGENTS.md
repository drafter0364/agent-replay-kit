# AGENTS.md

Project-specific guidance for coding agents working on Agent Replay Kit.

- Treat trace files as untrusted input.
- Keep the core framework-neutral; adapters should live outside the core path.
- Do not add runtime dependencies without a concrete maintenance reason.
- Update tests and docs when CLI behavior or trace schema changes.
- Prefer deterministic behavior over model-dependent behavior in tests.
