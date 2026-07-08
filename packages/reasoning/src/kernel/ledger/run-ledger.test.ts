/**
 * run-ledger.test.ts — the append-only RunLedger spine (Wave C / task C1).
 *
 * Pins the DAG-law invariants: entries are facts (append-only, never mutated in
 * place), `seq` is a dense monotonic index assigned by `appendEntry`, and the
 * typed query helpers narrow by kind. These are the substrate guarantees every
 * later wave (Assessment, Projector, Control) projects from.
 */
import { describe, expect, it } from "bun:test";
import {
  appendEntry,
  appendEntries,
  entriesOfKind,
  ledgerSize,
  nextSeq,
  type LedgerEntry,
  type RunLedger,
} from "./run-ledger.js";

describe("RunLedger — append-only spine", () => {
  it("appendEntry assigns a dense monotonic seq and preserves append order", () => {
    let ledger: RunLedger = [];
    ledger = appendEntry(ledger, { kind: "harness-signal", iteration: 0, signal: "a" });
    ledger = appendEntry(ledger, { kind: "harness-signal", iteration: 1, signal: "b" });
    ledger = appendEntry(ledger, { kind: "harness-signal", iteration: 2, signal: "c" });
    expect(ledger.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(ledger.map((e) => (e.kind === "harness-signal" ? e.signal : ""))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("is append-only — appendEntry never mutates the input ledger (DAG law)", () => {
    const original = appendEntry([], { kind: "claim", iteration: 0, text: "x" });
    const grown = appendEntry(original, { kind: "claim", iteration: 1, text: "y" });
    expect(original.length).toBe(1); // untouched
    expect(grown.length).toBe(2);
    expect(original[0]).toBe(grown[0]); // prior facts are the SAME object refs
  });

  it("treats undefined ledger as empty (state-field convention)", () => {
    const ledger = appendEntry(undefined, { kind: "verdict", iteration: 3, gate: "terminal", verified: true });
    expect(ledger.length).toBe(1);
    expect(ledger[0]?.seq).toBe(0);
    expect(nextSeq(undefined)).toBe(0);
    expect(ledgerSize(undefined)).toBe(0);
  });

  it("appendEntries assigns consecutive seqs in one shot", () => {
    const ledger = appendEntries(appendEntry([], { kind: "claim", iteration: 0, text: "seed" }), [
      { kind: "tool-invocation", iteration: 1, toolName: "web-search" },
      { kind: "tool-result", iteration: 1, success: true, preview: "..." },
    ]);
    expect(ledger.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it("entriesOfKind filters AND narrows the discriminated union", () => {
    let ledger: RunLedger = [];
    ledger = appendEntry(ledger, { kind: "tool-invocation", iteration: 0, toolName: "http-get" });
    ledger = appendEntry(ledger, { kind: "tool-result", iteration: 0, success: true, preview: "ok" });
    ledger = appendEntry(ledger, { kind: "tool-invocation", iteration: 1, toolName: "web-search" });
    const invocations = entriesOfKind(ledger, "tool-invocation");
    expect(invocations.length).toBe(2);
    // Type narrowing: `.toolName` is accessible without a cast.
    expect(invocations.map((e) => e.toolName)).toEqual(["http-get", "web-search"]);
    expect(entriesOfKind(ledger, "tool-result").length).toBe(1);
    expect(entriesOfKind(undefined, "verdict")).toEqual([]);
  });

  it("carries every declared entry kind as a typed variant", () => {
    // Compile-time coverage: each kind constructs without a cast. If a variant's
    // required payload changes, this stops compiling — the design is pinned.
    const kinds: LedgerEntry["kind"][] = [
      "tool-invocation",
      "tool-result",
      "artifact",
      "requirement",
      "claim",
      "verdict",
      "harness-signal",
      "handoff",
      "contract-amended",
      "compaction-marker",
      "checkpoint-marker",
      "deliverable-commit",
    ];
    let ledger: RunLedger = [];
    ledger = appendEntry(ledger, { kind: "tool-invocation", iteration: 0, toolName: "t" });
    ledger = appendEntry(ledger, { kind: "tool-result", iteration: 0, success: false, preview: "p" });
    ledger = appendEntry(ledger, { kind: "artifact", iteration: 0, path: "./r.md", op: "write" });
    ledger = appendEntry(ledger, { kind: "requirement", iteration: 0, requirementId: "answer", status: "declared" });
    ledger = appendEntry(ledger, { kind: "claim", iteration: 0, text: "42ms" });
    ledger = appendEntry(ledger, { kind: "verdict", iteration: 0, gate: "per-step", verified: true });
    ledger = appendEntry(ledger, { kind: "harness-signal", iteration: 0, signal: "s" });
    ledger = appendEntry(ledger, { kind: "handoff", iteration: 0, from: "a", to: "b", summary: "sum" });
    ledger = appendEntry(ledger, { kind: "contract-amended", iteration: 0, requirementId: "r1", reason: "why" });
    ledger = appendEntry(ledger, { kind: "compaction-marker", iteration: 0, droppedRefs: ["res_1"] });
    ledger = appendEntry(ledger, { kind: "checkpoint-marker", iteration: 0 });
    ledger = appendEntry(ledger, { kind: "deliverable-commit", iteration: 0, ref: "./r.md" });
    expect(new Set(ledger.map((e) => e.kind))).toEqual(new Set(kinds));
    // compaction-marker carries its dropped-ref enumeration (audit 03-F4).
    const compaction = entriesOfKind(ledger, "compaction-marker")[0];
    expect(compaction?.droppedRefs).toEqual(["res_1"]);
  });
});
