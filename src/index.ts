export type {
  AssertionEvent,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  ModelMessageEvent,
  RecordedToolInteraction,
  ReplayMatchMode,
  SessionEndEvent,
  SessionStartEvent,
  ToolCallEvent,
  ToolResultEvent,
  TraceBaseEvent,
  TraceEvent,
  TraceEventType,
  TraceValidationResult
} from "./types.js";

export { assertTraceEvent, isTraceEvent, parseTraceLine, validateTraceEvent } from "./schema.js";
export { appendTraceEvent, readTraceFile, writeTraceFile } from "./io.js";
export { createRecorder, TraceRecorder, type RecorderOptions, type SessionEndOptions } from "./recorder.js";
export {
  collectToolInteractions,
  createReplayerFromFile,
  RecordedToolError,
  ReplayMismatchError,
  TraceReplayer,
  type ReplayOptions
} from "./replay.js";
export { diffTraceFiles, diffTraces, renderTraceDiffMarkdown, type TraceChange, type TraceDiff } from "./diff.js";
export { sanitizeTraceEvents, sanitizeTraceFile, type SanitizerOptions, type SanitizerRule } from "./sanitize.js";
export {
  assertTrace,
  assertTraceFile,
  renderAssertionMarkdown,
  type TraceAssertionConfig,
  type TraceAssertionFinding,
  type TraceAssertionReport
} from "./assert.js";
export { renderTraceSummaryMarkdown, summarizeTrace, summarizeTraceFile, type TraceSummary } from "./inspect.js";
