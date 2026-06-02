import { describe, expect, it } from "vitest";
import { mergeAssertionConfigs, parseAssertionPolicy } from "../src/index.js";

describe("assertion policy", () => {
  it("parses policy JSON objects", () => {
    expect(
      parseAssertionPolicy({
        mustCall: ["read_file"],
        maxShellCalls: 2,
        maxDurationMs: 100,
        noFailedTools: true,
        mustEndOk: true,
        maxToolCalls: { shell: 1 },
        forbiddenSideEffects: ["external-state"],
        maxSideEffectCalls: { network: 1 },
        requiredSideEffectOrder: ["read", "write"],
        mustUseArgs: [{ tool: "shell", args: { command: "npm test" } }],
        forbiddenCommandPrefixes: ["rm -rf"],
        requiredOrder: ["read_file", "shell"]
      })
    ).toEqual({
      mustCall: ["read_file"],
      maxShellCalls: 2,
      maxDurationMs: 100,
      noFailedTools: true,
      mustEndOk: true,
      maxToolCalls: { shell: 1 },
      forbiddenSideEffects: ["external-state"],
      maxSideEffectCalls: { network: 1 },
      requiredSideEffectOrder: ["read", "write"],
      mustUseArgs: [{ tool: "shell", args: { command: "npm test" } }],
      forbiddenCommandPrefixes: ["rm -rf"],
      requiredOrder: ["read_file", "shell"]
    });
  });

  it("rejects invalid policy fields", () => {
    expect(() => parseAssertionPolicy({ maxShellCalls: -1 })).toThrow("maxShellCalls");
    expect(() => parseAssertionPolicy({ mustCall: [1] })).toThrow("mustCall");
    expect(() => parseAssertionPolicy({ mustUseArgs: [{ tool: "shell", args: { bad: undefined } }] })).toThrow("mustUseArgs");
    expect(() => parseAssertionPolicy({ forbiddenSideEffects: ["unknown"] })).toThrow("unsupported side effect");
  });

  it("merges policy and CLI configs", () => {
    expect(mergeAssertionConfigs({ mustCall: ["read_file"], maxShellCalls: 2 }, { mustCall: ["shell"] })).toEqual({
      mustCall: ["read_file", "shell"],
      maxShellCalls: 2
    });
  });
});
