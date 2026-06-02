import { describe, expect, it } from "vitest";
import { mergeAssertionConfigs, parseAssertionPolicy } from "../src/index.js";

describe("assertion policy", () => {
  it("parses policy JSON objects", () => {
    expect(
      parseAssertionPolicy({
        mustCall: ["read_file"],
        maxShellCalls: 2,
        maxToolCalls: { shell: 1 },
        forbiddenCommandPrefixes: ["rm -rf"],
        requiredOrder: ["read_file", "shell"]
      })
    ).toEqual({
      mustCall: ["read_file"],
      maxShellCalls: 2,
      maxToolCalls: { shell: 1 },
      forbiddenCommandPrefixes: ["rm -rf"],
      requiredOrder: ["read_file", "shell"]
    });
  });

  it("rejects invalid policy fields", () => {
    expect(() => parseAssertionPolicy({ maxShellCalls: -1 })).toThrow("maxShellCalls");
    expect(() => parseAssertionPolicy({ mustCall: [1] })).toThrow("mustCall");
  });

  it("merges policy and CLI configs", () => {
    expect(mergeAssertionConfigs({ mustCall: ["read_file"], maxShellCalls: 2 }, { mustCall: ["shell"] })).toEqual({
      mustCall: ["read_file", "shell"],
      maxShellCalls: 2,
      maxToolCalls: {}
    });
  });
});
