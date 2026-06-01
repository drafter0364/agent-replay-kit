# Contributing

Thanks for helping improve Agent Replay Kit. Keep changes small, tested, and tied to agent debugging, replay, sanitization, or regression testing.

## Development setup

```bash
npm install
npm run check
```

## Pull request expectations

- Add or update tests for behavior changes.
- Keep trace schema changes backward-compatible unless the release plan says otherwise.
- Avoid adding runtime dependencies unless they clearly reduce maintenance risk.
- Treat trace input as untrusted.
- Update README or docs when user-facing commands change.

## Good first issues

- Add sanitizer regression cases.
- Add assertion predicates with clear CLI flags.
- Improve example traces.
- Add adapters that wrap a specific agent framework without changing the core schema.

## Release notes

User-visible changes should update `CHANGELOG.md` under `Unreleased`.
