// Run: bun test packages/trace/tests/cause-description.test.ts --timeout 15000
//
// Plain words + justified next steps for each FailureCause, and loadTrace/parseTrace
// from JSONL text. Exhaustiveness is a compile-time property (Record<FailureCause, …>);
// these tests pin the runtime shape and the subCause-specific steps.
import { describe, expect, it, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CAUSE_DESCRIPTIONS,
  analyzeCause,
  causeDescription,
  causeNextActions,
  loadTrace,
  parseTrace,
} from "../src/index.js";
import type { FailureCause } from "../src/index.js";

// Every cause, as a typed Record: a new FailureCause is a type error here until listed.
const ALL: Readonly<Record<FailureCause, true>> = {
  "direct-chat": true, timeout: true, "user-stop": true, aborted: true, "incomplete-trace": true,
  "provider-error": true, "strategy-error": true, "satisfiability-abstain": true, "terminal-mislabel": true,
  "plan-posture-veto": true, "never-engaged": true, "tool-protocol": true, "tool-failure": true,
  "wrong-tool-arg": true, "stall-after-work": true, "stall-no-progress": true, "loop-after-work": true,
  "bookkeeping-loop": true, "verifier-reject": true, "budget-cap": true, unexplained: true,
  "wrong-answer": true, "success-with-warning": true, none: true, undetermined: true,
};
const causes = Object.keys(ALL) as FailureCause[];

describe("causeDescription", () => {
  it("has a non-empty description for every cause, and the table has no extra keys", () => {
    for (const c of causes) expect(causeDescription(c).length).toBeGreaterThan(0);
    expect(Object.keys(CAUSE_DESCRIPTIONS).sort()).toEqual([...causes].sort());
  });
});

describe("causeNextActions", () => {
  it("returns no step where the trace points to none", () => {
    for (const cause of ["none", "user-stop", "direct-chat"] as const) {
      expect(causeNextActions({ cause })).toEqual([]);
    }
  });

  it("returns at least one step for every failure cause", () => {
    const silent = new Set<FailureCause>(["none", "user-stop", "direct-chat"]);
    for (const c of causes.filter((x) => !silent.has(x))) {
      expect(causeNextActions({ cause: c }).length).toBeGreaterThan(0);
    }
  });

  it("provider-error steps follow the sub-cause; unknown sub-causes fall back to the evidence", () => {
    expect(causeNextActions({ cause: "provider-error", subCause: "auth" })[0]).toContain("API key");
    expect(causeNextActions({ cause: "provider-error", subCause: "model-not-found" })[0]).toContain("pull");
    expect(causeNextActions({ cause: "provider-error", subCause: "constructor" })[0]).toContain("evidence");
    expect(causeNextActions({ cause: "provider-error" })[0]).toContain("evidence");
  });

  it("budget-cap separates a run cut off while progressing from one that stopped progressing", () => {
    expect(causeNextActions({ cause: "budget-cap", subCause: "cap-cutoff" })[0]).toContain("raise the iteration budget");
    expect(causeNextActions({ cause: "budget-cap", subCause: "no-progress-at-cap" })[0]).toContain("unlikely to help");
  });

  it("tool-failure adds the repeated-call step only for repeated identical calls", () => {
    expect(causeNextActions({ cause: "tool-failure", subCause: "all-calls-failed" })).toHaveLength(1);
    expect(causeNextActions({ cause: "tool-failure", subCause: "repeated-identical-call" })).toHaveLength(2);
  });
});

const line = (seq: number, kind: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ kind, runId: "rt", timestamp: 1000 + seq, iter: -1, seq, ...extra });
const jsonl = [
  line(0, "run-started", { task: "t", model: "m", provider: "ollama", config: {} }),
  line(1, "run-aborted", { causeClass: "interrupt", reason: "user-stop", durationMs: 1 }),
  "not json",
].join("\n");

const dir = mkdtempSync(join(tmpdir(), "trace-text-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("loadTrace from text", () => {
  it("parses JSONL text the same as the file holding it", async () => {
    const path = join(dir, "rt.jsonl");
    writeFileSync(path, jsonl);
    const fromFile = await loadTrace(path);
    const fromText = await loadTrace({ text: jsonl });
    expect(fromText).toEqual(fromFile);
    expect(parseTrace(jsonl)).toEqual(fromFile);
    expect(fromText.runId).toBe("rt");
    expect(fromText.events).toHaveLength(2);
  });

  it("a trace parsed from text diagnoses like any other", () => {
    const c = analyzeCause(parseTrace(jsonl));
    expect(c.cause).toBe("user-stop");
    expect(causeNextActions(c)).toEqual([]);
  });
});
