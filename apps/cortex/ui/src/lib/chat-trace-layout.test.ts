import { describe, expect, test } from "bun:test";
import { readStoredFlag, traceLayout, TRACE_OPEN_KEY, writeStoredFlag } from "./chat-trace-layout.js";

describe("traceLayout", () => {
  test("wide window docks at desired width", () => {
    expect(traceLayout(1440, 1200, 448)).toEqual({ mode: "docked", width: 448 });
  });
  test("docked width shrinks so conversation keeps 420px", () => {
    expect(traceLayout(1200, 800, 600)).toEqual({ mode: "docked", width: 380 });
  });
  test("narrow window overlays", () => {
    expect(traceLayout(913, 700, 448).mode).toBe("overlay");
  });
  test("not enough room for min drawer overlays", () => {
    expect(traceLayout(1200, 700, 448).mode).toBe("overlay");
  });
  test("overlay never exceeds 92% of the row", () => {
    expect(traceLayout(900, 500, 760).width).toBe(460);
  });
});

describe("stored flags", () => {
  test("round-trips through storage; missing or throwing storage reads false", () => {
    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(readStoredFlag(TRACE_OPEN_KEY, storage)).toBe(false);
    writeStoredFlag(TRACE_OPEN_KEY, true, storage);
    expect(readStoredFlag(TRACE_OPEN_KEY, storage)).toBe(true);
    writeStoredFlag(TRACE_OPEN_KEY, false, storage);
    expect(readStoredFlag(TRACE_OPEN_KEY, storage)).toBe(false);
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(readStoredFlag("k", broken)).toBe(false);
    expect(() => writeStoredFlag("k", true, broken)).not.toThrow();
    expect(readStoredFlag("k", undefined)).toBe(false);
  });
});
