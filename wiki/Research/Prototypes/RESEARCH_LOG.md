# Research Log — Spike-driven harness validation

> Per `docs/spec/docs/00-RESEARCH-DISCIPLINE.md` Rule 5: every spike gets
> ONE PARAGRAPH here, regardless of outcome. This log is the running record
> of what's been tried, what worked, what didn't, what to never propose again.

---

## p00-bare-vs-harness — 2026-04-27 — `cogito:8b × rw-2 × 5 runs`

**Question:** Does the harness produce qualitatively different output than a
bare-LLM ReAct loop on the same task? **Outcome:** Yes — but in an unexpected
direction. Bare LLM fabricated 5/5 runs (never called the tool, made up
"payment processing issue" + wrong dollar amount). Harness fabricated 0/3 runs:
2/3 honest-failed (`""`), 1/3 grabbed the red herring but stayed grounded in
real data. **Re-frames harness value proposition: it's a fabrication firewall,
not a problem-solving booster.** Token cost is 100× higher (256 vs ~25,300) —
the price of trust. Bench's score-based "lift" metric DOESN'T capture this win
because empty output and confident lie both score 0. **Next spike priorities:**
p01 (bare + verification gate to test if a single mechanism captures most of
harness's anti-fabrication value), p02 (bare + required-tool prompt nudge),
p03 (validate fabrication failure mode across providers — is this cogito-only or universal?).

**Artifacts:** [`p00-bare-vs-harness.ts`](./p00-bare-vs-harness.ts), [`RESULTS-p00.md`](./RESULTS-p00.md), `harness-reports/spike-results/p00-bare-rw2.json`

---

## p00v2-competent-bare-vs-harness — 2026-04-27 — `qwen3:4b × rw-2 × 5 runs`

**Question:** Why wouldn't someone hand-roll their own agent? Does a competent
80-LOC bare-LLM ReAct loop match the harness on rw-2? **Outcome:** Bare loop is
COMPETENT but SHALLOW. With proper config (native FC, `think:false`, decent
prompt), bare qwen3:4b deterministically calls the tool, computes, and ships
an answer in 4s / 3.2K tokens. **But it grabs the red herring (15% discount)
5/5 times** instead of identifying the TV out-of-stock as the cause. Harness
on cogito:8b: 1/3 grabs same red herring, 2/3 honest-fails (empty output) —
the "honest fail" mode is the actual differentiator. Cost: harness 7.8× more
tokens, 5× slower. **Re-frames competitive answer:** harness's defensible
value is TRUST (refuses confident-wrong), not capability boost. The bare loop
fails confidently; harness fails honestly. Important infra finding: harness
auto-enables qwen3 thinking-mode → empty content output → bench-data for
qwen3:4b harness is unreliable until re-run with thinking disabled. **Next
spike (p01):** bare-LLM + minimal ~30-LOC verification gate — does this single
mechanism deliver the trust gain, or is the gain distributed across many
harness mechanisms?

**Artifacts:** [`p00v2-competent-bare-vs-harness.ts`](./p00v2-competent-bare-vs-harness.ts), [`RESULTS-p00v2.md`](./RESULTS-p00v2.md), `harness-reports/spike-results/p00v2-bare-rw2-qwen3-4b.json`

---

## p01 + p01b — bare-LLM + 30-LOC verification gate — 2026-04-27 — `(qwen3:4b + cogito:8b) × rw-2 × 5+5 runs`

**Question:** Does a single ~30-LOC verification gate (check: tool called?
answer references observations?) capture most of the harness's anti-
fabrication value? **Outcome:** SPLIT — gate is mechanism-correct,
**model-specific.** On qwen3:4b (which calls tool + grounds answer): gate
PASSES 5/5, ships same red herring as bare. KILL — gate doesn't catch
shallow-reasoning failures. On cogito:8b (which fabricates without FC):
gate FAILS 5/5 (`agent-took-no-action`), converting **5/5 dangerous
confident-fabrication into 5/5 honest-fail**. PROMOTE — gate IS the
fabrication firewall at <1.5% the harness's token cost (325 tok vs 25,300+
tok for the full harness). **Decision-grade finding:** the harness's main
trust differentiator is implementable in 30 LOC of pure code — most other
harness mechanisms need to spike-validate against this baseline or face
deletion. Different mechanism class needed for shallow-reasoning failures
(multi-hypothesis enumeration? critique loop?). **Next spike (p02):** does
retry-on-rejection (verifier-driven retry like commit `45960be6`) convert
cogito's 5/5 honest-fail into ≥1/5 grounded answer? Or is cogito's FC
failure unsolvable by harness feedback (model-level limitation)?

**Artifacts:** [`p01-bare-with-verification.ts`](./p01-bare-with-verification.ts), [`p01b-bare-with-verification-cogito.ts`](./p01b-bare-with-verification-cogito.ts), [`RESULTS-p01.md`](./RESULTS-p01.md), `harness-reports/spike-results/p01-bare-verify-rw2-qwen3-4b.json`, `harness-reports/spike-results/p01b-bare-verify-rw2-cogito-8b.json`

