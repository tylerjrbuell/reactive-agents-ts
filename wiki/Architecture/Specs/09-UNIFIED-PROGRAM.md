# 09 — The Unified Program (Canonical North Star, 2026-07-08)

**Status:** CANONICAL sequencing + convergence authority for all Reactive Agents work.
**Reconciles:** [[08-AGENTIC-OS-NORTH-STAR|08 — Agentic OS v6.0]] (product arcs) · [[../../Planning/Implementation-Plans/2026-07-07-adaptive-harness-overhaul|adaptive-harness overhaul]] (kernel phases, amended) · [[../Design-Specs/2026-07-08-harness-meta-loop-missing-pieces|meta-loop spec]] · [[../../Planning/Implementation-Plans/2026-07-08-meta-loop-execution-plan|execution plan]] (dispatch waves) · the bench/publication thread.
**Supersession:** 08's ARC SEQUENCING ("Arc 2 next after launch") is superseded by §4 below. Everything else in 08 stands. The overhaul plan and execution plan are unchanged — this document tells them WHERE they sit.

---

## 1. The one goal

> **Reactive Agents is the canonical agentic OS whose kernel is a self-aware harness: every run is governed by a typed contract, evidenced in one ledger, assessed continuously, controlled through one plane, and rendered through one projector — and every capability the OS claims is proven by its own instrument before it is claimed.**

Everything in flight is one of three strands of that sentence:

| Strand | What it is | Governing doc | Altitude |
|---|---|---|---|
| **K — Kernel** (the engine) | Meta-loop overhaul: Contract → Ledger → Assessment → Control → Actuators → Projector | overhaul plan + meta-loop spec + execution plan (Waves A–G) | inside the run |
| **P — Product** (what users get) | OS arcs: Log+Process+Receipt ✅ → Boundary+Gate → Team → Flywheel | 08 v6.0 | around the run |
| **T — Truth** (how both are proven) | Bench + lh-1 + lift gate + receipts + publication line | bench validity fix, Wave A, gate/ledger, launch-gate item 5 | above both |

The strands are not rivals and not phases of each other. K makes agents CAPABLE (advanced problem solving, long-horizon, efficient). P makes them GOVERNABLE and SHIPPABLE (processes, boundaries, teams, flywheel). T keeps both HONEST. A release is a slice through all three.

## 2. Why K currently leads

User mandate (2026-07-07/08): harness wins first; publication blocked until the engine is defensible. The 2026-07-08 sweep proved the kernel lacked half its own loop (D1–D4). P-arcs 2–4 all CONSUME kernel pieces that don't exist yet (see §3) — building them first would wire product features onto the diseases. Arc 1 shipped before this was known; §3-C1 resolves the overlap it created.

## 3. Convergence rulings (where the documents would collide — these are binding)

**C1 — One event store.** Arc 1's "one canonical event log" (08 §4.1) and Phase 4b's RunLedger are the SAME THING at two altitudes. Ruling: **RunLedger (kernel) is the substrate**; Arc 1's trace JSONL, llm-exchange capture, `run_events` journal, EventBus, and steps[] all become ledger projections during Wave C. The Arc 1 replay/fork/receipt machinery re-bases onto ledger queries — no second store, ever. (GH #188's 3-way stream divergence dies here too.)

**C2 — One contract.** RunContract (4a) absorbs and extends TaskContract. It is the single typed answer to "what does done mean": the terminal gate reads it (K), `receipt.deliverables[]` reads it (P, extends Arc 1's trust spine), Arc 2's `.withPolicy` boundary and public gate consume its constraints (P), and lh-1/rw-8 score against it (T).

**C3 — One trust spine.** Arc 1's receipt + 4b's persisted `verdict`/`claim`/`deliverable-commit` entries + the terminal gate + the P6b independent checker are one chain of custody: evidence (ledger) → decision (gate) → record (receipt). `trustVerdict` stays bench-side. The receipt's false-verified rate is measured on the bench and published (08's honest-claims law, now with the instrument to satisfy it).

