---
type: harness-report
status: F1/F2/F3 shipped, verified via code-review; re-run pending
created: 2026-07-02
session: public-competitor-cogito-8b (clean dataset, post-78bd31ac, OpenAI judge)
tags: [harness-improvement-loop, root-cause, verifier, grounding, abstention, cogito-8b]
---

# Root cause: RA Full weaknesses on cogito:8b (public competitor bench)

**Dataset:** `public-competitor-cogito-8b-final.json` — 90 cells, 0 timeouts, 0 judge errors, 0 inconclusive. RA Full: accuracy 29% (best of 6 variants) but reliability 59% (worst), honesty 0/15 verified successes (7 `dishonest-success-suspected`, 5 `claimed-success (unverified)`, 3 `honest-failure`), tokens 7,319 mean vs 708 bare-llm (~10×).

## The dominant failure sequence (evidenced in 7–12 of 15 ra-full runs)

1. Small model calls a wrong tool 1–4 times — hallucinated name (`database_info`, `json_formatter`, `search_engine/query` — rw-1, traces `01KWHZ0423…`, `01KWHZ10ND…`) or malformed args (`file-write` missing `path` ×4 — rw-8, trace `01KWHZM0Y2…`; the qwen twin of this trace shows the model nesting args under an `input` key).
2. Failures come back as observations; the model **gives up on tools and emits a final answer at iteration 1–2** — a parametric guess (rw-1), a plan-narration ("First, let's check using `brief()`… Next, I'll search: `find('test')`…" — rw-7 run0, trace `01KWHZCQG2…`, ONE llm exchange, ZERO tool calls), or a placeholder template.
3. **Recovery steering never fires** — `buildRecoverySteeringGuidance` exists and works (observed firing in a qwen rw-9 trace) but is only invoked when a stall guard or loop detector trips (`recovery-steering.ts:5-8`). An early `end_turn` reaches neither. Zero `harness-signal-injected` events in the failing traces.
4. **Forced abstention never fires** — its "repeated ungrounded synthesis ≥2" trigger is unreachable when the FIRST ungrounded synthesis terminates the run.
5. **Verifier terminal checks all pass** (rw-7 run0 verdict: "final-answer: 8 checks passed"):
   - `action-success` checks only the final-answer call's own success flag (`verifier.ts:288-299`), not whether the agent ever took substantive action;
   - `output-not-continuation-intent` is last-line-only by design (`verifier.ts:526-543`) — a multi-paragraph narration of *intended* tool calls passes;
   - there is **no grounding check** at the terminal gate.
6. Run ships `status=success`. The post-hoc `RunDiagnosis` then correctly labels it `dishonest-success-suspected` ("claimed success but no substantive tool call succeeded").

## Root cause, one sentence

**The harness can already detect an ungrounded success claim — but only at diagnosis time; every runtime enforcement mechanism (recovery steering, forced abstention, verifier) is keyed to conditions that an early ungrounded `end_turn` never reaches.**

The reliability-59% weakness is the same defect seen from another angle: ungrounded parametric answers are coin-flips, so accuracy varies 0/1/1 (rw-1) and 1/1/0 (rw-9) across identical runs. The 10× token tax is partly inflated by the wasted failed-tool iterations that precede the give-up.

## Structural fixes (ranked)

### F1 — Grounded-terminal invariant (eliminates the class)
At the terminal gate: if the task requires tools AND `buildSuccessfulToolCallCounts(state.steps)` has zero substantive (non-meta) successes AND the candidate answer is not an abstention → **reject the `end_turn` once**, inject the existing `buildRecoverySteeringGuidance` nudge (the tool-error strings already name the correct tools), and continue; on the **second** ungrounded attempt → forced abstention (`terminatedBy: "abstained"`). This makes the existing ≥2 threshold reachable instead of vacuous, reuses two mechanisms that already exist, and converts dishonest successes into either real tool engagement or honest abstention.
**Expected after-trace:** failing rw-1/rw-7 cells show ≥1 `harness-signal-injected` (grounding redirect) + either successful tool calls before the final answer or `terminatedBy:"abstained"`; `dishonest-success-suspected` rate drops toward 0; reliability rises (fewer coin-flip parametric answers); rw-1-style "wins" may drop too — they were unearned.

### F2 — Argument-shape repair in the healing pipeline (kills the rw-8 loop)
`healParamNames` doesn't handle the observed shape: args nested under a wrapper key (`input`) / a missing single required param with unknown keys present. Deterministic, high-precision repair: if an unknown param (`input`/`args`/`params`/`arguments`) holds an object whose keys match the schema → unwrap it; if exactly one required param is missing and exactly one unknown same-type param is present → remap. Four identical `Missing required parameter "path"` failures become one healed call.

