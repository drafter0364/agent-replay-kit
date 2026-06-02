import { readTraceFile } from "./io.js";
import type { ToolCallEvent, TraceEvent } from "./types.js";
import { stableStringify } from "./utils.js";

export type TraceAnalysisSeverity = "warning" | "error";

export interface TraceAnalysisFinding {
  rule: string;
  severity: TraceAnalysisSeverity;
  message: string;
  eventIndexes: number[];
  callIds?: string[];
}

export interface TraceAnalysisSummary {
  findings: number;
  warnings: number;
  errors: number;
}

export interface TraceAnalysisReport {
  ok: boolean;
  summary: TraceAnalysisSummary;
  findings: TraceAnalysisFinding[];
}

export interface AnalyzeTraceOptions {
  maxShellCalls?: number;
}

const DEFAULT_MAX_SHELL_CALLS = 10;

export function analyzeTrace(events: TraceEvent[], options: AnalyzeTraceOptions = {}): TraceAnalysisReport {
  const maxShellCalls = options.maxShellCalls ?? DEFAULT_MAX_SHELL_CALLS;
  const indexedCalls = events
    .map((event, index) => (event.type === "tool_call" ? { event, index } : undefined))
    .filter((item): item is { event: ToolCallEvent; index: number } => item !== undefined);
  const findings: TraceAnalysisFinding[] = [
    ...findRepeatedToolCalls(indexedCalls),
    ...findExcessiveShellCalls(indexedCalls, maxShellCalls),
    ...findWriteBeforeRead(indexedCalls),
    ...findFailedToolButSuccessfulSession(events)
  ];
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const errors = findings.filter((finding) => finding.severity === "error").length;

  return {
    ok: findings.length === 0,
    summary: {
      findings: findings.length,
      warnings,
      errors
    },
    findings
  };
}

export async function analyzeTraceFile(filePath: string, options?: AnalyzeTraceOptions): Promise<TraceAnalysisReport> {
  return analyzeTrace(await readTraceFile(filePath), options);
}

export function renderTraceAnalysisMarkdown(report: TraceAnalysisReport): string {
  const lines = [
    "# Agent Trace Analysis",
    "",
    `Status: ${report.ok ? "pass" : "findings"}`,
    `Findings: ${report.summary.findings} (${report.summary.warnings} warning, ${report.summary.errors} error)`
  ];

  if (report.findings.length === 0) {
    lines.push("", "## Findings", "- none");
  } else {
    lines.push("", "## Findings");
    for (const finding of report.findings) {
      const refs = finding.eventIndexes.map((index) => `#${index}`).join(", ");
      lines.push(`- ${finding.severity.toUpperCase()} ${finding.rule}: ${finding.message} (${refs})`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function findRepeatedToolCalls(indexedCalls: Array<{ event: ToolCallEvent; index: number }>): TraceAnalysisFinding[] {
  const groups = new Map<string, Array<{ event: ToolCallEvent; index: number }>>();

  for (const item of indexedCalls) {
    const key = `${item.event.tool}\0${stableStringify(item.event.args)}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      rule: "repeated-tool-call",
      severity: "warning" as const,
      message: `Tool ${group[0]!.event.tool} was called ${group.length} times with the same arguments`,
      eventIndexes: group.map((item) => item.index),
      callIds: group.map((item) => item.event.callId)
    }));
}

function findExcessiveShellCalls(
  indexedCalls: Array<{ event: ToolCallEvent; index: number }>,
  maxShellCalls: number
): TraceAnalysisFinding[] {
  const shellCalls = indexedCalls.filter((item) => isShellTool(item.event.tool));
  if (shellCalls.length <= maxShellCalls) {
    return [];
  }

  return [
    {
      rule: "excessive-shell-calls",
      severity: "warning",
      message: `Shell-like tools were called ${shellCalls.length} times; default review threshold is ${maxShellCalls}`,
      eventIndexes: shellCalls.map((item) => item.index),
      callIds: shellCalls.map((item) => item.event.callId)
    }
  ];
}

function findWriteBeforeRead(indexedCalls: Array<{ event: ToolCallEvent; index: number }>): TraceAnalysisFinding[] {
  let sawRead = false;
  for (const item of indexedCalls) {
    const sideEffect = getSideEffect(item.event);
    if (sideEffect === "read") {
      sawRead = true;
    }
    if (sideEffect === "write" && !sawRead) {
      return [
        {
          rule: "write-before-read",
          severity: "warning",
          message: `Tool ${item.event.tool} performed a write side effect before any read side effect was recorded`,
          eventIndexes: [item.index],
          callIds: [item.event.callId]
        }
      ];
    }
  }
  return [];
}

function findFailedToolButSuccessfulSession(events: TraceEvent[]): TraceAnalysisFinding[] {
  const failedResults = events
    .map((event, index) => (event.type === "tool_result" && !event.ok ? { event, index } : undefined))
    .filter((item): item is { event: TraceEvent & { type: "tool_result" }; index: number } => item !== undefined);
  if (failedResults.length === 0) {
    return [];
  }

  const sessionEnd = [...events]
    .map((event, index) => ({ event, index }))
    .reverse()
    .find((item) => item.event.type === "session_end");
  if (sessionEnd?.event.type !== "session_end" || sessionEnd.event.ok !== true) {
    return [];
  }

  return [
    {
      rule: "failed-tool-session-ok",
      severity: "error",
      message: `${failedResults.length} failed tool result(s) were recorded, but the session ended with ok=true`,
      eventIndexes: [...failedResults.map((item) => item.index), sessionEnd.index],
      callIds: failedResults.map((item) => item.event.callId)
    }
  ];
}

function isShellTool(tool: string): boolean {
  return /(?:shell|command|bash|powershell|exec)/i.test(tool);
}

function getSideEffect(call: ToolCallEvent): string | undefined {
  const sideEffect = call.metadata?.sideEffect;
  return typeof sideEffect === "string" ? sideEffect : undefined;
}
