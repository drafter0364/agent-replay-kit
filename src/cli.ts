#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertTraceFile, renderAssertionMarkdown, type TraceAssertionConfig } from "./assert.js";
import { diffTraceFiles, renderTraceDiffMarkdown } from "./diff.js";
import { readTraceFile } from "./io.js";
import { createRecorder } from "./recorder.js";
import { collectToolInteractions, createReplayerFromFile } from "./replay.js";
import { sanitizeTraceFile } from "./sanitize.js";
import { buildTraceTimelineFile, renderTraceSummaryMarkdown, summarizeTraceFile } from "./inspect.js";
import type { JsonValue } from "./types.js";
import { renderTraceValidationMarkdown, validateTraceFile } from "./validation.js";
import { mergeAssertionConfigs, readAssertionPolicyFile } from "./policy.js";
import { renderGoldenTraceRegressionMarkdown, testGoldenTraceRegressionFiles } from "./regression.js";
import { exportTraceFileToOtel } from "./otel.js";
import { renderTraceIntegrityMarkdown, sealTraceFile, verifyTraceFileIntegrity } from "./integrity.js";
import { analyzeTraceFile, renderTraceAnalysisMarkdown } from "./analyze.js";
import { bundleTraceFile } from "./bundle.js";
import { filterTraceFile } from "./filter.js";
import { isJsonValue, isRecord } from "./utils.js";

interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

interface ParsedArgs {
  command?: string;
  positionals: string[];
  options: Record<string, string[] | boolean>;
  config?: CliConfig;
}

type CliConfig = Record<string, unknown>;

