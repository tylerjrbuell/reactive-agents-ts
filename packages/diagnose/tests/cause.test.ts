import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyDirectories, renderCauseTally, listTraceFilesRecursive } from "../src/commands/cause.js";
import { tallyCauses } from "@reactive-agents/trace";

const tmp = mkdtempSync(join(tmpdir(), "cause-cohort-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const line = (o: Record<string, unknown>): string => JSON.stringify(o);
const run = (runId: string, provider: string, tail: Record<string, unknown>[]): string =>
  [
    line({ kind: "run-started", runId, iter: -1, seq: 0, timestamp: 1, task: "t", model: provider === "test" ? "test-m" : "m", provider, config: {} }),
    ...tail.map((t, i) => line({ runId, iter: -1, seq: i + 1, timestamp: 2 + i, ...t })),
  ].join("\n") + "\n";

mkdirSync(join(tmp, "cell1", "trace"), { recursive: true });
writeFileSync(
  join(tmp, "cell1", "trace", "A.jsonl"),
  run("A", "ollama", [
    { kind: "guard-fired", iter: 0, guard: "terminal_decision", outcome: "terminate", reason: "llm_error", metadata: { terminatedBy: "llm_error", status: "failed", authority: "error" } },
    { kind: "run-completed", status: "failure", terminatedBy: "llm_error", error: "model not found", totalTokens: 0, totalCostUsd: 0, durationMs: 1 },
  ]),
);
writeFileSync(join(tmp, "cell1", "trace", "llm-direct.jsonl"), line({ kind: "llm-exchange", runId: "llm-direct", iter: 0, seq: 0, timestamp: 1 }) + "\n");
writeFileSync(join(tmp, "B.jsonl"), run("B", "test", [{ kind: "run-aborted", causeClass: "interrupt", durationMs: 1 }]));
writeFileSync(join(tmp, "empty.jsonl"), "");

describe("rax-diagnose cause — cohort mode", () => {
  it("lists traces recursively and skips the llm-direct sink", async () => {
    const files = await listTraceFilesRecursive(tmp);
    expect(files.map((f) => f.slice(tmp.length + 1)).sort()).toEqual(["B.jsonl", "cell1/trace/A.jsonl", "empty.jsonl"]);
  });

  it("classifies every run file and skips files that hold no run events", async () => {
    const cohort = await classifyDirectories([tmp]);
    expect(cohort.map((c) => c.analysis.runId).sort()).toEqual(["A", "B"]);
    const t = tallyCauses(cohort.map((c) => c.analysis));
    expect(t.byCause["provider-error"]).toBe(1);
    expect(t.byCause["incomplete-trace"]).toBe(1);
  });

  it("--real excludes synthetic (test-provider) traces", async () => {
    const cohort = await classifyDirectories([tmp], { real: true });
    expect(cohort.map((c) => c.analysis.runId)).toEqual(["A"]);
  });

  it("renders a tally with confidence split and cause x status rows", async () => {
    const cohort = await classifyDirectories([tmp]);
    const out = renderCauseTally(tallyCauses(cohort.map((c) => c.analysis)), "T");
    expect(out).toContain("2 run(s)");
    expect(out).toContain("provider-error");
    expect(out).toContain("decisive=");
  });
});
