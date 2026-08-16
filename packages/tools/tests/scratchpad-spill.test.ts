import { describe, expect, it, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setScratchpadBounded, resolveScratchpadValue } from "../src/scratchpad-spill.js";

// #47: the scratchpad's in-memory Map has no aggregate size cap and no disk
// persistence — a long run accumulating many/large auto-stored tool results
// grows it unbounded, and content is lost if the process dies without a
// durable checkpoint. setScratchpadBounded spills past a byte threshold;
// resolveScratchpadValue reads it back transparently.

const NAMESPACE = "test-scratchpad-spill";
const SPILL_ROOT = join(homedir() || ".", ".reactive-agents", "spill", NAMESPACE);

afterEach(() => {
  if (existsSync(SPILL_ROOT)) rmSync(SPILL_ROOT, { recursive: true, force: true });
});

describe("setScratchpadBounded", () => {
  it("stores small values in memory, under threshold", () => {
    const scratchpad = new Map<string, string>();
    setScratchpadBounded(scratchpad, "k1", "small value", NAMESPACE, 1000);
    expect(scratchpad.get("k1")).toBe("small value");
    expect(existsSync(SPILL_ROOT)).toBe(false);
  });

  it("spills to disk once the aggregate would exceed the threshold", () => {
    const scratchpad = new Map<string, string>();
    setScratchpadBounded(scratchpad, "k1", "a".repeat(50), NAMESPACE, 100);
    setScratchpadBounded(scratchpad, "k2", "b".repeat(80), NAMESPACE, 100); // 50+80 > 100
    expect(scratchpad.get("k1")).toBe("a".repeat(50));
    const marker = scratchpad.get("k2")!;
    expect(marker.startsWith("[SPILLED_TO_DISK:")).toBe(true);
    expect(existsSync(join(SPILL_ROOT, "k2.txt"))).toBe(true);
  });

  it("resolveScratchpadValue reads a spilled entry back to its full content", () => {
    const scratchpad = new Map<string, string>();
    const bigValue = "x".repeat(200);
    setScratchpadBounded(scratchpad, "k1", bigValue, NAMESPACE, 10);
    const marker = scratchpad.get("k1")!;
    expect(marker.startsWith("[SPILLED_TO_DISK:")).toBe(true);
    expect(resolveScratchpadValue(marker)).toBe(bigValue);
  });

  it("resolveScratchpadValue returns a non-marker string unchanged", () => {
    expect(resolveScratchpadValue("plain content")).toBe("plain content");
    expect(resolveScratchpadValue("")).toBe("");
  });

  it("different namespaces don't collide on the same key", () => {
    const a = new Map<string, string>();
    const b = new Map<string, string>();
    setScratchpadBounded(a, "same-key", "value-a".repeat(50), `${NAMESPACE}-a`, 10);
    setScratchpadBounded(b, "same-key", "value-b".repeat(50), `${NAMESPACE}-b`, 10);
    expect(resolveScratchpadValue(a.get("same-key")!)).toBe("value-a".repeat(50));
    expect(resolveScratchpadValue(b.get("same-key")!)).toBe("value-b".repeat(50));
    rmSync(join(homedir() || ".", ".reactive-agents", "spill", `${NAMESPACE}-a`), {
      recursive: true,
      force: true,
    });
    rmSync(join(homedir() || ".", ".reactive-agents", "spill", `${NAMESPACE}-b`), {
      recursive: true,
      force: true,
    });
  });

  it("degrades to in-memory storage instead of throwing when the spill write fails (health sweep 2026-08-16)", () => {
    // Make the spill directory's own path unusable: create a FILE where the
    // spill dir needs to be a directory, so mkdirSync(..., {recursive}) fails.
    const unwritableNamespace = `${NAMESPACE}-unwritable`;
    const parentDir = join(homedir() || ".", ".reactive-agents", "spill");
    mkdirSync(parentDir, { recursive: true });
    const blockedPath = join(parentDir, unwritableNamespace);
    writeFileSync(blockedPath, "blocking file");

    const scratchpad = new Map<string, string>();
    const bigValue = "y".repeat(200);
    expect(() => setScratchpadBounded(scratchpad, "k1", bigValue, unwritableNamespace, 10)).not.toThrow();
    // No disk spill possible -- falls back to storing the value directly.
    expect(scratchpad.get("k1")).toBe(bigValue);

    rmSync(blockedPath, { force: true });
  });
});
