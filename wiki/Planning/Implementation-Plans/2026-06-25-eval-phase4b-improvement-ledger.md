# Eval Canonical System — Phase 4b (ImprovementLedger / L4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Follow the project's `agent-tdd` skill (Bun test, mandatory `--timeout`).

**Goal:** A code-owned, gate-centric `ImprovementLedger` that records the dogfood improvement chain — `weakness → hypothesis → gate verdict → regression-baseline` — fed by the shipped `rax eval gate` and inspectable via `rax eval ledger`. It is B's (verifiable self-improvement) substrate and the honest audit trail of harness-change attempts + their measured verdicts.

**Architecture:** A fresh, focused ledger (NOT the skill's `loop-state.json`). It **complements** `loop-state.json` cohesively: that file tracks the *probe loop* (passes, probeHistory, coverageMap, and probe-metric regression baselines like iterations/kernel-steps); the `ImprovementLedger` tracks the *gate-driven improvement loop* (lift-percentage verdicts). They are different concerns — no duplication — and the ledger cross-references `loop-state.json` weakness ids via an optional `weaknessRef`. The ledger lives in `@reactive-agents/benchmarks` (next to the gate, private). Two real consumers prevent orphaning: `rax eval gate --ledger <path>` appends a verdict entry (pinning a regression-baseline on a positive lift), and `rax eval ledger` lists entries. Pure core (`recordGateOutcome`, `formatLedger`) is unit-tested; load/save is async fs.

**Tech Stack:** TypeScript, Bun test, `node:fs/promises`.

## Global Constraints

- **Decisions locked:** fresh gate-centric ledger (not loop-state.json); **complements** loop-state.json (no duplication — gate lift-baselines vs probe-metric baselines are distinct), cross-refs its weakness ids; co-located at `wiki/Research/Harness-Reports/improvement-ledger.json`; scope = schema + load/save + gate-append + baseline-pin + a read/list command. **Cross-run baseline CHECK is OUT** (deferred).
- **No orphans:** the ledger MUST have live consumers in this cut (gate write + `rax eval ledger` read). Do not land types + load/save with no caller.
- **Pure core:** `recordGateOutcome`, `formatLedger`, `emptyLedger`, `statusFor` are pure (no fs, no `Date.now()`/`crypto.randomUUID()` — `id` + `createdAt` are passed in by the CLI). load/save are the only fs functions.
- **Home:** `@reactive-agents/benchmarks` (private). Consumed by the CLI via dynamic import (match `bench.ts`/`eval-gate.ts` — no static benchmarks dep in apps/cli).
- **Do not edit the harness-improvement-loop skill** in this cut (no change to `harness-evolve.ts`/`loop-state.json`). Cohesion is via a doc comment + the `weaknessRef` cross-ref field; a skill-side back-link is a noted optional follow-up.
- **Clean types:** strict TS, no `any`. Conditional spread for optional fields (no `undefined` keys). Conventional Commits, NO `Co-Authored-By`. `.js` import extensions. Test: `bun test <path> --timeout 10000`. Build: `bunx turbo run build --filter=<pkg>`.

---

## File Structure

- Create `packages/benchmarks/src/ledger.ts` — types + `emptyLedger` + `recordGateOutcome` + `formatLedger` (pure) + `loadLedger`/`saveLedger` (async fs).
- Modify `packages/benchmarks/src/index.ts` — export the ledger surface.
- Create `packages/benchmarks/tests/ledger.test.ts` — pure-fn tests + load/save roundtrip.
- Modify `apps/cli/src/commands/eval-gate.ts` — `--ledger <path> [--weakness] [--hypothesis] [--weakness-ref]` appends a verdict entry.
- Create `apps/cli/src/commands/eval-ledger.ts` — `runEvalLedger(args)` (read/list via `formatLedger`).
- Modify `apps/cli/src/commands/eval.ts` — dispatch `args[0] === "ledger"` → `runEvalLedger`.

---

## Task 1: The ImprovementLedger (types + pure core + load/save)

**Files:**
- Create: `packages/benchmarks/src/ledger.ts`
- Modify: `packages/benchmarks/src/index.ts`
- Test: `packages/benchmarks/tests/ledger.test.ts`

**Interfaces:**
- Consumes: `GateVerdict`, `GateDecision` from `./gate/types.js`.
- Produces (exported from `@reactive-agents/benchmarks`):
  - types `ImprovementLedger`, `ImprovementEntry`, `RegressionBaseline`, `ImprovementStatus`, `RecordGateParams`
  - `emptyLedger(): ImprovementLedger`
  - `recordGateOutcome(ledger: ImprovementLedger, params: RecordGateParams): ImprovementLedger`
  - `formatLedger(ledger: ImprovementLedger): string`
  - `loadLedger(path: string): Promise<ImprovementLedger>` (empty if missing)
  - `saveLedger(path: string, ledger: ImprovementLedger): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `packages/benchmarks/tests/ledger.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GateVerdict } from "../src/gate/types.ts";
