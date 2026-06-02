import { readTraceFile, writeTraceFile } from "./io.js";
import { validateTraceEvent } from "./schema.js";
import type { JsonObject, JsonValue, TraceDiagnostic, TraceEvent } from "./types.js";
import { isRecord, toJsonValue } from "./utils.js";
import { validateTrace } from "./validation.js";

export interface SanitizerRule {
  name?: string;
  pattern: RegExp;
  replacement: string;
  confidence?: "high" | "medium" | "low";
}

export interface SanitizerOptions {
  rules?: SanitizerRule[];
}

export interface SanitizerRedaction {
  path: string;
  rule: string;
  confidence: "high" | "medium" | "low";
}

export interface SanitizerReport {
  ok: boolean;
  redactionCount: number;
  redactions: SanitizerRedaction[];
  validationDiagnostics: TraceDiagnostic[];
}

export interface SanitizedTrace {
  events: TraceEvent[];
  report: SanitizerReport;
}

const sensitiveKey = /(?:api[_-]?key|token|secret|password|authorization|cookie|credential)/i;
const defaultRules: SanitizerRule[] = [
  { name: "openai-api-key", pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/g, replacement: "sk-[REDACTED]", confidence: "high" },
  { name: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/g, replacement: "Bearer [REDACTED]", confidence: "high" },
  { name: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "[EMAIL]", confidence: "medium" },
  { name: "url", pattern: /\bhttps?:\/\/[^\s"')]+/g, replacement: "[URL]", confidence: "medium" },
  { name: "windows-path", pattern: /\b[A-Za-z]:\\(?:[^\s"'\\]+\\)*[^\s"'\\]+/g, replacement: "[PATH]", confidence: "medium" },
  { name: "unix-path", pattern: /\b(?:\/Users|\/home|\/tmp|\/var\/folders)\/[^\s"')]+/g, replacement: "[PATH]", confidence: "medium" }
];

export function sanitizeTraceEvents(events: TraceEvent[], options: SanitizerOptions = {}): TraceEvent[] {
  return sanitizeTraceEventsWithReport(events, options).events;
}

export function sanitizeTraceEventsWithReport(events: TraceEvent[], options: SanitizerOptions = {}): SanitizedTrace {
  const rules = [...defaultRules, ...(options.rules ?? [])];
  const redactions: SanitizerRedaction[] = [];
  const sanitizedEvents = events.map((event, index) => {
    const sanitized = sanitizeValue(event, rules, `$[${index}]`);
    redactions.push(...sanitized.redactions);
    return sanitized.value as unknown as TraceEvent;
  });
  const validationDiagnostics = validateSanitizedEvents(sanitizedEvents);
  const report = {
    ok: validationDiagnostics.length === 0,
    redactionCount: redactions.length,
    redactions,
    validationDiagnostics
  };

  if (!report.ok) {
    throw new Error(
      `Sanitized trace failed validation: ${validationDiagnostics.map((diagnostic) => diagnostic.message).join("; ")}`
    );
  }

  return {
    events: sanitizedEvents,
    report
  };
}

export async function sanitizeTraceFile(inputPath: string, outputPath: string, options?: SanitizerOptions): Promise<SanitizerReport> {
  const events = await readTraceFile(inputPath);
  const sanitized = sanitizeTraceEventsWithReport(events, options);
  await writeTraceFile(outputPath, sanitized.events);
  return sanitized.report;
}

function sanitizeValue(value: unknown, rules: SanitizerRule[], path: string, key?: string): { value: JsonValue; redactions: SanitizerRedaction[] } {
  if (key && sensitiveKey.test(key)) {
    return {
      value: "[REDACTED]",
      redactions: [{ path, rule: "sensitive-key", confidence: "high" }]
    };
  }

  if (typeof value === "string") {
    const redactions: SanitizerRedaction[] = [];
    let current = value;
    for (const [index, rule] of rules.entries()) {
      rule.pattern.lastIndex = 0;
      const next = current.replace(rule.pattern, rule.replacement);
      if (next !== current) {
        redactions.push({
          path,
          rule: rule.name ?? `custom-rule-${index}`,
          confidence: rule.confidence ?? "medium"
        });
      }
      current = next;
    }
    return { value: current, redactions };
  }

  if (Array.isArray(value)) {
    const redactions: SanitizerRedaction[] = [];
    const sanitizedArray = value.map((item, index) => {
      const sanitized = sanitizeValue(item, rules, `${path}[${index}]`);
      redactions.push(...sanitized.redactions);
      return sanitized.value;
    });
    return { value: sanitizedArray, redactions };
  }

  if (isRecord(value)) {
    const sanitized: JsonObject = {};
    const redactions: SanitizerRedaction[] = [];
    for (const [childKey, childValue] of Object.entries(value)) {
      const childPath = `${path}.${childKey}`;
      const child = sanitizeValue(childValue, rules, childPath, childKey);
      sanitized[childKey] = child.value;
      redactions.push(...child.redactions);
    }
    return { value: sanitized, redactions };
  }

  return { value: toJsonValue(value), redactions: [] };
}

function validateSanitizedEvents(events: TraceEvent[]): TraceDiagnostic[] {
  const diagnostics: TraceDiagnostic[] = [];
  events.forEach((event, index) => {
    const validation = validateTraceEvent(event);
    for (const message of validation.errors) {
      diagnostics.push({
        code: "sanitized-event-invalid",
        line: index + 1,
        eventType: event.type,
        message
      });
    }
  });
  diagnostics.push(...validateTrace(events).diagnostics);
  return diagnostics;
}
