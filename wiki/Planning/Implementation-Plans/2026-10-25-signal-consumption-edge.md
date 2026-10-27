---
type: plan
status: partial
created: 2026-10-25
tags: [harness, tracing, signal-gap, introspective-loop]
plan: signal-consumption-edge
---

# Signal Consumption Edge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the signal loop at the root — every harness signal (steer, verdict, redirect, guard) gets a stable id, a typed reachability record (did it enter the model's prompt), and a deterministic effect classification on the following action (remediated / ignored / contradicted), aggregated on `run-completed` and consumed by RI learning + `rax diagnose` + the introspective probe.

**Architecture:** Three additive trace event kinds riding the existing recorder (`HarnessSignalInjected` gains `signalId`/`target`; new `SignalRendered` and `SignalEffect`), one pure kernel-state ledger holding open signals, one pure classifier module for effect tagging, and read-only consumers (RI projection counters, diagnose detector mode, probe cross-check alignment). Zero decision-behavior changes — this is telemetry, not control flow.

**Tech Stack:** Effect-TS (packages/reasoning kernel, packages/trace schema), Bun test, existing EventBus → recorder mirroring.

**Spec:** This plan. Evidence base: `wiki/Research/Harness-Reports/introspective-2026-10-24-02-*` (I4 = 6 blind spots × runs, I5 = steering misused, I7 extractor miss) and the schema audit of `packages/trace/src/events.ts` (zero `signalId`/consumption fields in the union). Queue authority: `wiki/Planning/Recommended-Enhancements.md` §2026-10-23 sweep (Sprint B + new item "signal consumption edge").

## Global Constraints

- **Additive-only schema evolution.** New event kinds + optional fields on existing kinds. No field removals, no changed meanings. Historical JSONL without the new fields must load (readers treat missing as "pre-instrumentation"; `analyze.ts`/`replay.ts` defaults must not throw).
- **No behavior change.** Every steer/verdict/guard decision path emits exactly as before. No classifier result may feed back into cloud/kernel termination logic in this plan (consumers are read-only). The ONLY new writes are ledger-side: ids, render stamps, effect tags.
- **Deterministic over LLM-driven (golden rule 5).** The effect classifier is a pure function of (signal target, post-render steps). No LLM call anywhere in the chain.
- **Control and observability over magic (golden rule 4).** Id generation is a state counter, not a hidden global; every stage emits through the existing `emitHarnessSignalInjected`/trace recorder patterns; every emit site is EventBus-absent-safe (`serviceOption._tag !== "Some"` no-op).
- **Diagnostic-chatter budget:** the "budget that prices EVERY instrumentation point" applies — signals that never affect outcome must not spam. Cap: one `SignalRendered` per (signal, run) — dedupe at ledger level. No `SignalEffect` without a rendered or terminally-closed signal.
- **Team-ownership routing in execution:** `packages/trace/**` + `packages/reasoning/src/kernel/**` → kernel-warden; `packages/reactive-intelligence/**` + `packages/diagnose/**` are follow-up consumption tasks (may be parent-or-warden later).
- **File-size ratchet.** `kernel/loop/runner.ts`, `iterate-pass.ts`, `think.ts` have pinned ceilings. New logic goes in NEW modules (`signal-ledger.ts`, `signal-effect.ts`); existing files net-out within ±15 LOC of their ledger values or the ledger gets an attributed entry per the established convention.
- Type safety: precise types, Schema-struct fields via existing patterns (see KernelState/state.ts); no `any`, JSDoc on every public export.

## Review Focus

