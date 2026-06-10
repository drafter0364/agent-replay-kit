import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { DEFAULT_MAX_TRACE_LINE_LENGTH, validateTraceEvent } from "./schema.js";
import type { TraceDiagnostic, TraceEvent, TraceValidationReport } from "./types.js";

export interface ValidateTraceTextOptions {
  maxLineLength?: number;
}

export interface ParsedTraceValidationReport extends TraceValidationReport {
  events: TraceEvent[];
  skippedBlankLines: number;
}

export async function validateTraceFile(
  filePath: string,
  options: ValidateTraceTextOptions = {}
): Promise<ParsedTraceValidationReport> {
  const diagnostics: TraceDiagnostic[] = [];
  const events: TraceEvent[] = [];
  const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_TRACE_LINE_LENGTH;
  let lineNumber = 0;
  let skippedBlankLines = 0;

  try {
    for await (const line of readTraceLines(filePath)) {
      lineNumber += 1;
      skippedBlankLines += validateLine(line, lineNumber, maxLineLength, diagnostics, events);
    }
  } catch (error) {
    return {
      ok: false,
      eventCount: events.length,
      events,
      skippedBlankLines,
      diagnostics: [
        {
          code: "trace-file-read-error",
          message: `Failed to read trace file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }

  diagnostics.push(...validateTrace(events).diagnostics);

  return {
    ok: diagnostics.length === 0,
    eventCount: events.length,
    events,
    skippedBlankLines,
    diagnostics
  };
}

export function validateTraceText(raw: string, options: ValidateTraceTextOptions = {}): ParsedTraceValidationReport {
  const diagnostics: TraceDiagnostic[] = [];
  const events: TraceEvent[] = [];
  const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_TRACE_LINE_LENGTH;
  let skippedBlankLines = 0;

  raw.split(/\r?\n/).forEach((line, index) => {
    skippedBlankLines += validateLine(line, index + 1, maxLineLength, diagnostics, events);
  });

  const traceValidation = validateTrace(events);
  diagnostics.push(...traceValidation.diagnostics);

  return {
    ok: diagnostics.length === 0,
    eventCount: events.length,
    events,
    skippedBlankLines,
    diagnostics
  };
}

async function* readTraceLines(filePath: string): AsyncGenerator<string> {
  const fileStream = createReadStream(filePath);
  const input = filePath.endsWith(".gz") ? fileStream.pipe(createGunzip()) : fileStream;
  input.setEncoding("utf8");
  const lines = createInterface({
    input,
    crlfDelay: Infinity
  });

  for await (const line of lines) {
    yield line;
  }
}

function validateLine(
  rawLine: string,
  lineNumber: number,
  maxLineLength: number,
  diagnostics: TraceDiagnostic[],
  events: TraceEvent[]
): number {
  const line = rawLine.trim();
  if (line.length === 0) {
    return 1;
  }

  if (line.length > maxLineLength) {
    diagnostics.push({
      code: "trace-line-too-large",
      line: lineNumber,
      message: `Trace line ${lineNumber} exceeds max length ${maxLineLength}`
    });
    return 0;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    diagnostics.push({
      code: "trace-line-invalid-json",
      line: lineNumber,
      message: `Invalid JSON on trace line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`
    });
    return 0;
  }

  const eventValidation = validateTraceEvent(parsed);
  if (!eventValidation.ok) {
    for (const message of eventValidation.errors) {
      diagnostics.push({
        code: "trace-event-invalid",
        line: lineNumber,
        message
      });
    }
    return 0;
  }

  events.push(parsed as TraceEvent);
  return 0;
}

export function validateTrace(events: TraceEvent[]): TraceValidationReport {
  const diagnostics: TraceDiagnostic[] = [];
  const calls = new Map<string, TraceEvent & { type: "tool_call" }>();
  const results = new Map<string, TraceEvent & { type: "tool_result" }>();
  let sessionId: string | undefined;
  let sawSessionStart = false;
  let sawSessionEnd = false;
  let lastSeq = 0;

  if (events.length === 0) {
    diagnostics.push({
      code: "trace-empty",
      message: "Trace must contain at least one event"
    });
  }

  events.forEach((event, index) => {
    const location = event.seq ? { seq: event.seq } : { line: index + 1 };

    if (typeof event.seq === "number") {
      if (event.seq <= lastSeq) {
        diagnostics.push({
          code: "trace-seq-not-monotonic",
          eventType: event.type,
          seq: event.seq,
          message: `Trace seq ${event.seq} must be greater than previous seq ${lastSeq}`
        });
      }
      lastSeq = event.seq;
    }

    if (event.type === "session_start") {
      if (sawSessionStart) {
        diagnostics.push({
          code: "trace-duplicate-session-start",
          eventType: event.type,
          ...location,
          message: "Trace contains more than one session_start event"
        });
      }
      if (index !== 0) {
        diagnostics.push({
          code: "trace-session-start-not-first",
          eventType: event.type,
          ...location,
          message: "session_start must be the first trace event"
        });
      }
      sawSessionStart = true;
      sessionId = event.sessionId;
    } else if (!sawSessionStart) {
      diagnostics.push({
        code: "trace-event-before-session-start",
        eventType: event.type,
        ...location,
        message: `${event.type} appears before session_start`
      });
    }

    if (sawSessionEnd) {
      diagnostics.push({
        code: "trace-event-after-session-end",
        eventType: event.type,
        ...location,
        message: `${event.type} appears after session_end`
      });
    }

    if (sessionId && "sessionId" in event && event.sessionId && event.sessionId !== sessionId) {
      diagnostics.push({
        code: "trace-session-id-mismatch",
        eventType: event.type,
        ...location,
        message: `Event sessionId ${event.sessionId} does not match session ${sessionId}`
      });
    }

    if (event.type === "tool_call") {
      if (calls.has(event.callId)) {
        diagnostics.push({
          code: "trace-duplicate-tool-call",
          eventType: event.type,
          ...location,
          message: `Duplicate tool_call callId ${event.callId}`
        });
      }
      calls.set(event.callId, event);
    }

    if (event.type === "tool_result") {
      const call = calls.get(event.callId);
      if (!call) {
        diagnostics.push({
          code: "trace-orphan-tool-result",
          eventType: event.type,
          ...location,
          message: `tool_result ${event.callId} has no matching tool_call`
        });
      } else if (call.tool !== event.tool) {
        diagnostics.push({
          code: "trace-tool-result-tool-mismatch",
          eventType: event.type,
          ...location,
          message: `tool_result ${event.callId} tool ${event.tool} does not match tool_call tool ${call.tool}`
        });
      }

      if (results.has(event.callId)) {
        diagnostics.push({
          code: "trace-duplicate-tool-result",
          eventType: event.type,
          ...location,
          message: `Duplicate tool_result callId ${event.callId}`
        });
      }
      results.set(event.callId, event);
    }

    if (event.type === "session_end") {
      if (sawSessionEnd) {
        diagnostics.push({
          code: "trace-duplicate-session-end",
          eventType: event.type,
          ...location,
          message: "Trace contains more than one session_end event"
        });
      }
      sawSessionEnd = true;
    }
  });

  if (!sawSessionStart) {
    diagnostics.push({
      code: "trace-missing-session-start",
      message: "Trace is missing session_start"
    });
  }

  if (!sawSessionEnd) {
    diagnostics.push({
      code: "trace-missing-session-end",
      message: "Trace is missing session_end"
    });
  }

  for (const [callId, call] of calls) {
    if (!results.has(callId)) {
      diagnostics.push({
        code: "trace-missing-tool-result",
        eventType: "tool_call",
        seq: call.seq,
        message: `tool_call ${callId} has no matching tool_result`
      });
    }
  }

  return {
    ok: diagnostics.length === 0,
    eventCount: events.length,
    diagnostics
  };
}

export function renderTraceValidationMarkdown(report: TraceValidationReport): string {
  const lines = ["# Agent Trace Validation", "", `Status: ${report.ok ? "pass" : "fail"}`, `Events: ${report.eventCount}`];
  if ("skippedBlankLines" in report && typeof report.skippedBlankLines === "number") {
    lines.push(`Skipped blank lines: ${report.skippedBlankLines}`);
  }

  if (report.diagnostics.length > 0) {
    lines.push("", "## Diagnostics");
    for (const diagnostic of report.diagnostics) {
      const where = diagnostic.seq ? `seq ${diagnostic.seq}` : diagnostic.line ? `line ${diagnostic.line}` : "trace";
      lines.push(`- FAIL ${diagnostic.code} (${where}): ${diagnostic.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