---

## p02 — bare + gate + retry-on-rejection — 2026-04-27 — `cogito:8b × rw-2 × 5 runs (max 2 retries)`

**Question:** Does retry-on-rejection convert cogito's 5/5 honest-fail
(p01b) into ≥1/5 grounded answer? **Outcome:** KILL — 0/5 recover. Cogito
ignored retry feedback every attempt; consumed 4.2× tokens (1,072 vs 325
baseline) for zero recovery. Cogito interprets the prompt as "look at an
attached file" rather than "call the read_csv tool" — model-level FC
failure not solvable by harness feedback. **Empirically validates that
verifier-driven retry (commit 45960be6) is tier-specific, not universal**
— and the override hook (`VerifierRetryPolicy`, commit 14135d6d) is the
correct control surface for developers to suppress retry on known-non-
recovering models. **Subtle positive surprise:** p02's stricter system
prompt eliminated cogito's fabrication (vs p00's gentle prompt where it
made up "$12,500 / payment processing"). Now it honest-fails at the model
level ("I don't see the attached file") without needing the verification
gate. **Suggests prompt strictness alone may match the verification gate's
anti-fabrication value at zero overhead.** Next spike (p03): ablation of
prompt-strictness alone vs gate alone vs both — does the harness's trust
value reduce further to ~5 lines of system prompt?

**Artifacts:** [`p02-bare-with-verify-retry-cogito.ts`](./p02-bare-with-verify-retry-cogito.ts), [`RESULTS-p02.md`](./RESULTS-p02.md), `harness-reports/spike-results/p02-bare-verify-retry-rw2-cogito-8b.json`

---

## Methodology calibration — 2026-04-27 (post-p02)

User correction: spikes were treated as if they could justify harness-level
deletion claims. They can't. A spike validates ONE mechanism × ONE failure
mode × ONE-or-two models × ONE task — it does NOT survey the harness's
full failure-mode surface. Overclaims like "30 LOC captures 98% of harness
trust value" need walking back to "30 LOC catches no-tool fabrication on
cogito × rw-2." The harness's complexity exists for reasons spikes haven't
touched yet (multi-turn, MCP, sub-agents, memory persistence, context
overflow, etc.).

**Discipline contract updated:**
- Rule 11 added: scope-of-claims ("spikes are evidence, not verdicts")
- Rule 12 added: failure-mode-first investigation cycle (DISCOVERY →
  DIAGNOSIS → DISSECTION → EVIDENCE → PROMOTION)

**New foundational artifacts:**
- `docs/spec/docs/01-FAILURE-MODES.md` — failure-mode catalog (14 seed
  entries, categorized A-H, prioritized by frequency × severity ×
  controllability)
- `docs/spec/docs/02-IMPROVEMENT-PIPELINE.md` — operational rhythm
  doc: how DISCOVERY feeds CATALOG feeds PRIORITIZATION feeds DISSECTION
  feeds DESIGN feeds INTEGRATE+VALIDATE feeds DEPRECATE → loop

**Reframing per-spike question:**
- Old: "Can mechanism X replace harness?"
- New: "How does mechanism Y address failure mode X — on which models, at
  what cost, with what scope?"

**Active spike queue (per failure-mode catalog priority):**
1. FM-C1 (shallow reasoning over real data) — UNMITIGATED, high impact
2. FM-D1 (premature termination) — claimed-mitigated, needs validation
3. FM-F1 (context overflow / dual compression) — known issue, mechanism
   selection unclear

**RESULTS-p01.md / RESULTS-p02.md need follow-up calibration edit** —
language to be updated from "captures X% of harness value" to
"addresses failure mode F-X on model M for task T."

---

## Calibration completed — 2026-04-27 (same session)

