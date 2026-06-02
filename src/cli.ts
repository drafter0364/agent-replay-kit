#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { assertTraceFile, renderAssertionMarkdown, type TraceAssertionConfig } from "./assert.js";
import { diffTraceFiles, renderTraceDiffMarkdown } from "./diff.js";
import { readTraceFile } from "./io.js";
import { createRecorder } from "./recorder.js";
import { collectToolInteractions, createReplayerFromFile } from "./replay.js";
import { sanitizeTraceFile } from "./sanitize.js";
import { renderTraceSummaryMarkdown, summarizeTraceFile } from "./inspect.js";
import type { JsonValue } from "./types.js";
import { renderTraceValidationMarkdown, validateTraceFile } from "./validation.js";
import { mergeAssertionConfigs, readAssertionPolicyFile } from "./policy.js";
import { renderGoldenTraceRegressionMarkdown, testGoldenTraceRegressionFiles } from "./regression.js";

interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

interface ParsedArgs {
  command?: string;
  positionals: string[];
  options: Record<string, string[] | boolean>;
}

const helpText = `agent-replay <command>

Commands:
  record --out trace.jsonl --tool name [--args-json '{}'] [--result-json '{}']
  replay trace.jsonl [--tool name --args-json '{}']
  diff old.jsonl new.jsonl [--format markdown|json]
  sanitize trace.jsonl --out public.jsonl [--format text|json]
  assert trace.jsonl [--policy policy.json] [--must-call tool] [--must-not-call tool] [--max-shell-calls n]
  test --baseline golden.jsonl --actual current.jsonl [--policy policy.json]
  validate trace.jsonl [--format markdown|json]
  inspect trace.jsonl [--format markdown|json]
`;

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const parsed = parseArgs(argv);

  try {
    switch (parsed.command) {
      case undefined:
      case "help":
      case "--help":
      case "-h":
        io.stdout(helpText);
        return 0;
      case "record":
        return await runRecord(parsed, io);
      case "replay":
        return await runReplay(parsed, io);
      case "diff":
        return await runDiff(parsed, io);
      case "test":
        return await runTest(parsed, io);
      case "sanitize":
        return await runSanitize(parsed, io);
      case "assert":
        return await runAssert(parsed, io);
      case "validate":
        return await runValidate(parsed, io);
      case "inspect":
        return await runInspect(parsed, io);
      default:
        io.stderr(`Unknown command: ${parsed.command}\n`);
        io.stderr(helpText);
        return 2;
    }
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const positionals: string[] = [];
  const options: Record<string, string[] | boolean> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const name = token.slice(2);
    const next = rest[index + 1];
    const value = next && !next.startsWith("--") ? next : true;
    if (value !== true) {
      index += 1;
    }

    const existing = options[name];
    if (existing === undefined) {
      options[name] = value === true ? true : [value];
    } else if (existing === true) {
      options[name] = value === true ? true : [value];
    } else if (Array.isArray(existing) && value !== true) {
      existing.push(value);
    }
  }

  return { command, positionals, options };
}

async function runRecord(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const out = requiredOption(parsed, "out");
  const tool = requiredOption(parsed, "tool");
  const args = parseJsonOption(parsed, "args-json", {});
  const result = parseJsonOption(parsed, "result-json", {});

  const recorder = createRecorder(out, { agent: "agent-replay-cli" });
  await recorder.start();
  await recorder.tool(tool, args, () => result);
  await recorder.end({ ok: true });
  io.stdout(`Wrote trace to ${out}\n`);
  return 0;
}

async function runReplay(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const trace = requiredPositional(parsed, 0, "trace file");
  const tool = optionalOption(parsed, "tool");

  if (!tool) {
    const events = await readTraceFile(trace);
    const interactions = collectToolInteractions(events);
    io.stdout(JSON.stringify({ toolCalls: interactions.length }, null, 2) + "\n");
    return 0;
  }

  const args = parseJsonOption(parsed, "args-json", {});
  const replayer = await createReplayerFromFile(trace);
  const result = replayer.replayTool(tool, args);
  io.stdout(JSON.stringify(result, null, 2) + "\n");
  return 0;
}

async function runDiff(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const before = requiredPositional(parsed, 0, "old trace file");
  const after = requiredPositional(parsed, 1, "new trace file");
  const format = optionalOption(parsed, "format") ?? "markdown";
  const mode = parseDiffMode(optionalOption(parsed, "mode") ?? "positional");
  const diff = await diffTraceFiles(before, after, { mode });
  io.stdout(format === "json" ? JSON.stringify(diff, null, 2) + "\n" : renderTraceDiffMarkdown(diff));
  return diff.changed ? 1 : 0;
}

