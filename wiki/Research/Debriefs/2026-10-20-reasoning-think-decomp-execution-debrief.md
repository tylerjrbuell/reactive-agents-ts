---
type: debrief
status: shipped
created: 2026-10-20
tags: [reasoning, kernel, decomposition, think, execute-backlog, warden]
---

# Debrief — reasoning-think-decomp (GH #219 / HS-249)

**Bundle:** `execute-backlog` singleton pass on #219 (third-largest oversized file).
**Merged:** PR #258 → `dev`, merge `6330bb92d` (2026-10-20), CI 5/5 green. Third decomposition shipped this window (#217 reactive-agent.ts → 2,338; #218 builder.ts → 2,222; #219 think.ts → 676).

## What shipped

`packages/reasoning/src/kernel/capabilities/reason/think.ts`: **2,445 → 676 LOC (−1,769)**. Issue cited 2,135 at sweep time; regrew +310 in the recovery window like the others.

Different shape from #217/#218: this is not a class — it is ~330 LOC of exported helpers plus **one ~2,100-LOC `handleThinking` function**. The decomposition shape was a stage orchestrator:

- `handleThinking` keeps its **exact kernel phase-signature contract** `(state, context) => Effect<KernelState, never, LLMService>` and drives 6 named stages: resolve-surface → prepare-gateway-call → (inline request core) → consume-stream/normalize-response → dispatch-response → evaluate-termination.
- Verbatim stage modules (all in `capabilities/reason/`): `resolve-think-surface.ts` (254), `prepare-think-gateway-call.ts` (223), `dispatch-think-response.ts` (800, owns shared `ThinkTurnParams`), `consume-think-stream.ts` (198), `normalize-think-response.ts` (340), `evaluate-think-termination.ts` (202), plus byte-identical helper modules `context-pressure.ts` (27), `final-answer-heuristics.ts` (52), `tool-index-disclosure.ts` (109), `build-think-provider-request.ts` (67).
- The **canonical provider-request core stays inline** in think.ts — forced, correctly, by three kernel enforcement scripts that pin specific lines (`scripts/check-projection.sh` toLLMMessages grandfathering, `check-domain-only-fc.sh` wireToolSchemas / `mode === "native-fc"` pins, `check-volatile-placement.sh` messagesForRequest pin). A truthful comment also carries the `think-system-prompt.test.ts` structural pins.
- think.ts had **zero importers outside `kernel/capabilities/reason/`** (parent-verified pre-brief) — all moves internal; `CONTEXT_PRESSURE_THRESHOLDS` re-export preserved for `auto-checkpoint.ts`.

## Kernel invariants preserved (warden evidence)

Loop streak rule, single termination owner (arbitrator/terminate), two-record rule, no verifier double-rejection, runner.ts untouched, zero new phases/guards/meta-tools. Wrap convention preserved: only stage-level terminal returns wrap `{ state, handled: true }`; nested-lambda returns never wrap.

## Verification (parent, all deterministic)

- tsc rc=0 (one iteration: a module-scope `state` shadow produced a TDZ/implicit-any cascade; warden fixed by keeping the mutable param as the orig-equivalent binding).
- Reasoning suite: **3,163 pass / 4 todo / 0 fail / 366 files = exact baseline**.
- Cast-ceiling 2/2; think.ts + all 10 modules carry **0** `as unknown as`/`as any` (7 nearby hits are a pre-existing untouched test-mock file — pattern-sanctioned mocks).
- All 4 kernel enforcement scripts PASS (projection / domain-only-fc / volatile-placement / llm-gateway).
- Scope: 1 modified + 10 new files, all under `capabilities/reason/`.

## Lessons

1. **Enforcement-script pins constrain decomp seams (new, skill-amended).** Before writing a decomposition MissionBrief, grep `scripts/check-*.sh` for the target file and name the pins in the brief — or hold; the warden otherwise discovers them mid-flight or risks violating them. Here the request core stays inline because three scripts grandfather its lines; a "move everything" brief would have been rejected by CI gates.
2. **Single-function monoliths decompose as stage pipelines**, not as method facades. Name the stages after the file's own `──` phase-comment markers; keep the orchestrator's public signature byte-stable.
3. Regrowth counting is load-bearing: 2,135 → 2,445 in the scan justified the bigger LOC cap conversation and again confirmed new work must go in submodules (refusal-class: re-monolithing).

## Process

kernel-warden via general subagent (standing deviation; harness has no warden types), confidence 0.95, retries 0/2. No changeset (no API/type/behavior change).

## Next

Remaining decomp seeds are now p2: #221 execution-engine.ts (1,807), #220 arbitrator.ts (1,908, 31 exports), #222 iterate-pass.ts + runner.ts. All kernel-warden or runtime-warden territory.