**C4 — One instrument.** Arc 2 §5.3's "public gate" (unify packages/eval with the bench lift-gate) and Wave A3/G3's amended lift rule are the same artifact. lh-1 joins the public suite. There is exactly one definition of "improvement" in this codebase.

**C5 — Teams wait for perception.** Arc 3's chain of command (parent verifies child receipts, budget/tool overrides per worker) requires RunAssessment (5a) and the contract — a parent cannot supervise progress that isn't measured. Exception: A2A last-mile wiring (08 §6.1, small) is independent plumbing and may ship whenever convenient.

**C6 — The flywheel IS the policy compiler, grown up.** Arc 4's "self-calibrating runtime" and Phase 6/G's `.withAdaptiveHarness()` recompile-on-evidence are one capability: G is its kernel half, Arc 4 items 1–7 its ecosystem half, and Arc 4 item 8 (verifiable self-improvement) = ledger replay (C1) + public gate (C4) + policy compiler (G) composed. Phase 7 (Strategy→Policy) is the kernel-side finale of the same movement.

**C7 — The launch line does not wait for the ledger.** v0.14 = Arc 1 payload (already merged) + Phases 1–3.6 harness wins + bench receipts (launch-gate item 5) + honest posture (cogito 44% headline + qwen per-task pattern + the arc 35→61→71 story). Publishable at the Wave A/B boundary. Waves C+ ride later releases.

## 4. The unified sequence (supersedes 08 §arc-ordering)

> **AMENDMENT (ratified by owner decision, 2026-07-13/19).** C7's "launch line does not wait for the ledger"
> is suspended: the 07-13 validation sweep found the release would ship false claims (9 lying withers incl.
> an inert safety switch, invalid benchmark numbers, red main). **v0.14 now ships at Wave 6 of
> [[../../Planning/Implementation-Plans/2026-07-13-debt-burndown|the debt burndown]]**, which is the ONLY
> active program until complete (WIP=1). Items live in [[../DEBT-REGISTER|DEBT-REGISTER]]. The sequence
> below resumes (Waves C+ consumers, Arc 2, …) after burndown Wave 6. The one-goal sentence in §1 is
> unchanged — the burndown IS strand T applied to ourselves.

```
NOW   Wave A (lh-1 ∥ horizon profile ∥ lift rule)      [K+T — the instrument]
  ∥   v0.14 launch-line prep (bench receipts thread)    [T+P]
──────────────────────────────────────────────────────────────
next  Wave B (4a RunContract)                           [K; C2 lands]
  →   v0.14 SHIP (Arc 1 + harness wins + receipts)      [P+T launch]
──────────────────────────────────────────────────────────────
then  Wave C (4b RunLedger — Arc 1 log converges, C1)   [K+P]
  →   Wave D (4c Projector) ∥ Wave E (5a Assessment)    [K]
  →   Wave F (5b Control Plane)                         [K]
──────────────────────────────────────────────────────────────
then  Arc 2 (boundary + gate + config truthfulness;     [P; consumes C2/C4]
             public gate = C4 unification)
  →   Wave G (Policy Compiler + routing + ablation)     [K; C6 seed]
  ∥   Arc 3 (team on the rails; A2A last-mile anytime)  [P; gated by C5]
──────────────────────────────────────────────────────────────
last  Arc 4 (flywheel/commons) + Phase 7 (Strategy→Policy) — one movement (C6)
```

Version line (ROADMAP mapping): **v0.14** Arc 1 + meta-loop foundations (Phases 1–3.6) · **v0.15** the self-aware kernel (Contract/Ledger/Projector/Assessment/Control) · **v0.16** Boundary + Gate (Arc 2) · **v0.17** Team (Arc 3) · **v0.18** Flywheel (Arc 4 + Phase 7).

## 5. Authority hierarchy (who governs what)

1. **This document** — program sequencing, convergence rulings, release slicing.
2. **08 v6.0** — product-arc content (scope, exit gates, honest-claims law, non-goals).
3. **Meta-loop spec + amended overhaul plan** — kernel architecture and phase scope.
4. **Execution plan (Waves A–G)** — dispatch mechanics: task briefs, ground rules, traceability matrix.
5. **Improvement ledger + bench reports** — the evidence record every claim above answers to.

