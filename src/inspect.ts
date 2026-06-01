import { readTraceFile } from "./io.js";
import type { TraceEvent } from "./types.js";

export interface TraceSummary {
  eventCount: number;
  sessionId?: string;
  agent?: string;
  toolCalls: Record<string, number>;
  failedTools: number;
  assertions: {
    passed: number;
    failed: number;
  };
}

export function summarizeTrace(events: TraceEvent[]): TraceSummary {
  const firstSession = events.find((event) => event.type === "session_start");
  const toolCalls: Record<string, number> = {};
  let failedTools = 0;
  let passedAssertions = 0;
  let failedAssertions = 0;

  for (const event of events) {
    if (event.type === "tool_call") {
      toolCalls[event.tool] = (toolCalls[event.tool] ?? 0) + 1;
    }
    if (event.type === "tool_result" && !event.ok) {
      failedTools += 1;
    }
    if (event.type === "assertion") {
      if (event.ok) {
        passedAssertions += 1;
      } else {
        failedAssertions += 1;
      }
    }
  }

  return {
    eventCount: events.length,
    sessionId: firstSession?.sessionId,
    agent: firstSession?.type === "session_start" ? firstSession.agent : undefined,
    toolCalls,
    failedTools,
    assertions: {
      passed: passedAssertions,
      failed: failedAssertions
    }
  };
}

export async function summarizeTraceFile(filePath: string): Promise<TraceSummary> {
  return summarizeTrace(await readTraceFile(filePath));
}

export function renderTraceSummaryMarkdown(summary: TraceSummary): string {
  const lines = [
    "# Agent Trace Summary",
    "",
    `Events: ${summary.eventCount}`,
    `Session: ${summary.sessionId ?? "unknown"}`,
    `Agent: ${summary.agent ?? "unknown"}`,
    `Failed tools: ${summary.failedTools}`,
    `Assertions: ${summary.assertions.passed} passed, ${summary.assertions.failed} failed`
  ];

  lines.push("", "## Tool calls");
  const tools = Object.entries(summary.toolCalls);
  if (tools.length === 0) {
    lines.push("- none");
  } else {
    for (const [tool, count] of tools) {
      lines.push(`- ${tool}: ${count}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