import {
  emptyLedger,
  formatLedger,
  loadLedger,
  recordGateOutcome,
  saveLedger,
  type RecordGateParams,
} from "../src/ledger.ts";

function verdict(decision: GateVerdict["decision"], liftPp: number): GateVerdict {
  return {
    decision,
    perTier: [],
    aggregate: { liftPp, tokenOverheadPct: 2, tiersCovered: 2 },
    partial: false,
    rationale: `${decision} · ${liftPp}pp`,
    baselineVariantId: "bare-llm",
    candidateVariantId: "ra-full",
  };
}

function params(decision: GateVerdict["decision"], liftPp: number): RecordGateParams {
  return {
    id: "entry-1",
    createdAt: "2026-06-25T00:00:00.000Z",
    weakness: "tool-result truncated",
    hypothesis: "raise ctx-budget on attend",
    metric: "accuracy",
    verdict: verdict(decision, liftPp),
  };
}

describe("recordGateOutcome", () => {
  it("maps default-on → adopted and pins a regression-baseline", () => {
    const l = recordGateOutcome(emptyLedger(), params("default-on", 4.5));
    expect(l.entries.length).toBe(1);
    expect(l.entries[0]!.status).toBe("adopted");
    expect(l.entries[0]!.regressionBaseline).toBeDefined();
    expect(l.entries[0]!.regressionBaseline!.liftPp).toBe(4.5);
    expect(l.entries[0]!.regressionBaseline!.metric).toBe("accuracy");
  });

  it("maps opt-in → opt-in and still pins a baseline (positive lift)", () => {
    const l = recordGateOutcome(emptyLedger(), params("opt-in", 1.5));
    expect(l.entries[0]!.status).toBe("opt-in");
    expect(l.entries[0]!.regressionBaseline).toBeDefined();
  });

  it("maps reject → rejected and pins NO baseline", () => {
    const l = recordGateOutcome(emptyLedger(), params("reject", -3));
    expect(l.entries[0]!.status).toBe("rejected");
    expect(l.entries[0]!.regressionBaseline).toBeUndefined();
  });

  it("does not pin a baseline when lift is not positive even if non-reject", () => {
    const l = recordGateOutcome(emptyLedger(), params("opt-in", 0));
    expect(l.entries[0]!.regressionBaseline).toBeUndefined();
  });

  it("appends immutably (does not mutate the input ledger)", () => {
    const base = emptyLedger();
    const l = recordGateOutcome(base, params("default-on", 4));
    expect(base.entries.length).toBe(0);
    expect(l.entries.length).toBe(1);
  });

  it("carries the optional weaknessRef cross-reference when provided", () => {
    const l = recordGateOutcome(emptyLedger(), { ...params("default-on", 4), weaknessRef: "w1-text-fc" });
    expect(l.entries[0]!.weaknessRef).toBe("w1-text-fc");
  });
});

describe("formatLedger", () => {
  it("renders entry status, decision, lift, and ids", () => {
    const l = recordGateOutcome(emptyLedger(), params("default-on", 4.5));
    const out = formatLedger(l);
    expect(out).toContain("adopted");
    expect(out).toContain("ra-full");
    expect(out).toContain("4.5");
  });

  it("renders an empty-ledger message", () => {
    expect(formatLedger(emptyLedger())).toContain("no entries");
  });
});