const helpText = `agent-replay <command>

Commands:
  record --out trace.jsonl --tool name [--args-json '{}'] [--result-json '{}']
  replay trace.jsonl [--tool name --args-json '{}'] [--call-id id]
  diff old.jsonl new.jsonl [--mode positional|semantic] [--format markdown|json]
  filter trace.jsonl --out subset.jsonl [--tool name] [--call-id id] [--side-effect effect] [--ok true|false] [--format text|json]
  sanitize trace.jsonl --out public.jsonl [--format text|json]
  assert trace.jsonl [--policy policy.json] [--must-call tool] [--must-not-call tool] [--max-shell-calls n]
  test --baseline golden.jsonl --actual current.jsonl [--policy policy.json]
  validate trace.jsonl [--format markdown|json]
  inspect trace.jsonl [--format markdown|json]
  analyze trace.jsonl [--format markdown|json] [--max-shell-calls n]
  bundle trace.jsonl --out repro.zip [--policy policy.json] [--allow-url-host host] [--format text|json]
  export-otel trace.jsonl
  seal trace.jsonl --out sealed.jsonl
  verify-integrity trace.jsonl [--format markdown|json]

Most commands also accept --config-file config.json. The file should be a flat JSON object for the current command, and explicit CLI flags win over config values.
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
      default:
        parsed.config = await loadCliConfig(parsed);
        switch (parsed.command) {
          case "record":
            return await runRecord(parsed, io);
          case "replay":
            return await runReplay(parsed, io);
          case "diff":
            return await runDiff(parsed, io);
          case "filter":
            return await runFilter(parsed, io);
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
          case "analyze":
            return await runAnalyze(parsed, io);
          case "bundle":
            return await runBundle(parsed, io);
          case "export-otel":
            return await runExportOtel(parsed, io);
          case "seal":
            return await runSeal(parsed, io);
          case "verify-integrity":
            return await runVerifyIntegrity(parsed, io);
          default:
            io.stderr(`Unknown command: ${parsed.command}\n`);
            io.stderr(helpText);
            return 2;
        }
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
  const out = requiredOptionWithConfig(parsed, "out");
  const tool = requiredOptionWithConfig(parsed, "tool");
  const args = parseJsonOptionWithConfig(parsed, "args-json", {});
  const result = parseJsonOptionWithConfig(parsed, "result-json", {});

  const recorder = createRecorder(out, { agent: "agent-replay-cli" });
  await recorder.start();
  await recorder.tool(tool, args, () => result);
  await recorder.end({ ok: true });
  io.stdout(`Wrote trace to ${out}\n`);
  return 0;
}

async function runReplay(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const trace = requiredPositional(parsed, 0, "trace file");
  const tool = optionalOptionWithConfig(parsed, "tool");
  const callId = optionalOptionWithConfig(parsed, "call-id");

  if (callId) {
    const replayer = await createReplayerFromFile(trace, { matchMode: "call-id" });
    const result = replayer.replayToolByCallId(callId, {
      tool,
      args: hasOptionWithConfig(parsed, "args-json") ? parseJsonOptionWithConfig(parsed, "args-json", {}) : undefined
    });
    io.stdout(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  if (!tool) {
    const events = await readTraceFile(trace);
    const interactions = collectToolInteractions(events);
    io.stdout(JSON.stringify({ toolCalls: interactions.length }, null, 2) + "\n");
    return 0;
  }

  const args = parseJsonOptionWithConfig(parsed, "args-json", {});
  const replayer = await createReplayerFromFile(trace);
  const result = replayer.replayTool(tool, args);
  io.stdout(JSON.stringify(result, null, 2) + "\n");
  return 0;
}

async function runDiff(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const before = requiredPositional(parsed, 0, "old trace file");
  const after = requiredPositional(parsed, 1, "new trace file");
  const format = optionalOptionWithConfig(parsed, "format") ?? "markdown";
  const mode = parseDiffMode(optionalOptionWithConfig(parsed, "mode") ?? "positional");
  const diff = await diffTraceFiles(before, after, { mode });
  io.stdout(format === "json" ? JSON.stringify(diff, null, 2) + "\n" : renderTraceDiffMarkdown(diff));
  return diff.changed ? 1 : 0;
}

async function runFilter(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const trace = requiredPositional(parsed, 0, "trace file");
  const out = requiredOptionWithConfig(parsed, "out");
  const format = optionalOptionWithConfig(parsed, "format") ?? "text";
  const report = await filterTraceFile(trace, out, {
    tools: optionListWithConfig(parsed, "tool"),
    callIds: optionListWithConfig(parsed, "call-id"),
    sideEffects: optionListWithConfig(parsed, "side-effect"),
    ok: optionalBooleanOptionWithConfig(parsed, "ok")
  });
  if (format === "json") {
    io.stdout(JSON.stringify({ output: out, ...report }, null, 2) + "\n");
  } else {
    io.stdout(`Wrote filtered trace to ${out} (${report.outputEventCount}/${report.inputEventCount} events)\n`);
  }
  return 0;
}

async function runTest(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const baseline = requiredOptionWithConfig(parsed, "baseline");
  const actual = requiredOptionWithConfig(parsed, "actual");
  const format = optionalOptionWithConfig(parsed, "format") ?? "markdown";
  const policyPath = optionalOptionWithConfig(parsed, "policy");
  const policy = policyPath ? await readAssertionPolicyFile(policyPath) : {};
  const report = await testGoldenTraceRegressionFiles(baseline, actual, policy);
  io.stdout(format === "json" ? JSON.stringify(report, null, 2) + "\n" : renderGoldenTraceRegressionMarkdown(report));
  return report.ok ? 0 : 1;
}

async function runSanitize(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const trace = requiredPositional(parsed, 0, "trace file");
  const out = requiredOptionWithConfig(parsed, "out");
  const format = optionalOptionWithConfig(parsed, "format") ?? "text";
  const report = await sanitizeTraceFile(trace, out, { allowedUrlHosts: optionListWithConfig(parsed, "allow-url-host") });
  if (format === "json") {
    io.stdout(JSON.stringify({ output: out, ...report }, null, 2) + "\n");
  } else {
    io.stdout(`Wrote sanitized trace to ${out} (${report.redactionCount} redactions)\n`);
  }
  return 0;
}

async function runAssert(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const trace = requiredPositional(parsed, 0, "trace file");
  const format = optionalOptionWithConfig(parsed, "format") ?? "markdown";
  const flagConfig: TraceAssertionConfig = {
    mustCall: optionListWithConfig(parsed, "must-call"),
    mustNotCall: optionListWithConfig(parsed, "must-not-call"),
    maxShellCalls: optionalNumberOptionWithConfig(parsed, "max-shell-calls"),
    forbiddenCommands: optionListWithConfig(parsed, "forbid-command"),
    forbiddenCommandPrefixes: optionListWithConfig(parsed, "forbid-command-prefix"),
    forbiddenCommandPatterns: optionListWithConfig(parsed, "forbid-command-pattern")
  };
  const policyPath = optionalOptionWithConfig(parsed, "policy");
  const policyConfig = policyPath ? await readAssertionPolicyFile(policyPath) : {};
  const config = mergeAssertionConfigs(policyConfig, flagConfig);
  const report = await assertTraceFile(trace, config);
  io.stdout(format === "json" ? JSON.stringify(report, null, 2) + "\n" : renderAssertionMarkdown(report));
  return report.ok ? 0 : 1;
}

async function runValidate(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const trace = requiredPositional(parsed, 0, "trace file");
  const format = optionalOptionWithConfig(parsed, "format") ?? "markdown";
  const report = await validateTraceFile(trace);
  io.stdout(format === "json" ? JSON.stringify(report, null, 2) + "\n" : renderTraceValidationMarkdown(report));
  return report.ok ? 0 : 1;
}

async function runInspect(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const trace = requiredPositional(parsed, 0, "trace file");
  const format = optionalOptionWithConfig(parsed, "format") ?? "markdown";
  if (format === "timeline-json") {
    io.stdout(JSON.stringify(await buildTraceTimelineFile(trace), null, 2) + "\n");
    return 0;
  }
  const summary = await summarizeTraceFile(trace);
  io.stdout(format === "json" ? JSON.stringify(summary, null, 2) + "\n" : renderTraceSummaryMarkdown(summary));
  return 0;
}

async function runAnalyze(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const trace = requiredPositional(parsed, 0, "trace file");
  const format = optionalOptionWithConfig(parsed, "format") ?? "markdown";
  const report = await analyzeTraceFile(trace, { maxShellCalls: optionalNumberOptionWithConfig(parsed, "max-shell-calls") });
  io.stdout(format === "json" ? JSON.stringify(report, null, 2) + "\n" : renderTraceAnalysisMarkdown(report));
  return report.ok ? 0 : 1;
}

async function runBundle(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const trace = requiredPositional(parsed, 0, "trace file");
  const out = requiredOptionWithConfig(parsed, "out");
  const format = optionalOptionWithConfig(parsed, "format") ?? "text";
  const manifest = await bundleTraceFile(trace, out, {
    policyPath: optionalOptionWithConfig(parsed, "policy"),
    allowedUrlHosts: optionListWithConfig(parsed, "allow-url-host")
  });
  if (format === "json") {
    io.stdout(JSON.stringify({ output: out, manifest }, null, 2) + "\n");
  } else {
    io.stdout(`Wrote repro bundle to ${out}\n`);
  }
  return 0;
}

async function runExportOtel(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const trace = requiredPositional(parsed, 0, "trace file");
  io.stdout(JSON.stringify(await exportTraceFileToOtel(trace), null, 2) + "\n");
  return 0;
}

async function runSeal(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const trace = requiredPositional(parsed, 0, "trace file");
  const out = requiredOptionWithConfig(parsed, "out");
  await sealTraceFile(trace, out);
  io.stdout(`Wrote sealed trace to ${out}\n`);
  return 0;
}

async function runVerifyIntegrity(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const trace = requiredPositional(parsed, 0, "trace file");
  const format = optionalOptionWithConfig(parsed, "format") ?? "markdown";
  const report = await verifyTraceFileIntegrity(trace);
  io.stdout(format === "json" ? JSON.stringify(report, null, 2) + "\n" : renderTraceIntegrityMarkdown(report));
  return report.ok ? 0 : 1;
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

function requiredOptionWithConfig(parsed: ParsedArgs, name: string): string {
  const value = optionalOptionWithConfig(parsed, name);
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

function optionalOptionWithConfig(parsed: ParsedArgs, name: string): string | undefined {
  const optionValue = optionalOption(parsed, name);
  if (optionValue !== undefined) {
    return optionValue;
  }
  const configValue = getConfigValue(parsed.config, name);
  if (configValue === undefined) {
    return undefined;
  }
  if (typeof configValue !== "string") {
    throw new Error(`--${name} in config file must be a string`);
  }
  return configValue;
}

function optionListWithConfig(parsed: ParsedArgs, name: string): string[] | undefined {
  const optionValue = optionList(parsed, name);
  if (optionValue !== undefined) {
    return optionValue;
  }
  const configValue = getConfigValue(parsed.config, name);
  if (configValue === undefined) {
    return undefined;
  }
  if (typeof configValue === "string") {
    return [configValue];
  }
  if (Array.isArray(configValue) && configValue.every((value) => typeof value === "string")) {
    return configValue;
  }
  throw new Error(`--${name} in config file must be a string or array of strings`);
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

function optionalNumberOptionWithConfig(parsed: ParsedArgs, name: string): number | undefined {
  const optionValue = optionalOption(parsed, name);
  if (optionValue !== undefined) {
    return parseNumberOptionValue(name, optionValue);
  }
  const configValue = getConfigValue(parsed.config, name);
  if (configValue === undefined) {
    return undefined;
  }
  if (typeof configValue === "number" && Number.isFinite(configValue)) {
    return configValue;
  }
  if (typeof configValue === "string") {
    return parseNumberOptionValue(name, configValue);
  }
  throw new Error(`--${name} in config file must be a number`);
}

function optionalBooleanOption(parsed: ParsedArgs, name: string): boolean | undefined {
  const value = optionalOption(parsed, name);
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`--${name} must be true or false`);
}

function optionalBooleanOptionWithConfig(parsed: ParsedArgs, name: string): boolean | undefined {
  const optionValue = optionalOption(parsed, name);
  if (optionValue !== undefined) {
    return parseBooleanOptionValue(name, optionValue);
  }
  const configValue = getConfigValue(parsed.config, name);
  if (configValue === undefined) {
    return undefined;
  }
  if (typeof configValue === "boolean") {
    return configValue;
  }
  if (typeof configValue === "string") {
    return parseBooleanOptionValue(name, configValue);
  }
  throw new Error(`--${name} in config file must be true or false`);
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

function parseJsonOptionWithConfig(parsed: ParsedArgs, name: string, fallback: JsonValue): JsonValue {
  const value = optionalOption(parsed, name);
  if (value !== undefined) {
    return parseJsonOption(parsed, name, fallback);
  }
  const configValue = getConfigValue(parsed.config, name);
  if (configValue === undefined) {
    return fallback;
  }
  if (!isJsonValue(configValue)) {
    throw new Error(`--${name} in config file must be a JSON value`);
  }
  return configValue;
}

function hasOptionWithConfig(parsed: ParsedArgs, name: string): boolean {
  return optionalOption(parsed, name) !== undefined || getConfigValue(parsed.config, name) !== undefined;
}

function parseDiffMode(value: string): "positional" | "semantic" {
  if (value !== "positional" && value !== "semantic") {
    throw new Error("--mode must be positional or semantic");
  }
  return value;
}

async function loadCliConfig(parsed: ParsedArgs): Promise<CliConfig | undefined> {
  const filePath = optionalOption(parsed, "config-file");
  if (!filePath) {
    return undefined;
  }

  let value: unknown;
  try {
    value = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read config file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(value)) {
    throw new Error(`Config file ${filePath} must be a JSON object`);
  }
  return value;
}

function getConfigValue(config: CliConfig | undefined, name: string): unknown {
  if (!config) {
    return undefined;
  }
  if (name in config) {
    return config[name];
  }
  const camelName = toCamelCase(name);
  if (camelName in config) {
    return config[camelName];
  }
  return undefined;
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function parseNumberOptionValue(name: string, value: string): number {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) {
    throw new Error(`--${name} must be a number`);
  }
  return parsedValue;
}

function parseBooleanOptionValue(name: string, value: string): boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`--${name} must be true or false`);
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
