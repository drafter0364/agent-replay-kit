import { readTraceFile } from "./io.js";
import type { TraceEvent } from "./types.js";
import { stableStringify } from "./utils.js";

export type TraceChangeKind = "added" | "removed" | "modified";

export interface TraceChange {
  kind: TraceChangeKind;
  index: number;
  message: string;
  before?: TraceEvent;
  after?: TraceEvent;
}

export interface TraceDiff {
  changed: boolean;
  changes: TraceChange[];
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

export function diffTraces(before: TraceEvent[], after: TraceEvent[]): TraceDiff {
  const changes: TraceChange[] = [];
  let unchanged = 0;
  const length = Math.max(before.length, after.length);

  for (let index = 0; index < length; index += 1) {
    const oldEvent = before[index];
    const newEvent = after[index];

    if (!oldEvent && newEvent) {
      changes.push({ kind: "added", index, after: newEvent, message: `Added ${newEvent.type} at #${index + 1}` });
      continue;
    }

    if (oldEvent && !newEvent) {
      changes.push({ kind: "removed", index, before: oldEvent, message: `Removed ${oldEvent.type} at #${index + 1}` });
      continue;
    }

    if (oldEvent && newEvent && comparableEvent(oldEvent) !== comparableEvent(newEvent)) {
      changes.push({
        kind: "modified",
        index,
        before: oldEvent,
        after: newEvent,
        message: `Changed ${oldEvent.type} -> ${newEvent.type} at #${index + 1}`
      });
      continue;
    }

    unchanged += 1;
  }

  return {
    changed: changes.length > 0,
    changes,
    summary: {
      added: changes.filter((change) => change.kind === "added").length,
      removed: changes.filter((change) => change.kind === "removed").length,
      modified: changes.filter((change) => change.kind === "modified").length,
      unchanged
    }
  };
}

export async function diffTraceFiles(beforePath: string, afterPath: string): Promise<TraceDiff> {
  return diffTraces(await readTraceFile(beforePath), await readTraceFile(afterPath));
}

export function renderTraceDiffMarkdown(diff: TraceDiff): string {
  const lines = [
    "# Agent Trace Diff",
    "",
    `Changed: ${diff.changed ? "yes" : "no"}`,
    `Summary: ${diff.summary.added} added, ${diff.summary.removed} removed, ${diff.summary.modified} modified, ${diff.summary.unchanged} unchanged`
  ];

  if (diff.changes.length > 0) {
    lines.push("", "## Changes");
    for (const change of diff.changes) {
      lines.push(`- ${change.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function comparableEvent(event: TraceEvent): string {
  const { timestamp, seq, ...rest } = event;
  void timestamp;
  void seq;
  return stableStringify(rest);
}
