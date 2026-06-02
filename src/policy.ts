import { readFile } from "node:fs/promises";
import type { RequiredToolArgs, TraceAssertionConfig } from "./assert.js";
import type { JsonValue } from "./types.js";
import { isJsonValue, isRecord } from "./utils.js";

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
  config.mustUseArgs = optionalRequiredToolArgs(value, "mustUseArgs", label);

  if ("maxShellCalls" in value) {
    if (typeof value.maxShellCalls !== "number" || !Number.isInteger(value.maxShellCalls) || value.maxShellCalls < 0) {
      throw new Error(`${label}.maxShellCalls must be a non-negative integer`);
    }
    config.maxShellCalls = value.maxShellCalls;
  }

  if ("maxDurationMs" in value) {
    if (typeof value.maxDurationMs !== "number" || !Number.isInteger(value.maxDurationMs) || value.maxDurationMs < 0) {
      throw new Error(`${label}.maxDurationMs must be a non-negative integer`);
    }
    config.maxDurationMs = value.maxDurationMs;
  }

  if ("noFailedTools" in value) {
    if (typeof value.noFailedTools !== "boolean") {
      throw new Error(`${label}.noFailedTools must be a boolean`);
    }
    config.noFailedTools = value.noFailedTools;
  }

  if ("mustEndOk" in value) {
    if (typeof value.mustEndOk !== "boolean") {
      throw new Error(`${label}.mustEndOk must be a boolean`);
    }
    config.mustEndOk = value.mustEndOk;
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
  const mustUseArgs = [...(base.mustUseArgs ?? []), ...(override.mustUseArgs ?? [])];
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
  if (mustUseArgs.length > 0) {
    merged.mustUseArgs = mustUseArgs;
  }
  if (override.maxShellCalls !== undefined) {
    merged.maxShellCalls = override.maxShellCalls;
  }
  if (override.maxDurationMs !== undefined) {
    merged.maxDurationMs = override.maxDurationMs;
  }
  if (override.noFailedTools !== undefined) {
    merged.noFailedTools = override.noFailedTools;
  }
  if (override.mustEndOk !== undefined) {
    merged.mustEndOk = override.mustEndOk;
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

function optionalRequiredToolArgs(value: Record<string, unknown>, key: string, label: string): RequiredToolArgs[] | undefined {
  if (!(key in value)) {
    return undefined;
  }

  const candidate = value[key];
  if (!Array.isArray(candidate)) {
    throw new Error(`${label}.${key} must be an array`);
  }

  return candidate.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`${label}.${key}[${index}] must be an object`);
    }
    if (typeof item.tool !== "string" || item.tool.length === 0) {
      throw new Error(`${label}.${key}[${index}].tool must be a non-empty string`);
    }
    if (!isRecord(item.args)) {
      throw new Error(`${label}.${key}[${index}].args must be an object`);
    }

    const args: Record<string, JsonValue> = {};
    for (const [argKey, argValue] of Object.entries(item.args)) {
      if (!isJsonValue(argValue)) {
        throw new Error(`${label}.${key}[${index}].args.${argKey} must be a JSON value`);
      }
      args[argKey] = argValue;
    }

    return {
      tool: item.tool,
      args
    };
  });
}