Conflict rule: lower documents defer upward; a needed change to a higher document is a ratification event (decision doc), not an edit-in-passing.

## 6. Program invariants (already law, restated once)

- Every subsystem: one owner module + one grep-able enforcement script. No script → not done.
- Default-on only via the (per-task-class) lift rule; ablation-warden veto stands.
- Honest-claims law (08 §binding notes) applies to receipts, forks, replay, and OUR OWN headlines.
- The meta-loop DAG is one-directional; control re-enters as ledger entries only.
- Falsified levers stay dead (no LATS/GoT, no resurfaced levers); non-goals in 08 §9 carried.

## 7. Status board (updated 2026-07-22)

> **v0.14.0 RELEASED 2026-07-22** (npm live, 34 pkgs; GitHub Release published; main synced with origin).
> The §4 amendment is DISCHARGED: debt burndown Waves 0–5 complete (lies removed, 7-boundary spine
> shipped red-on-cut, dead code deleted, P0-4 discharged), full doc sync + first-timer quality sweep done.
> **The §4 sequence RESUMES: next program step = Wave C (4b RunLedger — Arc 1 log converges, C1).**
> Remaining register debt = 5 Wave-5-class instrument items + the owed bench re-baseline run (owner-gated).
> **Wave C.1 (slices 1–3) SHIPPED 2026-07-22:** equivalence invariant + receipt re-base +
> `LedgerEntryAppended` live tap.
> **Wave C.2 slice 1 SHIPPED 2026-07-24:** the RunLedger is RUN-scoped, not pass-scoped — a run
> executes reasoning up to three ways and each auxiliary pass overwrote the previous ledger, so
> the terminal pass's facts never reached the receipt. `kernel/ledger/run-scope.ts` merges a pass
> with seq re-base + `pass` provenance; `engine/run-ledger-scope.ts` is the engine seam; gated by
> `check-cross-cutting.sh` Check 7. Plan: [[../../Planning/Implementation-Plans/2026-07-24-wave-c2-ledger-run-scope]].
> **Wave C.2 slice 2 SHIPPED 2026-07-24 (`0ebd05de`):** a sub-agent's ledger merges into its parent's
> under `sub-agent:<name>` (nested provenance innermost-wins). Load-bearing fix was `inline-act.ts` —
> delegation runs the engine's INLINE loop, which built steps but no ledger.
> **Wave C.2 slice 3 SHIPPED 2026-07-25 — C1's stream half, in three parts:**
> - **3a (`416cfccd`)** — `ledger-entry` TraceEvent kind + `normalize.ts` case. The C.1 tap published on
>   the EventBus but `toTraceEvent` returned `null` for it, so the ledger never reached the trace JSONL
>   at all. Per the ratified reading's point 3 ("the ledger is CANONICAL for all new readers — receipt,
>   **stream**, journal"), this is the stream reader landing.
> - **3b-i (`ab6b3571`)** — the inline path publishes its ledger. Closes the registered
>   `runLedger`-on-the-live-engine-path drop (below).
> - **3b-ii (`c168ee57`) — the C1 WRITE-PATH hole closed.** C1's "no second store" has two halves;
>   the single-write-path half was unenforced. `check-ledger-writes.sh` fenced the append API to
>   `kernel/ledger/`, but `projectStepsToLedger` calls that API from INSIDE the fence and was callable
>   from anywhere — and the script only searched `packages/reasoning`. Four ledger factories existed
>   where the invariant assumes one; three announced nothing. Measured: `code-action` object=3/stream=0,
>   `reflexion` object and stream **DISJOINT** (`[tool-result×2]` vs `[requirement, verdict]×2`),
>   `inline-act` object=2/stream=0 — i.e. **GH #188's divergence was alive in the tree**, which C1
>   exists to kill. Fixed with ONE announced seam (`kernel/ledger/ledger-sink.ts` `growRunLedger`):
>   growth and publication are a single act, announced at CONSTRUCTION so the stream stays live.
>   Gate extended to confine `projectStepsToLedger` to the ledger home across BOTH packages
>   (`kernel-state.ts` exempt — it is the `transitionState` chokepoint, announced by the runner tap).
>   Pinned per-strategy by `ledger-announced-seam.test.ts`, red-on-cut at gate and test.
>
> - **3c (`27e81ca8`)** — the analyzer reads the ledger for tool facts. `tool-call-*` events record only
>   what a run invoked DIRECTLY, so a delegating parent showed `[spawn-agent]` against a 9-entry ledger
>   spanning two children — and `deliverableProduced` reported "no deliverable-file write seen" for a run
>   whose delegate had written it. Ledger-preferred with an event fallback (historical JSONL + golden
>   fixtures byte-stable), declining the ledger view when it holds no tool entries so a richer substrate
>   can never regress. `tools[]` stays on the event view (transport-level `calls`/`truncated`).
>
> **WAVE C.2 COMPLETE.** C1's ruling is satisfied on both halves: the ledger is the substrate with a
> single enforced write path (`growRunLedger` + gate) and it is canonical for the receipt (C.1 slice 2),
> the stream (3a/3b) and the analyzer (3c). Write-path enforcement ratified:
> [[../../Decisions/2026-07-25-c1-write-path-enforcement]].
> NOTE: the original slice-3 framing of "llm-exchange/replay re-base" was a FALSE PREMISE — llm-exchange
> carries raw prompts for byte-exact golden replay and is deliberately not ledger data; out of scope.
> **Next program step: Wave D (4c Projector) ∥ Wave E (5a Assessment)** per §4.
> **Cross-cutting cascade SHIPPED 2026-07-23** (Tasks 1–10, `6813d973`..`c5d225cd`): `RunEnvelope`
> is the one run-wide carrier for the seven cross-cutting fields; C3 terminal judgment is live at
> the mint (opt-in enforcement only — `fabricationGuard:"block"` etc. must be explicitly requested);
> `scripts/check-cross-cutting.sh` gates it in CI. `plan-execute`/`code-action` per-iteration repair
> gap remains OPEN (see DEBT-REGISTER §3); the `runLedger`-on-the-live-engine-path drop is **CLOSED**
> (Wave C.2 slice 3b, 2026-07-25).

