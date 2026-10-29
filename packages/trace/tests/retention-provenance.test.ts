// Run: bun test packages/trace/tests/retention-provenance.test.ts
import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyProvenance, planRunPrune, pruneTraceDir, retentionPolicyFromEnv, type TraceFileInfo } from "../src/retention.js";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const policy = { syntheticMaxAgeMs: DAY, syntheticMaxFiles: 5, realMinRuns: 3, realMaxAgeMs: 90 * DAY, realMaxBytes: 1e12 };
const f = (name: string, ageMs: number, provenance: "real" | "synthetic", size = 10): TraceFileInfo => ({ name, mtime: NOW - ageMs, size, provenance });

describe("classifyProvenance", () => {
  it("test provider/model => synthetic; real or unknown => real", () => {
    expect(classifyProvenance('{"kind":"run-started","model":"test-model","provider":"test"}')).toBe("synthetic");
    expect(classifyProvenance('{"kind":"run-started","model":"qwen3:14b","provider":"ollama"}')).toBe("real");
    expect(classifyProvenance("")).toBe("real");
  });
});

describe("planRunPrune", () => {
  it("synthetic noise never displaces real runs, however many", () => {
    const files = [
      ...Array.from({ length: 50 }, (_, i) => f(`s${i}`, (i + 20) * 60_000 * 60, "synthetic")),
      ...Array.from({ length: 4 }, (_, i) => f(`r${i}`, (40 + i) * DAY, "real")),
    ];
    const doomed = planRunPrune(files, policy, NOW);
    expect(doomed.filter((n) => n.startsWith("r"))).toEqual([]);
    expect(doomed.filter((n) => n.startsWith("s")).length).toBeGreaterThan(40);
  });
  it("synthetic capped by count and age, newest kept", () => {
    const files = Array.from({ length: 8 }, (_, i) => f(`s${i}`, 20 * 60_000 + i * 60_000, "synthetic"));
    expect(planRunPrune(files, policy, NOW).sort()).toEqual(["s5", "s6", "s7"]);
  });
  it("real kept unless BOTH beyond min-runs and older than max age", () => {
    const files = [f("a", 200 * DAY, "real"), f("b", 201 * DAY, "real"), f("c", 202 * DAY, "real"), f("d", 203 * DAY, "real"), f("e", 10 * DAY, "real")];
    // newest 3 by mtime (e,a,b) protected; c,d old and outside => deleted
    expect(planRunPrune(files, policy, NOW).sort()).toEqual(["c", "d"]);
  });
  it("real size cap drops oldest beyond protected count", () => {
    const files = Array.from({ length: 6 }, (_, i) => f(`r${i}`, i * DAY, "real", 100));
    expect(planRunPrune(files, { ...policy, realMaxBytes: 350 }, NOW).sort()).toEqual(["r3", "r4", "r5"]);
  });
  it("recently modified files are never deleted", () => {
    expect(planRunPrune([f("s", 60_000, "synthetic")], { ...policy, syntheticMaxFiles: 0 }, NOW)).toEqual([]);
  });
});

describe("pruneTraceDir end to end", () => {
  const ulid = (i: number) => `01ARZ3NDEKTSV4RRFFQ69G5FA${String.fromCharCode(65 + i)}.jsonl`;
  it("deletes old synthetic, keeps old real", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-trace-prov-"));
    const old = new Date(Date.now() - 3 * DAY);
    writeFileSync(join(dir, ulid(0)), '{"kind":"run-started","model":"test-model","provider":"test"}\n');
    writeFileSync(join(dir, ulid(1)), '{"kind":"run-started","model":"qwen3:14b","provider":"ollama"}\n');
    for (const i of [0, 1]) utimesSync(join(dir, ulid(i)), old, old);
    await pruneTraceDir(dir, retentionPolicyFromEnv({}));
    expect(readdirSync(dir)).toEqual([ulid(1)]);
  });
});
