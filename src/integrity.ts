import { createHash } from "node:crypto";
import { readTraceFile, writeTraceFile } from "./io.js";
import type { TraceDiagnostic, TraceEvent, TraceValidationReport } from "./types.js";
import { stableStringify } from "./utils.js";

const GENESIS_HASH = "0".repeat(64);

export function sealTraceEvents(events: TraceEvent[]): TraceEvent[] {
  let prevHash = GENESIS_HASH;
  return events.map((event) => {
    const hash = hashEvent(event, prevHash);
    const sealed = {
      ...stripIntegrity(event),
      prevHash,
      hash
    } as TraceEvent;
    prevHash = hash;
    return sealed;
  });
}

export async function sealTraceFile(inputPath: string, outputPath: string): Promise<void> {
  await writeTraceFile(outputPath, sealTraceEvents(await readTraceFile(inputPath)));
}

export function verifyTraceIntegrity(events: TraceEvent[]): TraceValidationReport {
  const diagnostics: TraceDiagnostic[] = [];
  let prevHash = GENESIS_HASH;

  events.forEach((event, index) => {
    if (!event.hash) {
      diagnostics.push({
        code: "trace-integrity-missing-hash",
        line: index + 1,
        eventType: event.type,
        message: `${event.type} is missing hash`
      });
      return;
    }

    if (event.prevHash !== prevHash) {
      diagnostics.push({
        code: "trace-integrity-prev-hash-mismatch",
        line: index + 1,
        eventType: event.type,
        message: `${event.type} prevHash does not match previous event hash`
      });
    }

    const expectedHash = hashEvent(event, prevHash);
    if (event.hash !== expectedHash) {
      diagnostics.push({
        code: "trace-integrity-hash-mismatch",
        line: index + 1,
        eventType: event.type,
        message: `${event.type} hash does not match event content`
      });
    }

    prevHash = event.hash;
  });

  return {
    ok: diagnostics.length === 0,
    eventCount: events.length,
    diagnostics
  };
}

export async function verifyTraceFileIntegrity(filePath: string): Promise<TraceValidationReport> {
  return verifyTraceIntegrity(await readTraceFile(filePath));
}

export function renderTraceIntegrityMarkdown(report: TraceValidationReport): string {
  const lines = ["# Agent Trace Integrity", "", `Status: ${report.ok ? "pass" : "fail"}`, `Events: ${report.eventCount}`];
  if (report.diagnostics.length > 0) {
    lines.push("", "## Diagnostics");
    for (const diagnostic of report.diagnostics) {
      const where = diagnostic.seq ? `seq ${diagnostic.seq}` : diagnostic.line ? `line ${diagnostic.line}` : "trace";
      lines.push(`- FAIL ${diagnostic.code} (${where}): ${diagnostic.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function hashEvent(event: TraceEvent, prevHash: string): string {
  return createHash("sha256").update(prevHash).update("\n").update(stableStringify(stripIntegrity(event))).digest("hex");
}

function stripIntegrity(event: TraceEvent): Omit<TraceEvent, "hash" | "prevHash"> {
  const copy = { ...event };
  delete copy.hash;
  delete copy.prevHash;
  return copy;
}
