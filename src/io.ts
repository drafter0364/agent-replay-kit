import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseTraceLine } from "./schema.js";
import type { TraceEvent } from "./types.js";

export async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export async function appendTraceEvent(filePath: string, event: TraceEvent): Promise<void> {
  await ensureParentDir(filePath);
  await writeFile(filePath, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
}

export async function writeTraceFile(filePath: string, events: TraceEvent[]): Promise<void> {
  await ensureParentDir(filePath);
  const body = events.map((event) => JSON.stringify(event)).join("\n");
  await writeFile(filePath, body.length > 0 ? `${body}\n` : "", "utf8");
}

export async function readTraceFile(filePath: string): Promise<TraceEvent[]> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => parseTraceLine(line, index + 1));
}