### Pre-release board (historical, 2026-07-12)

| Item | State |
|---|---|
| K: Phases 1–3 + 3.6 (gateway, tool surface, terminal gate, H1–H6) | ✅ shipped, live-verified |
| K: Waves A–G + Phase 7 | ✅ ALL SHIPPED 2026-07-08 (`36f66dee`, `6db0bf71`, `c7a836da`, `14351866`, `5c5fb778`, `a33409d5`, `99527ed8`, `66c5d1b3`); G ablation INCONCLUSIVE → adaptive stays opt-in (re-cut = task #36) |
| K: wiring residue | ◐ tracked in root-cause closure program Tiers 1–3 + 2026-07-12 state audit (adapter hooks orphaned, CompletionEnvelope coverage, ledger dead kinds, subagent boundary) |
| P: Arc 1 | ✅ merged (`3c9c15fa`), launch-gate items 1–4 done; **item 5 (published bench receipts) OPEN** |
| P: Arc 2–4 | specified in 08, sequenced by §4; Arc 2 code untouched |
| T: bench validity (rw-7/rw-4/rw-8) | ✅ `a9727e8c`; instrument rebuilt graded/deterministic (`51e6182e`, `031e5d26`, `170d9926`); canonical baseline `fc1713b2` |
| T: v0.14 + bench receipts + Show-HN | ⚠️ **OVERDUE** — Wave A/B boundary passed 2026-07-08; v0.14 uncut; main ~226 commits unpushed |
| Sweep debt closed | traceability matrix total: every 07-07 + 07-08 audit finding → shipped ✅ / task ID / named deferral |
| Current empirical state | `wiki/Research/Audit-Reports-2026-07-12/00-STATE-OF-THE-FRAMEWORK.md` |
