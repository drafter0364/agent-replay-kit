import { readTraceFile } from "./io.js";
import type { TraceEvent } from "./types.js";
import { isRecord } from "./utils.js";

export interface TraceAssertionConfig {
  mustCall?: string[];
  mustNotCall?: string[];
  maxToolCalls?: Record<string, number>;
  maxShellCalls?: number;
  forbiddenCommandPatterns?: string[];
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

  for (const patternText of config.forbiddenCommandPatterns ?? []) {
    const pattern = new RegExp(patternText);
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

  return {
    ok: findings.every((finding) => finding.ok),
    findings
  };
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
