import { describe, expect, it } from "vitest";
import { assertTrace, renderAssertionMarkdown } from "../src/index.js";
import type { TraceEvent } from "../src/types.js";

const events: TraceEvent[] = [
  { type: "tool_call", callId: "c1", tool: "read_file", args: { path: "README.md" } },
  { type: "tool_call", callId: "c2", tool: "shell", args: { command: "npm test" } },
  { type: "tool_result", callId: "c2", tool: "shell", ok: true, result: { exitCode: 0 }, durationMs: 25 },
  { type: "tool_call", callId: "c3", tool: "shell", args: { command: "rm -rf dist" } },
  { type: "tool_result", callId: "c3", tool: "shell", ok: false, error: { message: "blocked" }, durationMs: 250 },
  { type: "session_end", ok: false }
];

describe("trace assertions", () => {
  it("passes required tool assertions", () => {
    const report = assertTrace(events, { mustCall: ["read_file"], mustNotCall: ["send_message"] });

    expect(report.ok).toBe(true);
  });

  it("fails shell count and forbidden command assertions", () => {
    const report = assertTrace(events, { maxShellCalls: 1, forbiddenCommandPatterns: ["rm -rf"] });

    expect(report.ok).toBe(false);
    expect(renderAssertionMarkdown(report)).toContain("FAIL");
  });

  it("supports literal and prefix forbidden command assertions", () => {
    const report = assertTrace(events, { forbiddenCommands: ["npm test"], forbiddenCommandPrefixes: ["rm -"] });

    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.name)).toEqual(
      expect.arrayContaining(["forbidden-command:npm test", "forbidden-command-prefix:rm -"])
    );
  });

  it("reports invalid and suspicious regex patterns as findings", () => {
    const report = assertTrace(events, { forbiddenCommandPatterns: ["[", "(a+)+$"] });

    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.message).join("\n")).toContain("Invalid forbidden command pattern");
    expect(report.findings.map((finding) => finding.message).join("\n")).toContain("catastrophic backtracking");
  });

  it("checks required tool order", () => {
    expect(assertTrace(events, { requiredOrder: ["read_file", "shell"] }).ok).toBe(true);
    expect(assertTrace(events, { requiredOrder: ["shell", "read_file"] }).ok).toBe(false);
  });

  it("checks required args and tool duration contracts", () => {
    expect(assertTrace(events, { mustUseArgs: [{ tool: "shell", args: { command: "npm test" } }], maxDurationMs: 300 }).ok).toBe(
      true
    );
    expect(assertTrace(events, { mustUseArgs: [{ tool: "shell", args: { command: "npm run build" } }] }).ok).toBe(false);
    expect(assertTrace(events, { maxDurationMs: 100 }).ok).toBe(false);
  });

  it("checks failed tools and successful session ending contracts", () => {
    expect(assertTrace(events, { noFailedTools: true }).ok).toBe(false);
    expect(assertTrace(events, { mustEndOk: true }).ok).toBe(false);
    expect(assertTrace([{ type: "session_end", ok: true }], { mustEndOk: true }).ok).toBe(true);
  });

  it("checks side-effect metadata contracts", () => {
    const sideEffectEvents: TraceEvent[] = [
      { type: "tool_call", callId: "c1", tool: "read_file", args: {}, metadata: { sideEffect: "read" } },
      { type: "tool_call", callId: "c2", tool: "http", args: {}, metadata: { sideEffect: "network" } },
      { type: "tool_call", callId: "c3", tool: "write_file", args: {}, metadata: { sideEffect: "write" } }
    ];

    expect(
      assertTrace(sideEffectEvents, {
        forbiddenSideEffects: ["external-state"],
        maxSideEffectCalls: { network: 1 },
        requiredSideEffectOrder: ["read", "write"]
      }).ok
    ).toBe(true);
    expect(assertTrace(sideEffectEvents, { forbiddenSideEffects: ["network"] }).ok).toBe(false);
    expect(assertTrace(sideEffectEvents, { maxSideEffectCalls: { network: 0 } }).ok).toBe(false);
    expect(assertTrace(sideEffectEvents, { requiredSideEffectOrder: ["write", "read"] }).ok).toBe(false);
  });
});
