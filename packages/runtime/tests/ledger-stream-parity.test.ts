// Run: bun test packages/runtime/tests/ledger-stream-parity.test.ts --timeout 30000
//
// Wave C.2 slice 3b — the run ledger has ONE truth and TWO faithful views:
//
//   OBJECT view  `TaskResult.metadata.runLedger`  — a live result object
//   STREAM view  `LedgerEntryAppended` → `ledger-entry` trace events (JSONL)
//
// Trace-side consumers (analyze, debrief, cohort) read serialized JSONL and
// cannot reach the object view. Before this slice the stream view only ever
// fired on the KERNEL path: the inline agent loop — the default path, and the
// one delegation actually runs on — built the object ledger (slices 1–2) and
// published nothing, so every default-path run was structurally invisible to
// every trace-side consumer.
//
// This pins the invariant, not the mechanism: whatever is in the object ledger
// is in the stream, on BOTH paths. A view that silently drops a path is the
// cross-cutting cascade defect Wave C exists to kill.
//
// RED-ON-CUT: delete the `eb.publish({_tag:"LedgerEntryAppended", ...})` block
// from inline-act.ts and the inline case fails with 0 streamed entries.
import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/index.js";

type LedgerEntryish = { kind: string; seq: number; toolName?: string };

/** Every `ledger-entry` trace event's entries, in file order. */
async function streamedEntries(dir: string): Promise<LedgerEntryish[]> {
  const out: LedgerEntryish[] = [];
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    if (!f.endsWith(".jsonl")) continue;
    for (const line of (await readFile(join(dir, f), "utf8")).split("\n")) {
      if (!line.trim()) continue;
      let ev: { kind?: string; entries?: LedgerEntryish[] };
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.kind === "ledger-entry" && Array.isArray(ev.entries)) out.push(...ev.entries);
    }
  }
  return out;
}

const build = async (dir: string, kernel: boolean) => {
  let b = ReactiveAgents.create()
    .withName(kernel ? "parity-kernel" : "parity-inline")
    .withProvider("test")
    .withModel("test-model")
    // scratchpad-write (this file's original scripted tool) is defined in
    // packages/tools/src/skills/scratchpad.ts but never wired into
    // packages/runtime's tool registration for a bare builder -- swapped for
    // file-write (always-registered builtin), matching
    // ledger-artifact-parity.test.ts's fix (2026-08-13).
    .withTools({ required: ["file-write"] })
    .withMaxIterations(3)
    .withObservability({ tracing: { dir } });
  if (kernel) b = b.withReasoning({ defaultStrategy: "reactive" });
  return b
    .withTestScenario([
      { match: "PARITY_TRIGGER", toolCalls: [{ name: "file-write", args: { path: "./.parity-probe.tmp.md", content: "v" } }] },
      { text: "Done." },
    ])
    .build();
};

describe("the run ledger's object and stream views agree", () => {
  // RETITLED (Move 1 merge, 2026-08-13): "inline path" (kernel:false) no
  // longer exercises a different code path than "kernel path" below -- every
  // builder now runs the kernel arm (runtime.ts's bareReasoningConfig), so
  // this case is now equivalent to (not a distinct regression guard from)
  // "kernel path streams every entry it puts on the object ledger" below.
  // Kept rather than deleted: cheap, and pins that the bare-builder door
  // specifically still gets full stream parity, not just the explicit-
  // reasoning door.
  //
  // CORRECTED (2026-08-13, was wrong in an earlier commit this session):
  // the CONTROL check failing was not a `TestTurn.match` implementation gap
  // -- `match` IS implemented (testing.ts's `resolveTurn` with a proper
  // agent/harness channel split). The real cause, same as
  // ledger-artifact-parity.test.ts: bare `.withTools()` left the scripted
  // tool unavailable under lazy-disclosure pruning. Fixed by declaring it
  // required in the shared `build()` helper above.
  it("inline path streams every entry it puts on the object ledger", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-parity-inline-"));
    const agent = await build(dir, false);
    const result = await agent.run("PARITY_TRIGGER do the work", { taskId: "parity-inline" });
    await agent.dispose();

    const md = result.metadata as { runLedger?: ReadonlyArray<LedgerEntryish> };
    const object = md.runLedger ?? [];
    const stream = await streamedEntries(dir);

    // CONTROL: the inline run really did build a tool-bearing ledger — without
    // this the parity assertion below would pass vacuously on two empty sets.
    expect(object.some((e) => e.kind === "tool-invocation")).toBe(true);

    // The invariant: same entries, same order, nothing dropped at the boundary.
    expect(stream.length).toBe(object.length);
    expect(stream.map((e) => `${e.seq}:${e.kind}`)).toEqual(object.map((e) => `${e.seq}:${e.kind}`));
  }, 30_000);

  it("kernel path streams every entry it puts on the object ledger", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-parity-kernel-"));
    const agent = await build(dir, true);
    const result = await agent.run("PARITY_TRIGGER do the work", { taskId: "parity-kernel" });
    await agent.dispose();

    const md = result.metadata as { runLedger?: ReadonlyArray<LedgerEntryish> };
    const object = md.runLedger ?? [];
    const stream = await streamedEntries(dir);

    expect(object.length).toBeGreaterThan(0);
    expect(stream.map((e) => `${e.seq}:${e.kind}`)).toEqual(object.map((e) => `${e.seq}:${e.kind}`));
  }, 30_000);

  // Exactly one publisher is live per run — the engine picks kernel XOR inline
  // (`execution-engine.ts`: `if (reasoningOpt._tag === "Some" && !cacheHit)` …
  // `else if (!cacheHit)`). If both ever published, entries would appear twice.
  it("never double-publishes an entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-parity-dup-"));
    const agent = await build(dir, false);
    await agent.run("PARITY_TRIGGER do the work", { taskId: "parity-dup" });
    await agent.dispose();

    const stream = await streamedEntries(dir);
    const seqs = stream.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  }, 30_000);
});
