import { readTraceFile, writeTraceFile } from "./io.js";
import type { JsonObject, JsonValue, TraceEvent } from "./types.js";
import { isRecord, toJsonValue } from "./utils.js";

export interface SanitizerRule {
  pattern: RegExp;
  replacement: string;
}

export interface SanitizerOptions {
  rules?: SanitizerRule[];
}

const sensitiveKey = /(?:api[_-]?key|token|secret|password|authorization|cookie|credential)/i;
const defaultRules: SanitizerRule[] = [
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/g, replacement: "sk-[REDACTED]" },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/g, replacement: "Bearer [REDACTED]" },
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "[EMAIL]" },
  { pattern: /\bhttps?:\/\/[^\s"')]+/g, replacement: "[URL]" },
  { pattern: /\b[A-Za-z]:\\(?:[^\s"'\\]+\\)*[^\s"'\\]+/g, replacement: "[PATH]" },
  { pattern: /\b(?:\/Users|\/home|\/tmp|\/var\/folders)\/[^\s"')]+/g, replacement: "[PATH]" }
];

export function sanitizeTraceEvents(events: TraceEvent[], options: SanitizerOptions = {}): TraceEvent[] {
  return events.map((event) => sanitizeValue(event, [...defaultRules, ...(options.rules ?? [])]) as unknown as TraceEvent);
}

export async function sanitizeTraceFile(inputPath: string, outputPath: string, options?: SanitizerOptions): Promise<void> {
  const events = await readTraceFile(inputPath);
  await writeTraceFile(outputPath, sanitizeTraceEvents(events, options));
}

function sanitizeValue(value: unknown, rules: SanitizerRule[], key?: string): JsonValue {
  if (key && sensitiveKey.test(key)) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    return rules.reduce((current, rule) => current.replace(rule.pattern, rule.replacement), value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, rules));
  }

  if (isRecord(value)) {
    const sanitized: JsonObject = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      sanitized[childKey] = sanitizeValue(childValue, rules, childKey);
    }
    return sanitized;
  }

  return toJsonValue(value);
}
