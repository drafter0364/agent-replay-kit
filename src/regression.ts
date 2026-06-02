import { assertTrace, renderAssertionMarkdown, type TraceAssertionConfig, type TraceAssertionReport } from "./assert.js";
import { diffTraces, renderTraceDiffMarkdown, type TraceChange, type TraceDiff } from "./diff.js";
import { readTraceFile } from "./io.js";
import type { TraceEvent, TraceValidationReport } from "./types.js";
import { renderTraceValidationMarkdown, validateTrace } from "./validation.js";

export interface GoldenTraceRegressionReport {
  ok: boolean;
  baselineValidation: TraceValidationReport;
  actualValidation: TraceValidationReport;
  assertions?: TraceAssertionReport;
  diff: TraceDiff;
  regressionChanges: TraceChange[];
}

export function testGoldenTraceRegression(
  baseline: TraceEvent[],
  actual: TraceEvent[],
  policy: TraceAssertionConfig = {}
): GoldenTraceRegressionReport {
  const baselineValidation = validateTrace(baseline);
  const actualValidation = validateTrace(actual);
  const assertions = Object.keys(policy).length > 0 ? assertTrace(actual, policy) : undefined;
  const diff = diffTraces(baseline, actual, { mode: "semantic" });
  const regressionChanges = diff.changes.filter((change) => !isIgnorableGoldenChange(change));

  return {
    ok:
      baselineValidation.ok &&
      actualValidation.ok &&
      (assertions?.ok ?? true) &&
      regressionChanges.length === 0,
    baselineValidation,
    actualValidation,
    assertions,
    diff,
    regressionChanges
  };
}

export async function testGoldenTraceRegressionFiles(
  baselinePath: string,
  actualPath: string,
  policy: TraceAssertionConfig = {}
): Promise<GoldenTraceRegressionReport> {
  return testGoldenTraceRegression(await readTraceFile(baselinePath), await readTraceFile(actualPath), policy);
}

export function renderGoldenTraceRegressionMarkdown(report: GoldenTraceRegressionReport): string {
  const lines = ["# Agent Trace Regression", "", `Status: ${report.ok ? "pass" : "fail"}`];

  if (!report.baselineValidation.ok) {
    lines.push("", "## Baseline validation", renderTraceValidationMarkdown(report.baselineValidation).trim());
  }

  if (!report.actualValidation.ok) {
    lines.push("", "## Actual validation", renderTraceValidationMarkdown(report.actualValidation).trim());
  }

  if (report.assertions && !report.assertions.ok) {
    lines.push("", "## Policy assertions", renderAssertionMarkdown(report.assertions).trim());
  }

  if (report.regressionChanges.length > 0) {
    lines.push("", "## Regression changes");
    for (const change of report.regressionChanges) {
      lines.push(`- ${change.message}`);
    }
  }

  if (report.regressionChanges.length === 0 && report.diff.changed) {
    lines.push("", "## Ignored semantic changes", renderTraceDiffMarkdown(report.diff).trim());
  }

  return `${lines.join("\n")}\n`;
}

function isIgnorableGoldenChange(change: TraceChange): boolean {
  return change.before?.type === "model_message" || change.after?.type === "model_message";
}
