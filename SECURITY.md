# Security Policy

## Supported versions

Agent Replay Kit is pre-1.0. Security fixes are released from the main branch until a stable release line exists.

## Reporting a vulnerability

Please do not open public issues for vulnerabilities involving sanitizer bypasses, trace disclosure, or unsafe replay behavior.

Send a private report to the project maintainers with:

- A short description of the issue.
- Steps to reproduce.
- A minimal trace file when possible.
- Whether private data can appear in public output.

## Trace privacy

Raw traces may contain secrets, private source code, API responses, local paths, or personal data. Use `agent-replay sanitize` before sharing traces, and still review the result manually.
