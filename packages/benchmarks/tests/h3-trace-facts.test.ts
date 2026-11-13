// Run: bun run repo test packages/benchmarks/tests/h3-trace-facts.test.ts
//
// The H3 runner printed `cause=parse-failed` for traces that were fine: it
// spawned `bun <repoRoot>/apps/cli/src/index.ts diagnose cause --json` and
// folded any failure of that subprocess (worktree checkout, cwd, timeout) into
// the label. The label now comes from `analyzeCause` in process.

import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { traceFactsOf } from "../src/h3/run-h3.js";

const dir = mkdtempSync(join(tmpdir(), "h3-trace-facts-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const base = { runId: "r1", rootRunId: "r1", depth: 0, timestamp: 1, iter: -1 };
const started = { ...base, kind: "run-started", seq: 0, task: "t", model: "m", provider: "p", config: {} };
const completed = (status: string) => ({
  ...base, kind: "run-completed", seq: 1, status, output: "ok", terminatedBy: "end_turn",
  totalTokens: 10, totalCostUsd: 0, durationMs: 5,
});
const jsonl = (...evs: object[]) => evs.map((e) => JSON.stringify(e)).join("\n") + "\n";

describe("traceFactsOf", () => {
  it("labels a healthy trace from an arbitrary (outside-repo) dir, never parse-failed", () => {
    const f = join(dir, "ok.jsonl");
    writeFileSync(f, jsonl(started, completed("success")));
    const facts = traceFactsOf(f);
    expect(facts.causeLabel).not.toBe("parse-failed");
    expect(facts.causeLabel).not.toStartWith("cause-error");
    expect(facts.endStatus).toBe("success");
    expect(facts.terminatedBy).toBe("end_turn");
  });

  it("surfaces run-completed.status=failure as endStatus", () => {
    const f = join(dir, "fail.jsonl");
    writeFileSync(f, jsonl(started, completed("failure")));
    expect(traceFactsOf(f).endStatus).toBe("failure");
  });

  it("survives a torn last line (cell cut by its timeout)", () => {
    const f = join(dir, "torn.jsonl");
    writeFileSync(f, jsonl(started, completed("success")) + '{"kind":"tool-call-sta');
    const facts = traceFactsOf(f);
    expect(facts.endStatus).toBe("success");
    expect(facts.causeLabel).not.toBe("parse-failed");
  });

  it("no trace -> no-trace", () => {
    expect(traceFactsOf(null).causeLabel).toBe("no-trace");
    expect(traceFactsOf(join(dir, "missing.jsonl")).endStatus).toBeNull();
  });
});
