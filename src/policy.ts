import { readFile } from "node:fs/promises";
import type { TraceAssertionConfig } from "./assert.js";
import { isRecord } from "./utils.js";

export async function readAssertionPolicyFile(filePath: string): Promise<TraceAssertionConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read assertion policy ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return parseAssertionPolicy(parsed, filePath);
}

export function parseAssertionPolicy(value: unknown, label = "policy"): TraceAssertionConfig {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a JSON object`);
  }

  const config: TraceAssertionConfig = {};
  config.mustCall = optionalStringArray(value, "mustCall", label);
  config.mustNotCall = optionalStringArray(value, "mustNotCall", label);
  config.forbiddenCommands = optionalStringArray(value, "forbiddenCommands", label);
  config.forbiddenCommandPrefixes = optionalStringArray(value, "forbiddenCommandPrefixes", label);
  config.forbiddenCommandPatterns = optionalStringArray(value, "forbiddenCommandPatterns", label);
  config.requiredOrder = optionalStringArray(value, "requiredOrder", label);

  if ("maxShellCalls" in value) {
    if (typeof value.maxShellCalls !== "number" || !Number.isInteger(value.maxShellCalls) || value.maxShellCalls < 0) {
      throw new Error(`${label}.maxShellCalls must be a non-negative integer`);
    }
    config.maxShellCalls = value.maxShellCalls;
  }

  if ("maxToolCalls" in value) {
    if (!isRecord(value.maxToolCalls)) {
      throw new Error(`${label}.maxToolCalls must be an object`);
    }
    config.maxToolCalls = {};
    for (const [tool, max] of Object.entries(value.maxToolCalls)) {
      if (typeof max !== "number" || !Number.isInteger(max) || max < 0) {
        throw new Error(`${label}.maxToolCalls.${tool} must be a non-negative integer`);
      }
      config.maxToolCalls[tool] = max;
    }
  }

  return config;
}

export function mergeAssertionConfigs(base: TraceAssertionConfig, override: TraceAssertionConfig): TraceAssertionConfig {
  const merged: TraceAssertionConfig = {
    ...base,
    mustCall: mergeArrays(base.mustCall, override.mustCall),
    mustNotCall: mergeArrays(base.mustNotCall, override.mustNotCall),
    forbiddenCommands: mergeArrays(base.forbiddenCommands, override.forbiddenCommands),
    forbiddenCommandPrefixes: mergeArrays(base.forbiddenCommandPrefixes, override.forbiddenCommandPrefixes),
    forbiddenCommandPatterns: mergeArrays(base.forbiddenCommandPatterns, override.forbiddenCommandPatterns),
    requiredOrder: override.requiredOrder ?? base.requiredOrder,
    maxToolCalls: {
      ...(base.maxToolCalls ?? {}),
      ...(override.maxToolCalls ?? {})
    }
  };
  if (override.maxShellCalls !== undefined) {
    merged.maxShellCalls = override.maxShellCalls;
  }
  return merged;
}

function optionalStringArray(value: Record<string, unknown>, key: string, label: string): string[] | undefined {
  if (!(key in value)) {
    return undefined;
  }
  const candidate = value[key];
  if (!Array.isArray(candidate) || !candidate.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error(`${label}.${key} must be an array of non-empty strings`);
  }
  return candidate;
}

function mergeArrays(base?: string[], override?: string[]): string[] | undefined {
  const merged = [...(base ?? []), ...(override ?? [])];
  return merged.length > 0 ? Array.from(new Set(merged)) : undefined;
}
