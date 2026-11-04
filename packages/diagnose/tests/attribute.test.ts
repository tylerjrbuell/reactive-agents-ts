import { describe, it, expect, afterAll, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attributeDirectories, renderAttributionTally, attributeCommand } from "../src/commands/attribute.js";
import { causeCommand } from "../src/commands/cause.js";
import { tallyAttributions } from "@reactive-agents/trace";

const tmp = mkdtempSync(join(tmpdir(), "attribute-cohort-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const line = (o: Record<string, unknown>): string => JSON.stringify(o);
const run = (runId: string, provider: string, tail: Record<string, unknown>[]): string =>
  [
    line({ kind: "run-started", runId, iter: -1, seq: 0, timestamp: 1, task: "t", model: provider === "test" ? "test-m" : "m", provider, config: {} }),
    ...tail.map((t, i) => line({ runId, iter: -1, seq: i + 1, timestamp: 2 + i, ...t })),
  ].join("\n") + "\n";
const completed = (status: string, terminatedBy: string, success: boolean) =>
  ({ kind: "run-completed", status, terminatedBy, totalTokens: 0, totalCostUsd: 0, durationMs: 1, outcome: { status: success ? "completed" : "failed", success, terminatedBy, provenance: "model-final", verdict: null, answerSatisfied: null } });
const graded = (passed: boolean) =>
  ({ kind: "eval-graded", score: passed ? 1 : 0, passed, threshold: 1, checks: [{ name: "check", passed }], grader: "verifiable", taskId: "t" });

mkdirSync(join(tmp, "cell"), { recursive: true });
// A: graded pass but marked failed -> harness:false-veto.
const pathA = join(tmp, "cell", "A.jsonl");
writeFileSync(pathA, run("A", "ollama", [completed("failure", "harness_synthesis", true), graded(true)]));
// B: clean success, passing grade -> not-failed.
writeFileSync(join(tmp, "cell", "B.jsonl"), run("B", "ollama", [completed("success", "end_turn", true), graded(true)]));
// C: synthetic provider, failed grade with no evidence -> unattributed.
writeFileSync(join(tmp, "C.jsonl"), run("C", "test", [completed("success", "end_turn", true), graded(false)]));
writeFileSync(join(tmp, "llm-direct.jsonl"), line({ kind: "llm-exchange", runId: "llm-direct", iter: 0, seq: 0, timestamp: 1 }) + "\n");

const captured = async (fn: () => Promise<void>): Promise<string> => {
  const spy = spyOn(console, "log").mockImplementation(() => {});
  try {
    await fn();
    return spy.mock.calls.map((c) => String(c[0])).join("\n");
  } finally {
    spy.mockRestore();
  }
};

describe("rax-diagnose attribute", () => {
  it("attributes every run file under a directory and skips the llm-direct sink", async () => {
    const cohort = await attributeDirectories([tmp]);
    expect(cohort.map((c) => c.attribution.runId).sort()).toEqual(["A", "B", "C"]);
    const t = tallyAttributions(cohort.map((c) => c.attribution));
    expect(t.byReason["harness:false-veto"]).toBe(1);
    expect(t.byVerdict["not-failed"]).toBe(1);
    expect(t.byVerdict.unattributed).toBe(1);
  });

  it("--real excludes synthetic (test-provider) traces", async () => {
    const cohort = await attributeDirectories([tmp], { real: true });
    expect(cohort.map((c) => c.attribution.runId).sort()).toEqual(["A", "B"]);
  });

  it("renders the tally with failed-run verdict split and reason rows", async () => {
    const cohort = await attributeDirectories([tmp]);
    const out = renderAttributionTally(tallyAttributions(cohort.map((c) => c.attribution)), "T");
    expect(out).toContain("3 run(s), 2 failed");
    expect(out).toContain("harness=1 (50%)");
    expect(out).toContain("harness:false-veto");
  });

  it("single-run --json prints the attribution", async () => {
    const out = await captured(() => attributeCommand(pathA, { json: true }));
    const parsed: unknown = JSON.parse(out);
    expect(parsed).toMatchObject({ runId: "A", verdict: "harness", reason: "harness:false-veto" });
  });

  it("--all --json lists one row per run with verdict and reason", async () => {
    const out = await captured(() => attributeCommand(tmp, { all: true, json: true }));
    const parsed: unknown = JSON.parse(out);
    expect(parsed).toMatchObject({ tally: { total: 3 } });
    expect(JSON.stringify(parsed)).toContain("\"reason\":\"harness:false-veto\"");
  });

  it("cause --json gains an attribution field", async () => {
    const out = await captured(() => causeCommand(pathA, { json: true }));
    const parsed: unknown = JSON.parse(out);
    expect(parsed).toMatchObject({ runId: "A", attribution: { verdict: "harness", reason: "harness:false-veto" } });
  });
});