### F3 — Escalate repeated identical tool failures without waiting for stall/loop guards
Threshold: same tool + same error class ≥2 consecutive failures → inject recovery steering immediately (currently only stall/loop-gated). Cheap, reuses `getToolFailureRecovery` unchanged.

### Non-goals (hold the line)
- Don't loosen the judge or re-weight dimensions to make numbers look better.
- Don't special-case bench tasks; all three fixes are production-path behavior.
- Token multiplier gets published honestly as its own receipt; F1–F3 reduce it as a side effect (fewer wasted iterations), not by trimming visible tool schemas.

## Verification plan (after qwen3:14b bench frees the GPU)
1. TDD the three fixes (verifier/kernel + healing pipeline unit tests).
2. Re-run `public-competitor-smoke`, then full cogito:8b session; `rax:diagnose diff` a before/after failing cell.
3. `rax eval gate --baseline bare-llm --candidate ra-full --ledger wiki/Research/Harness-Reports/improvement-ledger.json --weakness "ungrounded terminal success" --hypothesis "grounded-terminal invariant"`.

Traces referenced live in `packages/benchmarks/benchmark-traces/`. Related: [[2026-07-02 file-root sandbox escape]] (`78bd31ac`) found in the same bench thread.

## Implementation status (2026-07-02)

**Shipped:** F2 (arg-shape healing, `3fd8a0b3`), F1+F3 (grounded-terminal invariant + repeated-failure escalation, kernel-warden, 2 dispatches — first hit session limit mid-integration, second finished it and fixed 3 real integration bugs the first left: pseudo-observation poisoning masking the invariant, gate-unreachable-on-real-path due to guard interception order, PostCondition-spine collision). `bunx tsc --noEmit` clean, `bun test` 1884/0 (baseline 1866 + 18 new), independently re-verified.

**Code-review findings (high-effort, 8-angle sweep + verify):**
- One correctness hypothesis (F1's runner.ts §7.5 boost double-counting a legitimate `final_answer_tool` graceful-failure exit) was **REFUTED** by rigorous trace — the PostCondition gate intercepts before §7.5 ever sees it.
- That verify pass surfaced a **real, pre-existing gap**: the PostCondition gate has no graceful-failure carve-out, so for any task with declared `requiredTools`, an ungrounded `final_answer_tool` exit gets steered into an *uncapped* `post-condition-steer` loop instead of being honored as a deliberate exit — contradicting what the Lever-8 exemption comment in `applyGroundedTerminalGate` implied. **Fixed the comment** to state this accurately (arbitrator.ts, `applyGroundedTerminalGate`); the underlying PostCondition-gate carve-out itself is **not fixed** — separate scope, tracked here as a follow-up.
- 4 cleanup/altitude findings, not blocking, tracked as follow-ups below.

**Follow-ups (not blocking this bench re-run):**
1. **PostCondition steer has no graceful-failure carve-out** — a task with `requiredTools` whose model deliberately reports honest failure via `final_answer_tool` gets steered/looped rather than accepted, for any task where it hasn't yet met `ToolCalled(requiredTools)`. Candidate fix: extend the PostCondition gate itself to recognize a genuinely-honest `final_answer_tool` failure report and let it through, or route it to forced-abstention directly instead of an uncapped steer.
2. `HARNESS_PSEUDO_TOOLS` (`kernel-constants.ts`) is a hand-curated, point-in-time string list, not derived from the step shape — will silently drift if a new pseudo-tool observation type is added elsewhere without updating this set. Consider making pseudo-tool-ness a boolean on `observationResult` instead.
3. `guardCompletionGaps`/`guardQualityCheck` (think-guards.ts) duplicate the same F1-defer predicate verbatim — extract to one exported function in `grounded-terminal.ts`.
4. `runner.ts`'s "second ungrounded terminal" check is inlined rather than living in `grounded-terminal.ts`, contradicting that file's own stated "cannot drift" purpose.
5. F3's repeated-failure scan (`iterate-pass.ts`) runs unconditionally every iteration even for tasks with no `requiredTools`, unlike its sibling F1 guards which all gate on that check first — cheap fix, add the same gate.

**Next:** re-run `public-competitor-smoke` → full cogito:8b → full qwen3:14b, compare against today's baseline datasets (`public-competitor-cogito-8b-final.json`, `public-competitor-qwen3-14b-final2.json`), publish honest before/after.
