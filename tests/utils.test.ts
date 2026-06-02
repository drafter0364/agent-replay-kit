import { describe, expect, it } from "vitest";
import { createId, isJsonObject, isRecord, stableStringify, toJsonValue } from "../src/utils.js";

describe("utils", () => {
  it("creates prefixed UUID ids", () => {
    expect(createId("call")).toMatch(
      /^call_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("stable stringifies object keys", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it("detects records and json objects", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([1])).toBe(false);
    expect(isJsonObject({ a: 1 })).toBe(true);
    expect(isJsonObject([1])).toBe(false);
  });

  it("normalizes undefined as null for JSON values", () => {
    expect(toJsonValue(undefined)).toBeNull();
  });
});