`RESULTS-p01.md` and `RESULTS-p02.md` updated per Rule 11. Overclaim
language ("captures 98% of harness trust value", "harness is mostly dead
weight") replaced with scope-bounded claims ("addresses failure mode
FM-A1 on cogito:8b × rw-2"). The "minimum kernel sketch" framed as
convergence target subject to broader failure-mode evidence, not a
finished claim. Spikes now read as evidence-contributing, not verdict-
producing — consistent with Rule 11.

Also created `PROJECT-STATE.md` as the single landing doc for any new
session (human or AI). Synthesizes empirical state, methodology, what's
validated, what's stale, what's next. Pointed to from north star.

---

## p03 — harness × qwen3:4b × rw-2 (probe-gate for wiring-gap fix) — 2026-04-28

**Question:** Does the harness on qwen3:4b auto-enable thinking-mode and
produce empty `message.content`, degrading rw-2 output? **Pre-registered
hypothesis (gap):** `resolveThinking(undefined)` in
`packages/llm-provider/src/providers/local.ts:226-251` returns `true` for
any thinking-capable model when the caller doesn't specify, so the harness
silently turns thinking on for qwen3 and the harness then sees empty
content (thinking mode routes content into `message.thinking` not
`message.content`). PROMOTE: 2/3 runs show `output.length > 0` after
fixing the auto-enable. KILL: empty-output failure not reproduced.

**Outcome:** **HYPOTHESIS FALSIFIED** — and the probe revealed something
worse and more interesting. All 3 runs produced non-empty output (123,
123, 305 chars) — not the empty-content failure mode. But the outputs
were **harness-internal control strings leaking as the agent's final
answer**:
- runs 0/1: `"⚠️ Recovery required: prior tool path failed (file-read).
  Try an alternate path now: web-search. Do not finalize yet. (1/2)"` —
  the LLM parroted a `harness_signal` step (runner.ts:904) back as a
  thought; the thought reached `state.output` via §8.7 consolidation
  (runner.ts:1502-1509); the verifier's `agent-took-action` check passed
  because `toolsUsed` includes the failed `file-read` call.
- run 2: `"Loop detected: 3 consecutive thinking steps with no tool
  calls.\nFix: ..."` — runner.ts:1270 fallback
  `output: lastThought?.content ?? loopMsg` directly leaks the
  loop-detector diagnostic when no thought step exists.

This is a **decision-grade outcome from a probe-gate**: the empty-content
fix would have shipped a wrong patch. The probe caught it before commit,
exactly as Rule 7 (single-mechanism isolation) and the "real integration
proof before we commit" directive intend. Two distinct leak paths
catalogued: parrot-via-consolidation (FM new — propose FM-A3
"harness-signal output leak") and direct-loop-fallback. Per advisor's
post-investigation read: these are **two enforcement points of one
principle** ("harness internals never reach `result.output`" — see
`types/step.ts:isUserVisibleStep`), and probe evidence shows the
verifier check alone is insufficient because verifier-rejection on this
model retries until the loop-detector fires, then the loop_graceful
fallback re-leaks. Bundle both fixes; document each enforcement point's
contribution against the same probe data. Also documented separately:
`agent.subscribe()` does not expose `LLMRequestCompleted` /
`LLMExchangeEmitted` events to external subscribers despite token
metadata being recorded — telemetry surface gap, deferred to its own
spike.

**Fix shipped — POST-FIX results (probe re-run, same 3-run config):**
- Two enforcement points of one principle ("harness internals never reach
  `result.output`"):
  1. `output-not-harness-parrot` check added to `defaultVerifier` —
     rejects terminal output that begins with the `⚠️ ` harness signal
     prefix OR matches a recent `harness_signal` step content (look back
     ≤10 steps). Conservative two-matcher design; `examples/test cases`
     in 5 new unit tests (`verifier.test.ts`, 24→29 tests, 29 pass).
  2. `lastThought` fallback paths in `runner.ts` (oracle-forced exit at
     line 1003; loop_graceful exit at line 1267-1273): when no real
     thought content is available, set `status: "failed"` with a
     structured `error` instead of substituting the harness's loop
     diagnostic / "Task complete." literal as user-visible output. The
     `transitionState` invariant nulls `output` on failure.
- Empirical: 3/3 runs now return `outputLength=0`, `success=false`,
  structured `error` populated. No more harness-internals in the
  user-visible answer. Saved at
  `harness-reports/spike-results/p03-harness-qwen3-POST-FIX.json`.
- A residual UX issue surfaced: when verifier rejects, the kernel's
  specific reason (e.g. "Verifier rejected output: failed at
  synthesis-grounded") is in `state.error` but the runtime's
  `AgentResult.error` falls back to the generic `"Reasoning failed"` for
  the user. Different mechanism (runtime → AgentResult error
  forwarding); deferred to its own iteration.

**Methodology footgun caught (and added as feedback memory):** the FIRST
post-fix probes (POST-VERIFIER-PARROT-CHECK, POST-BOTH-FIXES) ran
against STALE `packages/reasoning/dist/index.js` and so reflected
PRE-FIX behavior despite the source edits. `packages/*` declare
`"main": "./dist/index.js"`; runtime imports go through dist. Rule of
thumb saved: after editing `packages/*/src/`, run `bun run
build:packages` (≈15s with turbo cache) before re-probing. Detection
quick-check: `grep -c "<NEW-IDENTIFIER>" packages/<pkg>/dist/index.js`.

**Artifacts:**
- [`p03-harness-qwen3-thinking-bug.ts`](./p03-harness-qwen3-thinking-bug.ts)
- `harness-reports/spike-results/p03-harness-qwen3-PRE-FIX.json` (pre-edit baseline; 3/3 leak harness internals)
- `harness-reports/spike-results/p03-harness-qwen3-POST-FIX.json` (post-edit, post-rebuild; 3/3 clean empty output + structured failure)
