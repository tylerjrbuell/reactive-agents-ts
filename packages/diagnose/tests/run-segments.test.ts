// Run: bun test packages/diagnose/tests/run-segments.test.ts --timeout 15000
//
// A trace file holding several runs under one runId (Cortex "Continue" reuses
// the runId; conformance audit 2026-11-18, I2): `cause` and `attribute` report
// the last run with a note, `--segment=<n|all>` picks runs, and cohort mode
// counts each run once.
import { describe, it, expect, afterAll, spyOn } from "bun:test";
import { mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTrace } from "@reactive-agents/trace";
import { causeCommand, classifyDirectories } from "../src/commands/cause.js";
import { attributeCommand, attributeDirectories } from "../src/commands/attribute.js";
import { parseSegmentFlag, pickRuns } from "../src/lib/segments.js";

const FIXTURE = join(import.meta.dir, "../../trace/tests/fixtures/conformance-i2-two-runs-one-runid.jsonl");
const tmp = mkdtempSync(join(tmpdir(), "diagnose-segments-"));
copyFileSync(FIXTURE, join(tmp, "two-runs.jsonl"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Captured `console.log` output of one command call. */
async function captured(fn: () => Promise<void>): Promise<string> {
  const out: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.map(String).join(" ")); });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return out.join("\n");
}

describe("--segment flag", () => {
  it("parses a run number, all, or nothing", () => {
    expect(parseSegmentFlag(undefined)).toBeUndefined();
    expect(parseSegmentFlag("2")).toBe(2);
    expect(parseSegmentFlag("all")).toBe("all");
    expect(() => parseSegmentFlag("0")).toThrow();
    expect(() => parseSegmentFlag(true)).toThrow();
  });

  it("picks the last run by default and refuses a run the file does not hold", async () => {
    const t = await loadTrace(FIXTURE);
    expect(pickRuns(t, undefined).map((r) => r.ref)).toEqual([{ index: 2, count: 2 }]);
    expect(pickRuns(t, "all").map((r) => r.ref?.index)).toEqual([1, 2]);
    expect(() => pickRuns(t, 3)).toThrow("holds 2 run(s)");
  });
});

describe("rax-diagnose cause / attribute on a file with two runs", () => {
  it("cause reports the last run with a note that two runs share the id", async () => {
    const out = await captured(() => causeCommand(FIXTURE));
    expect(out).toContain("cause=none");
    expect(out).toContain("note      2 runs share this runId; this is run 2 of 2 (the last)");
  });

  it("cause --segment=1 reports the first run's failure", async () => {
    const out = await captured(() => causeCommand(FIXTURE, { segment: 1 }));
    expect(out).toContain("status=failure");
    expect(out).toContain("this is run 1 of 2");
  });

  it("cause --segment=all --json gives one entry per run", async () => {
    const parsed: unknown = JSON.parse(await captured(() => causeCommand(FIXTURE, { segment: "all", json: true })));
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as { outcomeStatus: string }[]).map((r) => r.outcomeStatus)).toEqual(["failure", "success"]);
  });

  it("attribute --segment=1 attributes the first run, with the note", async () => {
    const out = await captured(() => attributeCommand(FIXTURE, { segment: 1 }));
    expect(out).toContain("model (model:fabrication-vetoed)");
    expect(out).toContain("note      2 runs share this runId; this is run 1 of 2");
  });

  it("cohort mode counts each run once", async () => {
    const causes = await classifyDirectories([tmp]);
    expect(causes.map((c) => [c.analysis.runSegment?.index, c.analysis.outcomeStatus])).toEqual([[1, "failure"], [2, "success"]]);
    const attributions = await attributeDirectories([tmp]);
    expect(attributions.map((c) => c.runSegment?.index)).toEqual([1, 2]);
    expect(attributions[0]?.attribution.reason).toBe("model:fabrication-vetoed");
    expect(attributions[1]?.attribution.reason).not.toBe("model:fabrication-vetoed");
  });
});
