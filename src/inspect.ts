import { readTraceFile } from "./io.js";
import type { TraceEvent } from "./types.js";
import { isRecord } from "./utils.js";

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

export interface TraceTimelineItem {
  index: number;
  seq?: number;
  timestamp?: string;
  type: TraceEvent["type"];
  tool?: string;
  callId?: string;
  ok?: boolean;
  durationMs?: number;
  sideEffect?: string;
}

export interface TraceTimeline {
  sessionId?: string;
  agent?: string;
  durationMs?: number;
  items: TraceTimelineItem[];
  slowestTools: TraceTimelineItem[];
  failedTools: TraceTimelineItem[];
  alternation: Array<{
    index: number;
    from?: TraceEvent["type"];
    to: TraceEvent["type"];
  }>;
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

export function buildTraceTimeline(events: TraceEvent[]): TraceTimeline {
  const firstSession = events.find((event) => event.type === "session_start");
  const sessionEnd = [...events].reverse().find((event) => event.type === "session_end");
  const items = events.map((event, index): TraceTimelineItem => {
    const base = {
      index,
      seq: event.seq,
      timestamp: event.timestamp,
      type: event.type
    };

    if (event.type === "tool_call") {
      return {
        ...base,
        tool: event.tool,
        callId: event.callId,
        sideEffect: getSideEffect(event.metadata)
      };
    }

    if (event.type === "tool_result") {
      return {
        ...base,
        tool: event.tool,
        callId: event.callId,
        ok: event.ok,
        durationMs: event.durationMs
      };
    }

    return base;
  });
  const toolResults = items.filter((item) => item.type === "tool_result");

  return {
    sessionId: firstSession?.sessionId,
    agent: firstSession?.type === "session_start" ? firstSession.agent : undefined,
    durationMs: sessionEnd?.type === "session_end" ? sessionEnd.durationMs : undefined,
    items,
    slowestTools: [...toolResults]
      .filter((item) => typeof item.durationMs === "number")
      .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
      .slice(0, 5),
    failedTools: toolResults.filter((item) => item.ok === false),
    alternation: events.map((event, index) => ({
      index,
      from: index > 0 ? events[index - 1]?.type : undefined,
      to: event.type
    }))
  };
}

export async function buildTraceTimelineFile(filePath: string): Promise<TraceTimeline> {
  return buildTraceTimeline(await readTraceFile(filePath));
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

function getSideEffect(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }
  return typeof metadata.sideEffect === "string" ? metadata.sideEffect : undefined;
}