describe("loadLedger / saveLedger", () => {
  it("returns an empty ledger when the file is missing", async () => {
    const l = await loadLedger(join(tmpdir(), "no-such-ledger-xyz-123.json"));
    expect(l.entries.length).toBe(0);
    expect(l.version).toBeGreaterThan(0);
  });

  it("round-trips a saved ledger", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ledger-"));
    const path = join(dir, "improvement-ledger.json");
    const saved = recordGateOutcome(emptyLedger(), params("default-on", 4.5));
    await saveLedger(path, saved);
    const loaded = await loadLedger(path);
    expect(loaded.entries.length).toBe(1);
    expect(loaded.entries[0]!.status).toBe("adopted");
    await rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/benchmarks/tests/ledger.test.ts --timeout 10000`
Expected: FAIL — `Cannot find module "../src/ledger.ts"`.

- [ ] **Step 3: Implement `ledger.ts`**

Create `packages/benchmarks/src/ledger.ts`:

```ts
// File: src/ledger.ts
// ImprovementLedger (L4) — the gate-driven dogfood improvement chain:
//   weakness → hypothesis → gate verdict → regression-baseline.
//
// COMPLEMENTS (does not replace) the harness-improvement-loop skill's
// `loop-state.json`: that file tracks the PROBE loop (passes, probeHistory,
// coverageMap, and probe-metric baselines such as iterations / kernel-steps).
// THIS ledger tracks the GATE-driven loop (lift-percentage verdicts). The two
// are distinct concerns — no duplication. An entry may cross-reference a
// loop-state.json `knownWeakness.id` via `weaknessRef`.
// Pure core (recordGateOutcome / formatLedger) takes `id` + `createdAt` as
// inputs so it stays deterministic; load/save are the only fs functions.
import { readFile, writeFile } from "node:fs/promises";
import type { GateDecision, GateVerdict } from "./gate/types.js";

export const LEDGER_VERSION = 1;

export type ImprovementStatus = "adopted" | "opt-in" | "rejected";

export interface RegressionBaseline {
  readonly metric: string;
  readonly baselineVariantId: string;
  readonly candidateVariantId: string;
  readonly liftPp: number;
  readonly tokenOverheadPct: number;
  readonly tiersCovered: number;
  readonly pinnedAt: string;
}

export interface ImprovementEntry {
  readonly id: string;
  readonly createdAt: string;
  readonly weakness: string;
  readonly weaknessRef?: string; // cross-ref to loop-state.json knownWeakness.id
  readonly hypothesis: string;
  readonly baselineVariantId: string;
  readonly candidateVariantId: string;
  readonly decision: GateDecision;
  readonly liftPp: number;
  readonly tokenOverheadPct: number;
  readonly rationale: string;
  readonly regressionBaseline?: RegressionBaseline;
  readonly status: ImprovementStatus;
}

export interface ImprovementLedger {
  readonly version: number;
  readonly entries: readonly ImprovementEntry[];
}

export interface RecordGateParams {
  readonly id: string;
  readonly createdAt: string;
  readonly weakness: string;
  readonly weaknessRef?: string;
  readonly hypothesis: string;
  readonly metric: string;
  readonly verdict: GateVerdict;
}

export function emptyLedger(): ImprovementLedger {
  return { version: LEDGER_VERSION, entries: [] };
}

function statusFor(decision: GateDecision): ImprovementStatus {
  return decision === "default-on" ? "adopted" : decision === "opt-in" ? "opt-in" : "rejected";
}

export function recordGateOutcome(
  ledger: ImprovementLedger,
  p: RecordGateParams,
): ImprovementLedger {
  const decision = p.verdict.decision;
  const agg = p.verdict.aggregate;
  // Pin a regression-baseline only for a real positive lift worth protecting.
  const pin = decision !== "reject" && agg.liftPp > 0;
  const entry: ImprovementEntry = {
    id: p.id,
    createdAt: p.createdAt,
    weakness: p.weakness,
    ...(p.weaknessRef ? { weaknessRef: p.weaknessRef } : {}),
    hypothesis: p.hypothesis,
    baselineVariantId: p.verdict.baselineVariantId,
    candidateVariantId: p.verdict.candidateVariantId,
    decision,
    liftPp: agg.liftPp,
    tokenOverheadPct: agg.tokenOverheadPct,
    rationale: p.verdict.rationale,
    ...(pin
      ? {
          regressionBaseline: {
            metric: p.metric,
            baselineVariantId: p.verdict.baselineVariantId,
            candidateVariantId: p.verdict.candidateVariantId,
            liftPp: agg.liftPp,
            tokenOverheadPct: agg.tokenOverheadPct,
            tiersCovered: agg.tiersCovered,
            pinnedAt: p.createdAt,
          },
        }
      : {}),
    status: statusFor(decision),
  };
  return { version: ledger.version, entries: [...ledger.entries, entry] };
}

export function formatLedger(ledger: ImprovementLedger): string {
  if (ledger.entries.length === 0) return "Improvement ledger: no entries.";
  const header = `Improvement ledger · ${ledger.entries.length} entr${ledger.entries.length === 1 ? "y" : "ies"}`;
  const rows = ledger.entries.map((e) => {
    const lift = `${e.liftPp >= 0 ? "+" : ""}${e.liftPp.toFixed(1)}pp`;
    const pin = e.regressionBaseline ? " [baseline pinned]" : "";
    return `  ${e.status.padEnd(8)} ${e.candidateVariantId} vs ${e.baselineVariantId}  ${lift}  — ${e.weakness}${pin}`;
  });
  return [header, ...rows].join("\n");
}

export async function loadLedger(path: string): Promise<ImprovementLedger> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as ImprovementLedger;
    if (typeof parsed?.version !== "number" || !Array.isArray(parsed?.entries)) {
      return emptyLedger();
    }
    return parsed;
  } catch {
    return emptyLedger();
  }
}

export async function saveLedger(path: string, ledger: ImprovementLedger): Promise<void> {
  await writeFile(path, JSON.stringify(ledger, null, 2), "utf8");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/benchmarks/tests/ledger.test.ts --timeout 10000`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Export from the package entry**

In `packages/benchmarks/src/index.ts`, add on the v2 `@unstable` surface (near the gate export `export * from "./gate/index.js"`):

```ts
// ── v2 @unstable: improvement ledger (L4) ────────────────────────
export * from "./ledger.js";
```

- [ ] **Step 6: Build benchmarks**

Run: `bunx turbo run build --filter=@reactive-agents/benchmarks`
Expected: build success.

- [ ] **Step 7: Commit**

```bash
git add packages/benchmarks/src/ledger.ts packages/benchmarks/src/index.ts packages/benchmarks/tests/ledger.test.ts
git commit -m "feat(benchmarks): ImprovementLedger — gate-driven improvement chain (L4)"
```

---

## Task 2: Wire the ledger into the CLI (gate-append + read/list)

**Files:**
- Modify: `apps/cli/src/commands/eval-gate.ts` (append on `--ledger`)
- Create: `apps/cli/src/commands/eval-ledger.ts` (`rax eval ledger` read/list)
- Modify: `apps/cli/src/commands/eval.ts` (dispatch `ledger`)

**Interfaces:**
- Consumes (dynamic import from `@reactive-agents/benchmarks`): `recordGateOutcome`, `loadLedger`, `saveLedger`, `formatLedger`, `emptyLedger`.
- Produces: `rax eval gate … --ledger <path> [--weakness <t>] [--hypothesis <t>] [--weakness-ref <id>]`; `rax eval ledger [--path <p>]`.

- [ ] **Step 1: Append to the ledger in `runEvalGate` when `--ledger` is set**

In `apps/cli/src/commands/eval-gate.ts`, after the verdict is computed + the receipt printed, and BEFORE `process.exit(decideExitCode(verdict))`, add the append block. The benchmarks module is already dynamic-imported in this function — reuse it (add `recordGateOutcome`, `loadLedger`, `saveLedger` to the destructure):

```ts
const ledgerPath = get("--ledger");
if (ledgerPath) {
  const { recordGateOutcome, loadLedger, saveLedger } = benchmarks;
  const ledger = await loadLedger(ledgerPath);
  const updated = recordGateOutcome(ledger, {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    weakness: get("--weakness") ?? `${candidate} vs ${baseline}`,
    ...(get("--weakness-ref") ? { weaknessRef: get("--weakness-ref") as string } : {}),
    hypothesis: get("--hypothesis") ?? candidate,
    metric: policy.metric,
    verdict,
  });
  await saveLedger(ledgerPath, updated);
  console.log(info(`Recorded to improvement ledger: ${ledgerPath} (${updated.entries.length} entries)`));
}
process.exit(decideExitCode(verdict));
```

(`crypto.randomUUID()`/`new Date()` live in the CLI wrapper — the ledger core stays pure. `candidate`/`baseline`/`policy` are already in scope from Task-1-of-Phase-4's gate command.) Update `GATE_USAGE` to mention `[--ledger <path> --weakness <t> --hypothesis <t> --weakness-ref <id>]`.

- [ ] **Step 2: Write the `rax eval ledger` read command**

Create `apps/cli/src/commands/eval-ledger.ts`:

```ts
// File: apps/cli/src/commands/eval-ledger.ts
import { fail } from "../ui.js";

const DEFAULT_LEDGER_PATH = "wiki/Research/Harness-Reports/improvement-ledger.json";
const LEDGER_USAGE = "Usage: rax eval ledger [--path <improvement-ledger.json>]";

export async function runEvalLedger(args: string[]): Promise<void> {
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
  };
  if (args.includes("--help")) {
    console.log(LEDGER_USAGE);
    return;
  }
  const path = get("--path") ?? DEFAULT_LEDGER_PATH;

  let benchmarks: typeof import("@reactive-agents/benchmarks");
  try {
    benchmarks = await import("@reactive-agents/benchmarks");
  } catch {
    console.error(
      fail("rax eval ledger requires @reactive-agents/benchmarks, which is only available inside the reactive-agents-ts repo."),
    );
    process.exit(1);
  }
  const { loadLedger, formatLedger } = benchmarks;
  const ledger = await loadLedger(path);
  console.log(formatLedger(ledger));
}
```

- [ ] **Step 3: Dispatch `ledger` in `runEval`**

In `apps/cli/src/commands/eval.ts`, add the import:

```ts
import { runEvalLedger } from "./eval-ledger.js";
```

And add the branch alongside the existing `gate` dispatch at the top of `runEval`:

```ts
  if (subcommand === "ledger") {
    return runEvalLedger(args);
  }
```

Extend `USAGE` to include the `ledger` line:

```ts
  "  rax eval ledger [--path <improvement-ledger.json>]";
```

- [ ] **Step 4: Build the CLI + run the CLI tests**

Run: `bunx turbo run build --filter=@reactive-agents/cli`
Then: `bun test apps/cli/tests --timeout 20000`
Expected: build green; existing CLI tests (incl. the Phase-4 `decideExitCode` tests) green — this task adds commands, changes no existing behavior.

- [ ] **Step 5: Smoke (best-effort)**

Build a small fixture `SessionReport` JSON (as in Phase-4 Task 1's smoke / `packages/benchmarks/tests/gate.test.ts` fixtures), then:
`bun run apps/cli/src/index.ts eval gate --report <tmp> --baseline base --candidate cand --ledger /tmp/imp-ledger.json --weakness "smoke" --hypothesis "test"`
then `bun run apps/cli/src/index.ts eval ledger --path /tmp/imp-ledger.json` and confirm the entry lists. If running the CLI from source is impractical, note it and rely on Task-1 unit tests + the build. Do NOT block.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/eval-gate.ts apps/cli/src/commands/eval-ledger.ts apps/cli/src/commands/eval.ts
git commit -m "feat(cli): rax eval gate --ledger append + rax eval ledger read"
```

---

## Done Criteria

- `@reactive-agents/benchmarks` exports a code-owned `ImprovementLedger` with pure `recordGateOutcome` (default-on→adopted+baseline, opt-in→opt-in+baseline-on-positive-lift, reject→rejected+no-baseline, immutable append, optional `weaknessRef`) + `formatLedger` + async `loadLedger`/`saveLedger`; all tested.
- `rax eval gate --ledger <path>` appends a verdict entry (pinning a regression-baseline on positive lift); `rax eval ledger` lists entries. Two live consumers — not scaffold.
- Cohesion: doc comment states the complementary relationship to `loop-state.json`; `weaknessRef` cross-refs it; default ledger path co-located in `wiki/Research/Harness-Reports/`. No edit to the skill / `loop-state.json` (no orphaned/duplicated data).
- CLI + benchmarks build green; existing tests pass. No static benchmarks dep added to the CLI.

## Deferred (NOT in this plan)
- **Cross-run baseline CHECK:** on a gate run, compare against pinned `regressionBaseline`s to flag silent regression (needs cross-run resolution; deferred earlier).
- **B (the loop reads the ledger to choose the next hypothesis).** The ledger is its substrate; the autonomous loop is later.
- Skill-side back-link (`harness-evolve.ts` referencing the ImprovementLedger) — optional follow-up.
- Migrating loop-state.json's probe-metric baselines anywhere — they stay skill-owned (distinct concern).

## Self-Review notes
- **Spec coverage:** implements canonical-evaluation-system §5/§7 L4 ImprovementLedger (the deferred half of Phase 4) — the gate-driven weakness→hypothesis→verdict→regression-baseline chain, code-owned, with the gate as its writer (the §9 anti-scaffold requirement) and a read command for inspectability.
- **Cohesion / no-orphans:** the ledger complements `loop-state.json` (distinct baseline kinds — lift% vs probe-metric — so no duplication), cross-refs its weakness ids, co-locates the artifact, and has two live consumers. The skill is untouched (no broken references).
- **Type/purity consistency:** `recordGateOutcome`/`formatLedger`/`emptyLedger`/`statusFor` are pure (id+createdAt injected); load/save isolate fs. Field + fn names identical across tasks. Conditional spreads avoid `undefined` keys.
- **Placeholder scan:** every code step carries complete code; the one cross-file dependency (the Phase-4 gate command's in-scope `candidate`/`baseline`/`policy`/`benchmarks`/`get`/`info`) is named explicitly for the implementer.
