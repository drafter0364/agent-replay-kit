import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { ensureParentDir, readTraceFile } from "./io.js";
import { sanitizeTraceEventsWithReport, type SanitizerOptions } from "./sanitize.js";
import type { TraceEvent } from "./types.js";

export interface TraceBundleOptions extends Pick<SanitizerOptions, "allowedUrlHosts"> {
  policyPath?: string;
  createdAt?: Date;
  packageVersion?: string;
}

export interface TraceBundleManifest {
  schemaVersion: "1.0";
  createdAt: string;
  packageName: "agent-replay-kit";
  packageVersion: string;
  sourceTrace: string;
  files: {
    sanitizedTrace: string;
    redactionReport: string;
    environment: string;
    policy?: string;
  };
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

const bundleSchemaVersion = "1.0";
const packageName = "agent-replay-kit";

export async function bundleTraceFile(tracePath: string, outPath: string, options: TraceBundleOptions = {}): Promise<TraceBundleManifest> {
  const events = await readTraceFile(tracePath);
  const sanitized = sanitizeTraceEventsWithReport(events, { allowedUrlHosts: options.allowedUrlHosts });
  const createdAt = (options.createdAt ?? new Date()).toISOString();
  const packageVersion = options.packageVersion ?? (await readPackageVersion());
  const manifest: TraceBundleManifest = {
    schemaVersion: bundleSchemaVersion,
    createdAt,
    packageName,
    packageVersion,
    sourceTrace: basename(tracePath),
    files: {
      sanitizedTrace: "trace.sanitized.jsonl",
      redactionReport: "redaction-report.json",
      environment: "environment.json",
      ...(options.policyPath ? { policy: "policy.json" } : {})
    }
  };
  const entries: ZipEntry[] = [
    { name: "manifest.json", data: jsonBuffer(manifest) },
    { name: manifest.files.sanitizedTrace, data: Buffer.from(serializeTrace(sanitized.events), "utf8") },
    { name: manifest.files.redactionReport, data: jsonBuffer(sanitized.report) },
    { name: manifest.files.environment, data: jsonBuffer(buildEnvironmentFingerprint()) }
  ];

  if (options.policyPath) {
    entries.push({ name: "policy.json", data: Buffer.from(await readFile(options.policyPath, "utf8"), "utf8") });
  }

  await ensureParentDir(outPath);
  await writeFile(outPath, createZip(entries, options.createdAt ?? new Date()));
  return manifest;
}

function serializeTrace(events: TraceEvent[]): string {
  const body = events.map((event) => JSON.stringify(event)).join("\n");
  return body.length > 0 ? `${body}\n` : "";
}

function jsonBuffer(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildEnvironmentFingerprint(): Record<string, string | boolean | undefined> {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    ci: process.env.CI === "true" ? true : undefined,
    githubActions: process.env.GITHUB_ACTIONS === "true" ? true : undefined
  };
}

async function readPackageVersion(): Promise<string> {
  try {
    const raw = await readFile(new URL("../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "unknown";
  } catch {
    return "unknown";
  }
}

function createZip(entries: ZipEntry[], modifiedAt: Date): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const { time, date } = toDosDateTime(modifiedAt);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function toDosDateTime(value: Date): { time: number; date: number } {
  const year = Math.max(1980, value.getFullYear());
  return {
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate()
  };
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}
