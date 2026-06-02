import { createReadStream } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname } from "node:path";
import { createGunzip, gzipSync } from "node:zlib";
import { parseTraceLine } from "./schema.js";
import type { TraceEvent } from "./types.js";

export async function ensureParentDir(filePath: string): Promise<void> {
  try {
    await mkdir(dirname(filePath), { recursive: true });
  } catch (error) {
    throw fileError("create parent directory for", filePath, error);
  }
}

export async function appendTraceEvent(filePath: string, event: TraceEvent): Promise<void> {
  if (isGzipTrace(filePath)) {
    throw new Error(`Cannot append trace events to gzip trace file ${filePath}; use writeTraceFile instead`);
  }
  await ensureParentDir(filePath);
  try {
    await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
  } catch (error) {
    throw fileError("append trace event to", filePath, error);
  }
}

export async function writeTraceFile(filePath: string, events: TraceEvent[]): Promise<void> {
  await ensureParentDir(filePath);
  const body = events.map((event) => JSON.stringify(event)).join("\n");
  const content = body.length > 0 ? `${body}\n` : "";
  try {
    await writeFile(filePath, isGzipTrace(filePath) ? gzipSync(content) : content, isGzipTrace(filePath) ? undefined : "utf8");
  } catch (error) {
    throw fileError("write trace file", filePath, error);
  }
}

export async function readTraceFile(filePath: string): Promise<TraceEvent[]> {
  const events: TraceEvent[] = [];
  for await (const event of readTraceFileStream(filePath)) {
    events.push(event);
  }
  return events;
}

export async function* readTraceFileStream(filePath: string): AsyncGenerator<TraceEvent> {
  const fileStream = createReadStream(filePath);
  const input = isGzipTrace(filePath) ? fileStream.pipe(createGunzip()) : fileStream;
  input.setEncoding("utf8");
  const lines = createInterface({
    input,
    crlfDelay: Infinity
  });
  let lineNumber = 0;

  try {
    for await (const line of lines) {
      lineNumber += 1;
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      yield parseTraceLine(trimmed, lineNumber);
    }
  } catch (error) {
    throw fileError("read trace file", filePath, error);
  }
}

function fileError(operation: string, filePath: string, error: unknown): Error {
  return new Error(`Failed to ${operation} ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
}

function isGzipTrace(filePath: string): boolean {
  return filePath.endsWith(".gz");
}
