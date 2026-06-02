import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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
  try {
    await writeFile(filePath, body.length > 0 ? `${body}\n` : "", "utf8");
  } catch (error) {
    throw fileError("write trace file", filePath, error);
  }
}

export async function readTraceFile(filePath: string): Promise<TraceEvent[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    throw fileError("read trace file", filePath, error);
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => parseTraceLine(line, index + 1));
}

function fileError(operation: string, filePath: string, error: unknown): Error {
  return new Error(`Failed to ${operation} ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
}
