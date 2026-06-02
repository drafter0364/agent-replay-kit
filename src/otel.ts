import { createHash } from "node:crypto";
import { readTraceFile } from "./io.js";
import type { JsonValue, ToolCallEvent, ToolResultEvent, TraceEvent } from "./types.js";
import { stableStringify } from "./utils.js";

export type OtelSpanStatus = "UNSET" | "OK" | "ERROR";

export interface OtelSpanLike {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: "INTERNAL" | "CLIENT";
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes: Record<string, JsonValue>;
  status: {
    code: OtelSpanStatus;
    message?: string;
  };
}

export interface OtelTraceExport {
  resource: {
    serviceName: "agent-replay-kit";
    attributes: Record<string, JsonValue>;
  };
  spans: OtelSpanLike[];
}

export function exportTraceToOtel(events: TraceEvent[]): OtelTraceExport {
  const session = events.find((event) => event.type === "session_start");
  const sessionEnd = [...events].reverse().find((event) => event.type === "session_end");
  const traceId = hashHex(session?.sessionId ?? stableStringify(events), 32);
  const sessionSpanId = hashHex(`${traceId}:session`, 16);
  const spans: OtelSpanLike[] = [];

  if (session?.type === "session_start") {
    spans.push({
      traceId,
      spanId: sessionSpanId,
      name: `agent.session${session.agent ? ` ${session.agent}` : ""}`,
      kind: "INTERNAL",
      startTimeUnixNano: toUnixNano(session.timestamp),
      endTimeUnixNano: sessionEnd?.type === "session_end" ? toUnixNano(sessionEnd.timestamp) : undefined,
      attributes: {
        "agent.session_id": session.sessionId,
        "agent.name": session.agent ?? null,
        "agent.run_id": session.runId ?? null,
        "trace.event_count": events.length
      },
      status: sessionEnd?.type === "session_end" && sessionEnd.ok === false ? { code: "ERROR" } : { code: "OK" }
    });
  }

  const calls = new Map<string, ToolCallEvent>();
  for (const event of events) {
    if (event.type === "tool_call") {
      calls.set(event.callId, event);
      continue;
    }

    if (event.type === "tool_result") {
      const call = calls.get(event.callId);
      spans.push(toolSpan(traceId, sessionSpanId, call, event));
      continue;
    }

    if (event.type === "model_message") {
      spans.push({
        traceId,
        spanId: hashHex(`${traceId}:model:${event.seq ?? spans.length}:${event.role}:${event.content ?? ""}`, 16),
        parentSpanId: session ? sessionSpanId : undefined,
        name: `model.message ${event.role}`,
        kind: "INTERNAL",
        startTimeUnixNano: toUnixNano(event.timestamp),
        endTimeUnixNano: toUnixNano(event.timestamp),
        attributes: {
          "model.role": event.role,
          "model.content_length": event.content?.length ?? 0,
          "model.tool_call_count": event.toolCalls?.length ?? 0,
          "model.usage.input_tokens": event.usage?.inputTokens ?? null,
          "model.usage.output_tokens": event.usage?.outputTokens ?? null,
          "model.usage.total_tokens": event.usage?.totalTokens ?? null
        },
        status: { code: "UNSET" }
      });
    }
  }

  return {
    resource: {
      serviceName: "agent-replay-kit",
      attributes: {
        "telemetry.sdk.name": "agent-replay-kit",
        "telemetry.schema": "span-like-json"
      }
    },
    spans: spans.map(stripUndefinedSpan)
  };
}

export async function exportTraceFileToOtel(filePath: string): Promise<OtelTraceExport> {
  return exportTraceToOtel(await readTraceFile(filePath));
}

function toolSpan(traceId: string, parentSpanId: string | undefined, call: ToolCallEvent | undefined, result: ToolResultEvent): OtelSpanLike {
  const name = `tool.${result.tool}`;
  return {
    traceId,
    spanId: hashHex(`${traceId}:tool:${result.callId}`, 16),
    parentSpanId,
    name,
    kind: "CLIENT",
    startTimeUnixNano: toUnixNano(call?.timestamp ?? result.timestamp),
    endTimeUnixNano: toUnixNano(result.timestamp),
    attributes: {
      "tool.name": result.tool,
      "tool.call_id": result.callId,
      "tool.args": call ? stableStringify(call.args) : null,
      "tool.side_effect": call?.metadata?.sideEffect ?? null,
      "tool.risk": call?.metadata?.risk ?? null,
      "tool.duration_ms": result.durationMs ?? null,
      "tool.result_present": result.result !== undefined,
      "tool.ok": result.ok
    },
    status: result.ok ? { code: "OK" } : { code: "ERROR", message: result.error?.message }
  };
}

function toUnixNano(timestamp: string | undefined): string | undefined {
  if (!timestamp) {
    return undefined;
  }
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) {
    return undefined;
  }
  return BigInt(ms) * 1_000_000n + "";
}

function hashHex(input: string, length: number): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

function stripUndefinedSpan(span: OtelSpanLike): OtelSpanLike {
  return JSON.parse(JSON.stringify(span)) as OtelSpanLike;
}
