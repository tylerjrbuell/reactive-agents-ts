// Run: bun test packages/runtime/tests/ledger-announced-seam.test.ts --timeout 60000
//
// Wave C.2 slice 3b-ii — every execution path's ledger reaches the STREAM.
//
// 09 §3 C1 ("no second store, ever") is a containment invariant with two halves:
// reader convergence and A SINGLE WRITE PATH
// ([[wiki/Decisions/2026-07-22-c1-equivalence-invariant]]). The write-path half
// had a hole: `check-ledger-writes.sh` fenced the append API to the ledger home,
// but `projectStepsToLedger` — which calls that API from inside the fence — was
// callable from anywhere, in either package. Four ledger factories existed where
// the invariant assumes one, and three announced nothing:
//
//   code-action  object=[tool-invocation, tool-result x2]  stream=[]
//   reflexion    object=[tool-result x2]  stream=[requirement, verdict] x2  (DISJOINT)
//   inline-act   object=[tool-invocation, tool-result]     stream=[]
//
// Trace-side readers (analyze, debrief, cohort) consume serialized JSONL and
// cannot reach `TaskResult.metadata`, so those runs were structurally invisible
// to them. This pins the property per strategy rather than per call site, so a
// NEW strategy that grows a ledger without announcing fails here — not only in
// the grep gate.
//
// RED-ON-CUT: swap any `growRunLedger` call back to raw `projectStepsToLedger`
// and that strategy's case fails with entries missing from the stream.
import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/index.js";

type Entryish = Record<string, unknown>;
const key = (e: Entryish) => `${e.kind}${e.toolName ? `:${e.toolName}` : ""}`;

async function streamedEntries(dir: string): Promise<Entryish[]> {
  const out: Entryish[] = [];
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    if (!f.endsWith(".jsonl")) continue;
    for (const line of (await readFile(join(dir, f), "utf8")).split("\n")) {
      if (!line.trim()) continue;
      let ev: { kind?: string; entries?: Entryish[] };
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.kind === "ledger-entry" && Array.isArray(ev.entries)) out.push(...ev.entries);
    }
  }
  return out;
}

// Every strategy that grows a run ledger. `reactive` is the kernel control arm:
// it was already announced (C.1's runner tap), so it must stay green throughout.
const STRATEGIES = ["reactive", "reflexion", "code-action"] as const;

describe("every ledger factory announces to the stream", () => {
  for (const strategy of STRATEGIES) {
    it(`${strategy}: object ledger ⊆ streamed entries`, async () => {
      const dir = await mkdtemp(join(tmpdir(), `ra-seam-${strategy}-`));
      const agent = await ReactiveAgents.create()
        .withName(`seam-${strategy}`)
        .withProvider("test")
        .withModel("test-model")
        .withTools()
        .withMaxIterations(2)
        .withReasoning({ defaultStrategy: strategy })
        .withObservability({ tracing: { dir } })
        .withTestScenario([{ text: "Done." }])
        .build();

      const result = await agent.run("SEAM_PROBE do the work", { taskId: `seam-${strategy}` });
      await agent.dispose();

      const md = result.metadata as { runLedger?: ReadonlyArray<Entryish> };
      const object = md.runLedger ?? [];
      const stream = await streamedEntries(dir);

      // CONTROL: this strategy really did record facts. Without it the
      // containment assertion passes vacuously on two empty sets — the exact
      // way a stream-blindness regression would hide.
      expect(object.length).toBeGreaterThan(0);

      // The invariant: nothing the run recorded is missing from the stream.
      // Containment, not equality — the ledger is a strict SUPERSET of step
      // projection (artifact / requirement / verdict entries are seeded through
      // the same chokepoint), and auxiliary kernel passes announce entries that
      // the terminal object view does not carry.
      const streamKeys = stream.map(key);
      const missing = object.map(key).filter((k) => !streamKeys.includes(k));
      expect(missing).toEqual([]);
    }, 60_000);
  }
});