async function runTest(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const baseline = requiredOption(parsed, "baseline");
  const actual = requiredOption(parsed, "actual");
  const format = optionalOption(parsed, "format") ?? "markdown";
  const policyPath = optionalOption(parsed, "policy");
  const policy = policyPath ? await readAssertionPolicyFile(policyPath) : {};
  const report = await testGoldenTraceRegressionFiles(baseline, actual, policy);
  io.stdout(format === "json" ? JSON.stringify(report, null, 2) + "\n" : renderGoldenTraceRegressionMarkdown(report));
  return report.ok ? 0 : 1;
}

async function runSanitize(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const trace = requiredPositional(parsed, 0, "trace file");
  const out = requiredOption(parsed, "out");
  const format = optionalOption(parsed, "format") ?? "text";
  const report = await sanitizeTraceFile(trace, out, { allowedUrlHosts: optionList(parsed, "allow-url-host") });
  if (format === "json") {
    io.stdout(JSON.stringify({ output: out, ...report }, null, 2) + "\n");
  } else {
    io.stdout(`Wrote sanitized trace to ${out} (${report.redactionCount} redactions)\n`);
  }
  return 0;
}

async function runAssert(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const trace = requiredPositional(parsed, 0, "trace file");
  const format = optionalOption(parsed, "format") ?? "markdown";
  const flagConfig: TraceAssertionConfig = {
    mustCall: optionList(parsed, "must-call"),
    mustNotCall: optionList(parsed, "must-not-call"),
    maxShellCalls: optionalNumberOption(parsed, "max-shell-calls"),
    forbiddenCommands: optionList(parsed, "forbid-command"),
    forbiddenCommandPrefixes: optionList(parsed, "forbid-command-prefix"),
    forbiddenCommandPatterns: optionList(parsed, "forbid-command-pattern")
  };
  const policyPath = optionalOption(parsed, "policy");
  const policyConfig = policyPath ? await readAssertionPolicyFile(policyPath) : {};
  const config = mergeAssertionConfigs(policyConfig, flagConfig);
  const report = await assertTraceFile(trace, config);
  io.stdout(format === "json" ? JSON.stringify(report, null, 2) + "\n" : renderAssertionMarkdown(report));
  return report.ok ? 0 : 1;
}

async function runValidate(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const trace = requiredPositional(parsed, 0, "trace file");
  const format = optionalOption(parsed, "format") ?? "markdown";
  const report = await validateTraceFile(trace);
  io.stdout(format === "json" ? JSON.stringify(report, null, 2) + "\n" : renderTraceValidationMarkdown(report));
  return report.ok ? 0 : 1;
}

async function runInspect(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const trace = requiredPositional(parsed, 0, "trace file");
  const format = optionalOption(parsed, "format") ?? "markdown";
  const summary = await summarizeTraceFile(trace);
  io.stdout(format === "json" ? JSON.stringify(summary, null, 2) + "\n" : renderTraceSummaryMarkdown(summary));
  return 0;
}

function requiredPositional(parsed: ParsedArgs, index: number, label: string): string {
  const value = parsed.positionals[index];
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function requiredOption(parsed: ParsedArgs, name: string): string {
  const value = optionalOption(parsed, name);
  if (!value) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

function optionalOption(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.options[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}

function optionList(parsed: ParsedArgs, name: string): string[] | undefined {
  const value = parsed.options[name];
  if (Array.isArray(value)) {
    return value;
  }
  return undefined;
}

function optionalNumberOption(parsed: ParsedArgs, name: string): number | undefined {
  const value = optionalOption(parsed, name);
  if (value === undefined) {
    return undefined;
  }
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) {
    throw new Error(`--${name} must be a number`);
  }
  return parsedValue;
}

function parseJsonOption(parsed: ParsedArgs, name: string, fallback: JsonValue): JsonValue {
  const value = optionalOption(parsed, name);
  if (value === undefined) {
    return fallback;
  }
  try {
    return JSON.parse(value) as JsonValue;
  } catch (error) {
    throw new Error(`Failed to parse --${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseDiffMode(value: string): "positional" | "semantic" {
  if (value !== "positional" && value !== "semantic") {
    throw new Error("--mode must be positional or semantic");
  }
  return value;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text)
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
