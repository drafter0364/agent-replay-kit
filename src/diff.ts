import { readTraceFile } from "./io.js";
import type { TraceEvent } from "./types.js";
import { stableStringify } from "./utils.js";

export type TraceChangeKind = "added" | "removed" | "modified";
export type TraceDiffMode = "positional" | "semantic";

export interface TraceChange {
  kind: TraceChangeKind;
  index: number;
  message: string;
  before?: TraceEvent;
  after?: TraceEvent;
}

export interface TraceDiff {
  mode: TraceDiffMode;
  changed: boolean;
  changes: TraceChange[];
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

export interface TraceDiffOptions {
  mode?: TraceDiffMode;
}

export function diffTraces(before: TraceEvent[], after: TraceEvent[], options: TraceDiffOptions = {}): TraceDiff {
  if (options.mode === "semantic") {
    return diffTracesSemantic(before, after);
  }
  return diffTracesPositional(before, after);
}

export function diffTracesPositional(before: TraceEvent[], after: TraceEvent[]): TraceDiff {
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
    mode: "positional",
    changed: changes.length > 0,
    changes,
    summary: summarizeChanges(changes, unchanged)
  };
}

export function diffTracesSemantic(before: TraceEvent[], after: TraceEvent[]): TraceDiff {
  const beforeGroups = groupSemanticEvents(before);
  const afterGroups = groupSemanticEvents(after);
  const changes: TraceChange[] = [];
  let unchanged = 0;
  const keys = Array.from(new Set([...beforeGroups.keys(), ...afterGroups.keys()]));

  for (const key of keys) {
    const oldEvent = beforeGroups.get(key);
    const newEvent = afterGroups.get(key);
    const index = newEvent?.index ?? oldEvent?.index ?? 0;

    if (!oldEvent && newEvent) {
      changes.push({ kind: "added", index, after: newEvent.event, message: `Added ${newEvent.event.type} ${key}` });
      continue;
    }

    if (oldEvent && !newEvent) {
      changes.push({ kind: "removed", index, before: oldEvent.event, message: `Removed ${oldEvent.event.type} ${key}` });
      continue;
    }

    if (oldEvent && newEvent && comparableEvent(oldEvent.event) !== comparableEvent(newEvent.event)) {
      changes.push({
        kind: "modified",
        index,
        before: oldEvent.event,
        after: newEvent.event,
        message: `Changed ${oldEvent.event.type} ${key}`
      });
      continue;
    }

    unchanged += 1;
  }

  return {
    mode: "semantic",
    changed: changes.length > 0,
    changes,
    summary: summarizeChanges(changes, unchanged)
  };
}

export async function diffTraceFiles(beforePath: string, afterPath: string, options: TraceDiffOptions = {}): Promise<TraceDiff> {
  return diffTraces(await readTraceFile(beforePath), await readTraceFile(afterPath), options);
}

export function renderTraceDiffMarkdown(diff: TraceDiff): string {
  const lines = [
    "# Agent Trace Diff",
    "",
    `Mode: ${diff.mode}`,
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
  const rest = { ...event };
  delete rest.timestamp;
  delete rest.seq;
  return stableStringify(rest);
}

function summarizeChanges(changes: TraceChange[], unchanged: number): TraceDiff["summary"] {
  return changes.reduce(
    (summary, change) => {
      summary[change.kind] += 1;
      return summary;
    },
    { added: 0, removed: 0, modified: 0, unchanged }
  );
}

function groupSemanticEvents(events: TraceEvent[]): Map<string, { event: TraceEvent; index: number }> {
  const groups = new Map<string, { event: TraceEvent; index: number }>();
  const counters = new Map<string, number>();

  events.forEach((event, index) => {
    const baseKey = semanticBaseKey(event);
    const count = counters.get(baseKey) ?? 0;
    counters.set(baseKey, count + 1);
    const key = count === 0 ? baseKey : `${baseKey}#${count + 1}`;
    groups.set(key, { event, index });
  });

  return groups;
}

function semanticBaseKey(event: TraceEvent): string {
  switch (event.type) {
    case "tool_call":
    case "tool_result":
      return `${event.type}:${event.callId}`;
    case "session_start":
    case "session_end":
      return event.type;
    case "assertion":
      return `assertion:${event.name}`;
    case "model_message":
      return `model_message:${event.role}`;
  }
}
