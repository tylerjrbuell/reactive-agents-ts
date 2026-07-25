// Run: bun test packages/reasoning/src/kernel/ledger/run-scope.test.ts
//
// Wave C.2 slice 1 — the run-scoped ledger. A run executes up to three reasoning
// passes, each a separate kernel call whose ledger starts at seq 0; before this,
// only one survived and every sibling pass's facts were discarded.
import { describe, it, expect } from "bun:test";
import { appendEntries, type RunLedger } from "./run-ledger.js";
import { entriesOfPass, mergePassLedger } from "./run-scope.js";

const pass = (names: readonly string[]): RunLedger =>
  appendEntries(
    [],
    names.map((toolName) => ({ kind: "tool-invocation" as const, iteration: 0, toolName })),
  );

describe("mergePassLedger", () => {
  it("re-bases seq so two passes that both start at 0 stay dense and monotonic", () => {
    const runLedger = pass(["a", "b"]);
    const merged = mergePassLedger(runLedger, pass(["c", "d"]), "verification-retry");

    // The whole point: the incoming pass's own 0,1 would have collided.
    expect(merged.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    expect(merged.map((e) => (e as { toolName?: string }).toolName)).toEqual(["a", "b", "c", "d"]);
  });

  it("stamps provenance on merged entries and leaves the primary pass unstamped", () => {
    const merged = mergePassLedger(pass(["a"]), pass(["b"]), "continuation");

    expect(merged[0]?.pass).toBeUndefined();
    expect(merged[1]?.pass).toBe("continuation");
    expect(entriesOfPass(merged, undefined).map((e) => e.seq)).toEqual([0]);
    expect(entriesOfPass(merged, "continuation").map((e) => e.seq)).toEqual([1]);
  });

  it("attributes a sub-agent's whole ledger to that child by name", () => {
    const merged = mergePassLedger(pass(["parent-tool"]), pass(["child-tool"]), "sub-agent:researcher");

    expect(entriesOfPass(merged, "sub-agent:researcher")).toHaveLength(1);
    // Two children at the same depth stay distinguishable — the reason the
    // provenance is the child's NAME rather than a bare "sub-agent" marker.
    const both = mergePassLedger(merged, pass(["other-tool"]), "sub-agent:writer");
    expect(entriesOfPass(both, "sub-agent:researcher")).toHaveLength(1);
    expect(entriesOfPass(both, "sub-agent:writer")).toHaveLength(1);
  });

  it("preserves a grandchild's stamp when nesting (innermost provenance wins)", () => {
    // A child's ledger already holds an entry from its OWN nested child. When
    // that ledger merges into the grandparent, the grandchild entry must keep
    // its `sub-agent:grandchild` attribution rather than being flattened to the
    // immediate child — otherwise a two-level delegation reads as one.
    const childOwn = pass(["child-tool"]); // the child's own primary work — unstamped
    const withGrandchild = mergePassLedger(childOwn, pass(["grandchild-tool"]), "sub-agent:grandchild");
    const merged = mergePassLedger([], withGrandchild, "sub-agent:child");

    expect(entriesOfPass(merged, "sub-agent:child").map((e) => (e as { toolName?: string }).toolName)).toEqual(["child-tool"]);
    expect(entriesOfPass(merged, "sub-agent:grandchild").map((e) => (e as { toolName?: string }).toolName)).toEqual(["grandchild-tool"]);
  });

  it("is pure — neither input ledger is mutated, and prior entries keep identity", () => {
    const runLedger = pass(["a"]);
    const passLedger = pass(["b"]);
    const merged = mergePassLedger(runLedger, passLedger, "continuation");

    expect(runLedger).toHaveLength(1);
    expect(passLedger).toHaveLength(1);
    expect(passLedger[0]?.pass).toBeUndefined(); // the source was not stamped in place
    expect(merged[0]).toBe(runLedger[0]); // DAG law: prior entries keep identity
  });

  it("is the identity on an empty or absent pass ledger", () => {
    const runLedger = pass(["a"]);
    expect(mergePassLedger(runLedger, [], "continuation")).toBe(runLedger);
    expect(mergePassLedger(runLedger, undefined, "continuation")).toBe(runLedger);
    expect(mergePassLedger(undefined, undefined, "continuation")).toEqual([]);
  });
});

describe("seq re-base safety", () => {
  it("no production code writes a seq-shaped cross-reference between entries", async () => {
    // Re-basing seq is only sound while nothing REFERS to an entry by seq. This
    // pin is the tripwire: if a `seq:`-shaped ref is ever introduced,
    // mergePassLedger must grow a ref remap, and this fails first to say so.
    const { Glob } = await import("bun");
    const root = new URL("../../../src/", import.meta.url).pathname;
    const offenders: string[] = [];
    for await (const file of new Glob("**/*.ts").scan({ cwd: root })) {
      if (file.endsWith(".test.ts") || file.endsWith(".spec.ts")) continue;
      const text = await Bun.file(`${root}${file}`).text();
      // A ref built from an entry's seq, e.g. `evidenceRef: \`seq:${e.seq}\``.
      if (/["'`]seq:\s*(\$\{|"|\+)/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
