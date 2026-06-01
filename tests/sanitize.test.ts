import { describe, expect, it } from "vitest";
import { sanitizeTraceEvents } from "../src/index.js";
import type { TraceEvent } from "../src/types.js";

describe("trace sanitizer", () => {
  it("redacts secret keys and sensitive strings recursively", () => {
    const events: TraceEvent[] = [
      {
        type: "tool_call",
        callId: "c1",
        tool: "http",
        args: {
          apiKey: "sk-testsecret123456",
          email: "maintainer@example.com",
          url: "https://private.example.com/path?q=1",
          path: "C:\\Users\\dev\\repo\\file.ts"
        }
      }
    ];

    const raw = JSON.stringify(sanitizeTraceEvents(events));
    expect(raw).not.toContain("sk-testsecret123456");
    expect(raw).not.toContain("maintainer@example.com");
    expect(raw).not.toContain("private.example.com");
    expect(raw).not.toContain("C:\\Users");
    expect(raw).toContain("[REDACTED]");
  });
});