1. **Unrendered-but-open signal at run end** (guard fires on the final iteration; no following act) — `SignalEffect` must NOT be emitted; `run-completed` tally marks it `unobserved`. Test pins this.
2. **Multiple pending signals** (errorRecovery + actReminder + oracleGuidance composed same pass) — ids are per-signal, render stamp per id, effect classification against each open signal independently; no latest-wins silent overwrite. Pin: `signal-ledger.test.ts` two-signal case.
3. **The I5-style wrong remedy** ("try file-read" on a policy-blocked tool) — classifier must report `ignored`/`contradicted` when the model obeys steer text but the steer itself was wrong (model called the *named* alternate → that's `remediated` per contract; the policy-arm steer case (I5 fix) names no alternate: remediated = same-tool-args-changed). Class semantics must match the policy-block contract from 2b46fe96a/d05c1c127 — pin in `signal-effect.test.ts`.
4. **Reproducibility vs 2026-10-24 trace files.** `loadRecordedRun` + `diffTraces`/`analyze.ts` over a recorded pre-instrumentation run (real trace file in `wiki/Research/Harness-Reports/` or fixtures under packages/trace/tests/fixtures) must not throw. Test in Task 1.
5. **Buried scaffolding** — a signal id stamped but the model's guidance section never literally contains the remedy text (think.ts composition branches around empty fields). Reachability stamp requires the composed GuidanceContext slice to be non-empty, not merely "we tried to render". Pin in Task 5.

---

## File Structure

**Modify:**
- `packages/trace/src/events.ts` — `HarnessSignalInjectedEvent` gains `signalId`, `targetTool?: string`, `targetPolicy?`; new `SignalRenderedEvent`, `SignalEffectEvent`; `RunCompletedEvent` gains optional `signals` tally.
- `packages/trace/src/normalize.ts` — new-kind entries in the field maps (e.g. `"signal-rendered": ["signalId", ...]`), payload-key normalization so tool/exchange tables stay stable.
- `packages/reasoning/src/kernel/state/kernel-state.ts` — `PendingGuidance` gains parallel `pendingSignals?: readonly PendingSignalRef[]`; `KernelState` gains `signalLedger?: SignalLedgerEntry[]` + counter `nextSignalSeq?`.
- `packages/reasoning/src/kernel/utils/diagnostics.ts` — `emitHarnessSignalInjected` gains id generation + target params.
- `packages/reasoning/src/kernel/capabilities/reason/think.ts` (~128) — render-time stamps.
- `packages/reasoning/src/kernel/loop/iterate-pass.ts` — effect-classification hook location (existing recovery/signal inflow site, ~596).
- `packages/reactive-intelligence/src/learning/observation-projection.ts` — read-only counters (Task 7).
- `packages/diagnose/src/*` — new finding class detector (Task 8).
- `.agents/skills/harness-improvement-loop/scripts/introspective-probe.ts` — crossCheck switches from message-text heuristics to typed events (Task 8).

**Create:**
- `packages/reasoning/src/kernel/state/signal-ledger.ts` — pure ledger ops.
- `packages/reasoning/src/kernel/loop/runner-helpers/signal-effect.ts` — pure classifier.
- `packages/reasoning/tests/kernel/signal-ledger.test.ts`
- `packages/reasoning/tests/kernel/signal-effect.test.ts`
- `packages/trace/tests/events-signal-events.test.ts`
- `packages/reactive-intelligence/tests/signal-effect-projection.test.ts`
- `packages/diagnose/tests/signal-gap-detector.test.ts` (or nearest sibling test convention)

---

### Task 1: Trace schema — ids, render, effect, tally

**Files:**
- Modify: `packages/trace/src/events.ts`
- Modify: `packages/trace/src/normalize.ts`
- Test: `packages/trace/tests/events-signal-events.test.ts`

**Interfaces (produces — every later task relies on these exact shapes):**
- `HarnessSignalInjectedEvent` new fields: `signalId: string` (required-on-new-events; reader tolerates absent), `targetTool?: string`, `targetPolicy?: "denied-tool-retry" | "alternate-tool" | "synthesize" | "required-tool" | "other"`.
- `SignalRenderedEvent`: `signalId: string`, `renderedInIter: number`, `renderedSection: "guidance"` (single value today; union stays open).
- `SignalEffectEvent`: `signalId: string`, `response: "remediated" | "ignored" | "contradicted" | "ambiguous"`, `observedTool?: string`, `observedSubject?: string`, `detail?: string`.
- `RunCompletedEvent` optional `signals`: `{ opened: number; rendered: number; remediated: number; ignored: number; contradicted: number; ambiguous: number; unobserved: number }`.
- New TraceEvent union members: `SignalRenderedEvent`, `SignalEffectEvent`.

**Key semantics locked here:** `response` is about the MODEL's observable behavior, not about whether the signal's advice was *good* — a wrong-but-obeyed steer is `remediated`; the steer quality itself stays with I5 semantics.

- [ ] **Step 1:** Write/extend the test: (a) new events construct with the field shapes above and satisfy the TraceEvent union; (b) a pre-instrumentation recorded-run JSONL file (copy the smallest real record from `wiki/Research/Harness-Reports/` into `packages/trace/tests/fixtures/`) loads through the trace's own reader without error — the reverse-direction check ("replay can still diff pre/post") belongs to `packages/replay/tests` and is folded into Task 7's verification battery there; (c) `RunCompletedEvent.signals` optional/absent tolerated.
- [ ] **Step 2:** Run: `bun test packages/trace/tests/events-signal-events.test.ts --timeout 30000` → FAIL (kinds don't exist).
- [ ] **Step 3:** Implement the schema edits above in `events.ts`; add corresponding `normalize.ts` field-map entries following the `"harness-signal-injected": [...]` pattern (line ~534).
- [ ] **Step 4:** Re-run test → PASS. Run `bun test packages/trace --timeout 30000` → 0 new failures.
- [ ] **Step 5:** Commit: `feat(trace): signal consumption edge schema — signalId, SignalRendered, SignalEffect, run-completed tally`.

---

### Task 2: Kernel signal ledger (pure state ops)

**Files:**
- Create: `packages/reasoning/src/kernel/state/signal-ledger.ts`
- Modify: `packages/reasoning/src/kernel/state/kernel-state.ts` (`PendingGuidance` + KernelState fields)
- Test: `packages/reasoning/tests/kernel/signal-ledger.test.ts`

**Interfaces (produces):**
- `type PendingSignalRef = { readonly signalId: string; readonly field: keyof PendingGuidance; readonly target?: { readonly tool?: string; readonly policy?: ... } }` — added as `PendingGuidance.pendingSignals?`.
- `type SignalLedgerEntry = { signalId, signalKind, origin, target?, openedIter, contentSha: string, state: "open" | "rendered" | "closed", renderedIter?, effect? }`.
- `type SignalLedger = SignalLedgerEntry[]` (carried on `KernelState.signalLedger?`).
- Pure ops in `signal-ledger.ts`: `nextSignalId(state) -> { state, id }` (format `sig-i<b64taskIdTrunc>"-<iter>-<n>` — one reasonable implementation: `sig-<iter>-<n>` where n = ledger length + 1, deterministic per run); `openSignal(ledger, {signalKind, origin, target, iter, content}) -> { ledger, signalId }`; `markRendered(ledger, signalId, renderedIter) -> ledger` (idempotent: re-render of an already-rendered signal is a no-op — R-S2 budget); `closeSignal(ledger, id) -> ledger`; `openSignals(ledger) -> SignalLedgerEntry[]`.
- KernelState default value in `kernel-state.ts:1294` region: `signalLedger: []`.

- [ ] **Step 1:** Failing tests: open→render→translate-on-close happy path; two signals open concurrently (ids distinct, no overwrite); `markRendered` idempotent; `nextSignalId` monotonic across openSignal calls; empty-recovery (closeTarget unknown → no throw).
- [ ] **Step 2:** Run: `bun test packages/reasoning/tests/kernel/signal-ledger.test.ts --timeout 30000` → FAIL.
- [ ] **Step 3:** Implement `signal-ledger.ts` + KernelState fields (`PendingGuidance.pendingSignals?`, `signalLedger?`, default).
- [ ] **Step 4:** Re-run → PASS. `bun test packages/reasoning/tests/kernel/signal-ledger.test.ts` + targeted `grep` for existing kernel-state tests → no regressions.
- [ ] **Step 5:** Commit: `feat(reasoning): kernel signal ledger — open/render/close + per-signal pending refs`.

---

### Task 3: Emit-side ids + targets (5 producer sites)

**Files:**
- Modify: `packages/reasoning/src/kernel/utils/diagnostics.ts` (`emitHarnessSignalInjected`, ~788)
- Modify (each small): `packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts` (~609), `packages/reasoning/src/kernel/capabilities/reason/dispatch-think-response.ts` (~134, ~231), `packages/reasoning/src/kernel/capabilities/reason/prepare-think-gateway-call.ts` (~145), `packages/reasoning/src/kernel/capabilities/reflect/strategy-evaluator.ts` (~185), `packages/reasoning/src/kernel/loop/runner-helpers/stall-deliverable.ts` (~256), `packages/reasoning/src/kernel/loop/iterate-pass.ts` (~596)
- Test: fold into `packages/reasoning/tests/kernel/signal-ledger.test.ts`

**Interfaces (consumes Task 2):** `nextSignalId`, `openSignal`. (Produces: producer sites attach the ledger entry id + target to `pendingSignals` refs or the `harness_signal` step metadata.)

**Semantics:** `emitHarnessSignalInjected(args)` signature gains `target?: { tool?; policy? }`; it emits the event with `signalId` and RETURNS `Effect<string>` (the id). Callers that inject guidance into `pendingGuidance` record `pendingSignals` refs side-by-side with the field they set. Sites that already have `state` at hand (all 7) — ledger id flows via state. `arbitrator` redirect site stores the id on the `harness_signal` step metadata (pure function already touches it).

- [ ] **Step 1:** Failing test: `"emitHarnessSignalInjected publishes signalId; caller records pendingSignals ref alongside errorRecovery"` + a variant for iterate-pass redirect path asserting the id reaches the event with signalKind "redirect" and the entry is `"open"` until Task 5 classifies.
- [ ] **Step 2:** Run → FAIL (signature unchanged).
- [ ] **Step 3:** Implement: diagnostics emitter gains id/target + returns id; thread the parity of the 7 sites (state counter + refs); event payload includes both.
- [ ] **Step 4:** Re-run → PASS. Quick scan: all sites are `serviceOption`-safe unchanged.
- [ ] **Step 5:** Commit: `feat(reasoning): harness-signal ids + targets at all 7 emit sites`.

---

### Task 4: Pure effect classifier

**Files:**
- Create: `packages/reasoning/src/kernel/loop/runner-helpers/signal-effect.ts`
- Test: `packages/reasoning/tests/kernel/signal-effect.test.ts`

**Interfaces (consumes Task 2 shapes; produces for Task 5):**
- `classifySignalEffect(target: SignalTarget | { "synthesize" }, postRenderSteps: readonly ReasoningStep[], subjectHint?: string): { response: "remediated" | "ignored" | "contradicted" | "ambiguous"; observedTool?: string; detail?: string }`
- Family rules (deterministic, no LLM):
  - `policy:"denied-tool-retry"` target tool T: next act calls T with args textually ≠ denied payload → **remediated**; identical (tool+args) repeat → **contradicted**; different tool → **ignored**. No act this pass → **ambiguous**.
  - `policy:"alternate-tool"` named tool T': T' called → remediated; other users' tool → ignored; same failed tool again unchanged → contradicted.
  - `policy:"synthesize"` (production-gap / completion-gap): produces a synthesis attempt (think final_answer / deliverable touch on the same topic) → remediated; unrelated act → ignored.
  - `policy:"required-tool"`: pending required tool called → remediated; else ignored.
- Only the FIRST act after render is classified on (one SignalEffect per (signal, pass)); later handling stays out. Ambiguous cases degrade to "ambiguous" rather than guessing.

- [ ] **Step 1:** Failing tests: all four responses for the denied-tool-retry family + one case per other family + "no act → ambiguous".
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the pure function; no imports beyond kernel-state types.
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5:** Commit: `feat(reasoning): deterministic signal-effect classifier`.

---

### Task 5: Render stamps + effect hook (think.ts + iterate-pass.ts)

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/reason/think.ts` (~128 pendingGuidance read)
- Modify: `packages/reasoning/src/kernel/loop/iterate-pass.ts` (classification injection after think+act boundary)
- Test: `packages/reasoning/tests/kernel/signal-ledger.test.ts` (extends) OR `packages/reasoning/tests/kernel/signal-effect.test.ts` (extends)

**Interfaces (consumes Tasks 2–4):** `markRendered`, `closeSignal`, `classifySignalEffect`, `openSignals`.

**Semantics:** In `think.ts`: where `guidance` (from cleared `pendingGuidance`) composes into the assembled prompt context — after `pipeline.transform('nudge.loop-detected', ...)` too — for each `pendingSignals[i]` present in `guidance`'s corresponding field content: `markRendered` + emit a `signal-rendered` event (via one diagnostics helper `emitSignalRendered`). Composed-but-empty field views (Review Focus 5) do NOT stamp; stamp requires the composed string to contain the signal's content marker (the Pacers' verdict clip or the steer's origin-dedicated sentinel — pick the cheap token: the composed text must include the signal's trimmed content hash prefix (8 chars), which the compose sites already know).
- In `iterate-pass.ts`: after the next pass's act completes, for each still-open-or-rendered signal (R-S2 budget): run `classifySignalEffect`; `closeSignal`; emit `signal-effect` (one diagnostics helper `emitSignalEffect`). On-terminal: no effect event; `closeSignal` with `effect = unobserved` marker tabled via state (read at `run-completed`).

- [ ] **Step 1:** Failing test: two-signal guidance composed → both stamped + 2 `signal-rendered` events (dedupe on re-render); post-render act calling target → `signal-effect` emitted `remediated`; final-iteration guard → no effect event and ledger entry closed with effect toward `run-completed` tallies.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement think.ts stamps + iterate-pass classification hook (small, well-demarcated function; net LOC within ±15 of the existing ledger caps or ledger gets an attributed entry per convention).
- [ ] **Step 4:** Re-run → PASS. `bun test packages/reasoning --timeout 120000` — baseline 3,222 pass / 4 todo / 0 fail (report exact drift).
- [ ] **Step 5:** Commit: `feat(reasoning): render-time stamps + post-act effect classification in the kernel loop`.

---

### Task 6: Run-completed aggregation

**Files:**
- Modify: wherever `run-completed` is published for kernel runs (locate the existing publisher by grep `_tag: "RunCompletedEmitted"` in `packages/reasoning/src/kernel/utils/diagnostics.ts` or the runtime recorder; the plan does not pick blindly — grounding search is a step, not a decision)
- Modify: publisher consumes ledger from final kernel state (or an accessor propagated at kernel exit)
- Test: `packages/runtime/tests/runs/signal-tally.test.ts` (or nearest sibling under that domain's test convention)

**Interfaces (produces):** `run-completed.signals` tally per Task 1's shape, built from the ledger at run end: counts of opened / rendered / remediated / ignored / contradicted / ambiguous / unobserved.

- [ ] **Step 1:** Grounding read: locate the exact `run-completed` publisher site + one current field test as the pattern.
- [ ] **Step 2:** Failing test: run with a steer → tally `rendered=1, remediated=1, unobserved=0`; run with an ignored signal → `ignored=1`; pre-final open (no effect) → `unobserved=1`.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implement publisher-side optional field assembly; re-run → PASS + `bun test packages/runtime --timeout 120000` scoped to the touched package family (keep to touched tests/the whole touched package if pre-existing failures unrelated (dispatch-logging) are unchanged).
- [ ] **Step 5:** Commit: `feat(runtime): run-completed signals tally from the kernel signal ledger`.

---

### Task 7: Consumers — RI projection + diagnose detector (read-only)

**Files:**
- Modify: `packages/reactive-intelligence/src/learning/observation-projection.ts` — per-signalKind counters of opened/rendered/remediated/ignored/contradicted into the existing projection shape.
- Modify-ish: `packages/diagnose/src` — add a finding class: "injected signal followed by ignored/contradicted" (one detector function with four response labels, cheap span walk), surfaced via the same interface `rax diagnose` already composes findings from; no new CLI subcommand required unless the existing CLI shape needs a flag named `--signals`.
- Tests: `packages/reactive-intelligence/tests/signal-effect-projection.test.ts`, `packages/diagnose/tests/signal-gap-detector.test.ts`

**Interfaces (consumes Tasks 1+6):** typed events + run-completed tally. No control-behavior coupling.

- [ ] **Step 1:** Failing tests per consumer: projection counter ordering with mixed signals; diagnose finding emits for ignored/contradicted and not for remediated.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement both consumers (read-only transforms).
- [ ] **Step 4:** Re-run → PASS; `bun test packages/reactive-intelligence packages/diagnose --timeout 60000` → 0 new failures.
- [ ] **Step 5:** Commit: `feat(ri,diagnose): largely read-only consumers of signal-effect telemetry`.

---

### Task 8: Probe alignment + docs + changeset

**Files:**
- Modify: `.agents/skills/harness-improvement-loop/scripts/introspective-probe.ts` — crossCheck uses `signal-rendered`/`signal-effect` events (replacing message-text `blindSpot` heuristics where they overlap); blind-spot tally gains a `unrendered` bucket (I4 became directly detectable in-run).
- Modify: `wiki/Planning/Recommended-Enhancements.md` (§2026-10-23 sweep: new entry "signal consumption edge" marked SHIPPED with links), `wiki/Hot.md` top section, `wiki/Log.md` append.
- Create: `.changeset/` standard patch/minor changeset for trace, reasoning, reactive-intelligence, diagnose, runtime.

- [ ] **Step 1:** Probe cross-check: the `signalId` chain replaces message parsing for `blindSpots` categories `verification`, `guidance`, `blocklist` (message parsing remains as a grated fallback when the recorded run predates instrumentation).
- [ ] **Step 2:** Run one cheap probe task against a local model (reuse existing `f-blocked-rm` suite identity) and confirm the cross-check consumes the new events end-to-end (probe-generated trace shows rendered/effect chain). Do not gate on outcome — gate on the chain being readable in the report JSON.
- [ ] **Step 3:** Docs + changeset written per Documentation Workflow rules.
- [ ] **Step 4:** Commit: `docs+skills: signal-consumption-edge records + probe cross-check alignment`.

---

## Out of Scope (explicit non-goals)

- Feeding `SignalEffect` responses back into control flow (e.g., adaptive nudge frequency) — future opt-in mechanism; must pass the ablation lift gate per team-ownership precedent if ever proposed.
- Renaming or reshaping existing event kinds; sequential/manifest changes to `LLMExchangeEvent` beyond the optional nominal fields.
- The I1 sandbox root unification (separate go/no-go).
- Verifier-driven retry (I4's REMEDIATION arm) — this plan only makes I4's EXISTENCE measurable; the retry policy remains Sprint B.

## Execution Notes

- Tasks 1–5 form the critical chain (schema → state → emit → classify → stamp); Task 6 depends on 1+5; Task 7 depends on 1+6; Task 8 depends on 1.
- Subagent-per-task strongly preferred for Tasks 3 and 5 (busy, wide surface); Tasks 1/2/4 may bundle into one dispatch if the mobile runner's context finds that cheaper.
- Every task RED-first per project TDD law; every kernel-scope dispatch routed through kernel-warden with a MissionBrief per standing convention.

## Execution status (2026-10-27)

Tasks 1-6 shipped; Task 7 shipped and now wired (`rax diagnose signals <runId>`, `detectSignalGaps` had no caller before); Task 8 probe alignment partial. Classifier fix: effect classification now reads only steps produced AFTER the render (`renderedStepCount`), and `synthesize` is remediated only by a `final-answer` call (a bare thought used to classify every steer as remediated). Still open: P1 (act-time classification), P3 (stall nudge tracking), P4 (4 observe-only sites), P5 (RI calibration feedback), missing-signal kinds.
