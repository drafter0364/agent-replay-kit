import { readTraceFile } from "./io.js";
import type { JsonValue, TraceEvent } from "./types.js";
import { isRecord, stableStringify } from "./utils.js";

export interface RequiredToolArgs {
  tool: string;
  args: Record<string, JsonValue>;
}

export type ToolSideEffect = "read" | "write" | "network" | "external-state" | "secret-access";

export interface TraceAssertionConfig {
  mustCall?: string[];
  mustNotCall?: string[];
  maxToolCalls?: Record<string, number>;
  maxShellCalls?: number;
  maxDurationMs?: number;
  noFailedTools?: boolean;
  mustEndOk?: boolean;
  mustUseArgs?: RequiredToolArgs[];
  forbiddenSideEffects?: ToolSideEffect[];
  maxSideEffectCalls?: Partial<Record<ToolSideEffect, number>>;
  requiredSideEffectOrder?: ToolSideEffect[];
  forbiddenCommands?: string[];
  forbiddenCommandPrefixes?: string[];
  forbiddenCommandPatterns?: string[];
  requiredOrder?: string[];
}

export interface TraceAssertionFinding {
  name: string;
  ok: boolean;
  message: string;
}

export interface TraceAssertionReport {
  ok: boolean;
  findings: TraceAssertionFinding[];
}

export function assertTrace(events: TraceEvent[], config: TraceAssertionConfig): TraceAssertionReport {
  const calls = events.filter((event) => event.type === "tool_call");
  const results = events.filter((event) => event.type === "tool_result");
  const toolCounts = new Map<string, number>();
  const findings: TraceAssertionFinding[] = [];

  for (const call of calls) {
    toolCounts.set(call.tool, (toolCounts.get(call.tool) ?? 0) + 1);
  }

  for (const tool of config.mustCall ?? []) {
    const ok = (toolCounts.get(tool) ?? 0) > 0;
    findings.push({
      name: `must-call:${tool}`,
      ok,
      message: ok ? `Tool ${tool} was called` : `Tool ${tool} was not called`
    });
  }

  for (const tool of config.mustNotCall ?? []) {
    const ok = (toolCounts.get(tool) ?? 0) === 0;
    findings.push({
      name: `must-not-call:${tool}`,
      ok,
      message: ok ? `Tool ${tool} was not called` : `Tool ${tool} was called`
    });
  }

  for (const [tool, max] of Object.entries(config.maxToolCalls ?? {})) {
    const count = toolCounts.get(tool) ?? 0;
    const ok = count <= max;
    findings.push({
      name: `max-tool-calls:${tool}`,
      ok,
      message: ok ? `Tool ${tool} called ${count}/${max} times` : `Tool ${tool} called ${count} times, max is ${max}`
    });
  }

  if (typeof config.maxShellCalls === "number") {
    const count = calls.filter((call) => isShellTool(call.tool)).length;
    const ok = count <= config.maxShellCalls;
    findings.push({
      name: "max-shell-calls",
      ok,
      message: ok ? `Shell calls ${count}/${config.maxShellCalls}` : `Shell calls ${count}, max is ${config.maxShellCalls}`
    });
  }

  if (typeof config.maxDurationMs === "number") {
    const offenders = results.filter((result) => typeof result.durationMs === "number" && result.durationMs > config.maxDurationMs!);
    findings.push({
      name: "max-duration-ms",
      ok: offenders.length === 0,
      message:
        offenders.length === 0
          ? `No tool result exceeded ${config.maxDurationMs}ms`
          : `${offenders.length} tool result(s) exceeded ${config.maxDurationMs}ms`
    });
  }

  if (config.noFailedTools === true) {
    const offenders = results.filter((result) => !result.ok);
    findings.push({
      name: "no-failed-tools",
      ok: offenders.length === 0,
      message: offenders.length === 0 ? "No failed tool results" : `${offenders.length} failed tool result(s)`
    });
  }

  if (config.mustEndOk === true) {
    const end = [...events].reverse().find((event) => event.type === "session_end");
    const ok = end?.type === "session_end" && end.ok === true;
    findings.push({
      name: "must-end-ok",
      ok,
      message: ok ? "Trace ended with session_end.ok=true" : "Trace did not end with session_end.ok=true"
    });
  }

  for (const requirement of config.mustUseArgs ?? []) {
    const ok = calls.some((call) => call.tool === requirement.tool && argsInclude(call.args, requirement.args));
    findings.push({
      name: `must-use-args:${requirement.tool}`,
      ok,
      message: ok
        ? `Tool ${requirement.tool} used required args ${stableStringify(requirement.args)}`
        : `Tool ${requirement.tool} did not use required args ${stableStringify(requirement.args)}`
    });
  }

  for (const sideEffect of config.forbiddenSideEffects ?? []) {
    const offenders = calls.filter((call) => getSideEffect(call) === sideEffect);
    findings.push({
      name: `forbidden-side-effect:${sideEffect}`,
      ok: offenders.length === 0,
      message:
        offenders.length === 0
          ? `No tool call used side effect ${sideEffect}`
          : `${offenders.length} tool call(s) used forbidden side effect ${sideEffect}`
    });
  }

  for (const [sideEffect, max] of Object.entries(config.maxSideEffectCalls ?? {}) as Array<[ToolSideEffect, number]>) {
    const count = calls.filter((call) => getSideEffect(call) === sideEffect).length;
    const ok = count <= max;
    findings.push({
      name: `max-side-effect-calls:${sideEffect}`,
      ok,
      message: ok ? `Side effect ${sideEffect} used ${count}/${max} times` : `Side effect ${sideEffect} used ${count} times, max is ${max}`
    });
  }

  if (config.requiredSideEffectOrder && config.requiredSideEffectOrder.length > 0) {
    let cursor = -1;
    let ok = true;
    for (const sideEffect of config.requiredSideEffectOrder) {
      const nextIndex = calls.findIndex((call, index) => index > cursor && getSideEffect(call) === sideEffect);
      if (nextIndex === -1) {
        ok = false;
        break;
      }
      cursor = nextIndex;
    }
    findings.push({
      name: "required-side-effect-order",
      ok,
      message: ok
        ? `Side effects appeared in required order: ${config.requiredSideEffectOrder.join(" -> ")}`
        : `Side effects did not appear in required order: ${config.requiredSideEffectOrder.join(" -> ")}`
    });
  }

  for (const command of config.forbiddenCommands ?? []) {
    const offenders = calls.filter((call) => getCommand(call.args)?.trim() === command);
    findings.push({
      name: `forbidden-command:${command}`,
      ok: offenders.length === 0,
      message:
        offenders.length === 0 ? `No command exactly matched ${command}` : `${offenders.length} command(s) exactly matched ${command}`
    });
  }

  for (const prefix of config.forbiddenCommandPrefixes ?? []) {
    const offenders = calls.filter((call) => getCommand(call.args)?.trim().startsWith(prefix));
    findings.push({
      name: `forbidden-command-prefix:${prefix}`,
      ok: offenders.length === 0,
      message:
        offenders.length === 0
          ? `No command started with ${prefix}`
          : `${offenders.length} command(s) started with forbidden prefix ${prefix}`
    });
  }

  for (const patternText of config.forbiddenCommandPatterns ?? []) {
    const patternFinding = compileCommandPattern(patternText);
    if (!patternFinding.ok) {
      findings.push(patternFinding.finding);
      continue;
    }
    const pattern = patternFinding.pattern;
    const offenders = calls.filter((call) => {
      const command = getCommand(call.args);
      return command !== undefined && pattern.test(command);
    });
    findings.push({
      name: `forbidden-command-pattern:${patternText}`,
      ok: offenders.length === 0,
      message:
        offenders.length === 0
          ? `No command matched ${patternText}`
          : `${offenders.length} command(s) matched forbidden pattern ${patternText}`
    });
  }

  if (config.requiredOrder && config.requiredOrder.length > 0) {
    let cursor = -1;
    let ok = true;
    for (const tool of config.requiredOrder) {
      const nextIndex = calls.findIndex((call, index) => index > cursor && call.tool === tool);
      if (nextIndex === -1) {
        ok = false;
        break;
      }
      cursor = nextIndex;
    }
    findings.push({
      name: "required-order",
      ok,
      message: ok
        ? `Tools appeared in required order: ${config.requiredOrder.join(" -> ")}`
        : `Tools did not appear in required order: ${config.requiredOrder.join(" -> ")}`
    });
  }

  return {
    ok: findings.every((finding) => finding.ok),
    findings
  };
}

function compileCommandPattern(
  patternText: string
):
  | { ok: true; pattern: RegExp }
  | { ok: false; finding: TraceAssertionFinding } {
  if (patternText.length > 200) {
    return {
      ok: false,
      finding: {
        name: `forbidden-command-pattern:${patternText}`,
        ok: false,
        message: `Forbidden command pattern is too long: ${patternText.length}/200 characters`
      }
    };
  }

  if (/\([^)]*[+*][^)]*\)(?:[+*]|\{\d*,?\d*\})/.test(patternText)) {
    return {
      ok: false,
      finding: {
        name: `forbidden-command-pattern:${patternText}`,
        ok: false,
        message: `Forbidden command pattern looks vulnerable to catastrophic backtracking: ${patternText}`
      }
    };
  }

  try {
    return { ok: true, pattern: new RegExp(patternText) };
  } catch (error) {
    return {
      ok: false,
      finding: {
        name: `forbidden-command-pattern:${patternText}`,
        ok: false,
        message: `Invalid forbidden command pattern ${patternText}: ${error instanceof Error ? error.message : String(error)}`
      }
    };
  }
}

export async function assertTraceFile(filePath: string, config: TraceAssertionConfig): Promise<TraceAssertionReport> {
  return assertTrace(await readTraceFile(filePath), config);
}

export function renderAssertionMarkdown(report: TraceAssertionReport): string {
  const lines = ["# Agent Trace Assertions", "", `Status: ${report.ok ? "pass" : "fail"}`];
  if (report.findings.length > 0) {
    lines.push("", "## Findings");
    for (const finding of report.findings) {
      lines.push(`- ${finding.ok ? "PASS" : "FAIL"} ${finding.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function isShellTool(tool: string): boolean {
  return /(?:shell|command|bash|powershell|exec)/i.test(tool);
}

function getCommand(args: unknown): string | undefined {
  if (!isRecord(args)) {
    return undefined;
  }
  const value = args.command ?? args.cmd ?? args.script;
  return typeof value === "string" ? value : undefined;
}

function getSideEffect(call: TraceEvent & { type: "tool_call" }): ToolSideEffect | undefined {
  const sideEffect = call.metadata?.sideEffect;
  if (
    sideEffect === "read" ||
    sideEffect === "write" ||
    sideEffect === "network" ||
    sideEffect === "external-state" ||
    sideEffect === "secret-access"
  ) {
    return sideEffect;
  }
  return undefined;
}

function argsInclude(actual: unknown, expected: Record<string, JsonValue>): boolean {
  if (!isRecord(actual)) {
    return false;
  }

  for (const [key, expectedValue] of Object.entries(expected)) {
    if (stableStringify(actual[key]) !== stableStringify(expectedValue)) {
      return false;
    }
  }

  return true;
}
