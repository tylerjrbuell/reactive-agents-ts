---
type: report
status: active
created: 2026-11-06
tags: [harness, workstream-h, failure-modes, small-models, tool-choice]
---

# Canonical failure modes behind the harness defects (2026-11-06)

Question (owner): what root failure modes keep producing harness defects, drift and contradicting guards, and what structure prevents them? Method: zero-token spikes over the Workstream H benchmark cohorts (H3 and long-horizon suites, before and after the N1-N7 fixes, cogito:8b and qwen3:4b), then one live probe against local Ollama replaying recorded benchmark-suite turns. Evidence here comes from benchmark runs only.

## Result in one line

The harness no longer contradicts itself. What remains is that it steers the model by prose where it could steer by structure: about a third of small-model mid-run turns end with tools offered and no call, and the framework has no way to force a call on any provider.

## Classes, ranked by evidence

### 1. Steering by prose where structure is available (dominant, open)

- Mid-run turns with tools offered and no tool call: H3 after 65/204 (32%), LH after 57/167 (34%), H3 before 55/173. Only 19 and 18 of them are followed by a calling turn.
- Runs with 2 or more such turns: 8 of 15 failed vs 2 of 10 passed (H3 after); 14 of 24 failed (LH after, no passes).
- The two largest LH failure buckets are this class under a model label: `model:ignored-guidance` (9 runs: guidance "call required file-read / http-get / file-write") and `model:evidence-not-gathered` (6 runs: most listed inputs never read). The harness answers each no-call turn with more prose. In one decisive run the model announced "I'll start by reading clamp.ts" and ended the turn seven times in a row.
- No `tool_choice` exists anywhere in `packages/llm-provider` or `packages/reasoning`.
- Live probe (cogito:8b, local Ollama, 14 recorded no-call turns from the LH research and debug tasks): Ollama `format` set to an `anyOf` of per-tool JSON schemas `{tool, arguments}` returned a valid call with correct required arguments on 13/14 (with a loose `arguments: object` schema: 10/14 valid, 7/14 correct). The calls were the plausible next step (search first, then write the deliverables). Caveat: the probe measures call validity on single turns, not task solves.

Structural fix: one typed request field `toolChoice: "required"` mapped by each provider (Anthropic `any`, OpenAI `required`, Gemini `ANY`, Ollama constrained decoding), and one kernel recovery rule, act-or-answer: a mid-run turn that ends with no call while the exit gate would deny is retried once in forced-call mode, with `final-answer` among the choices when finishing is allowed. This replaces prose nudges rather than adding a guard; the prose producers it makes dead (grounding-required nudge, required-tool quota loop text, unresolved-call redirect) are deleted after the live measurement shows they no longer fire. Default-on only through ablation-warden.

### 2. Offering or answering without consulting run state (fixed this session)

Owner-reported Cortex runs showed two instances: the model spent turn-0 calls on `recall` before anything existed to recall, and a two-capability task loaded only the tool matching the model's one `discover-tools` query. Both are the same defect: the surface offered a tool whose precondition was unmet, and discovery ignored the task the harness already holds.

Fix: one precondition table for meta-tool offers in `tool-surface.ts` (`META_OFFER_PRECONDITIONS`: discover-tools keeps its rule; recall is offered once a tool that can store a result has run; required tools are never hidden), and discover-tools appends up to 4 task-relevant tools from the kernel's single scorer (`taskRelevantToolNames` in `tool-capabilities.ts`).

### 3. Contradicting guidance (closed, now pinnable)

- Directive check (harness-authored text names a run tool after call/use/invoke/run/try): 0 turns in the four cohorts name a tool the same turn does not offer. The detector fires (73 directive turns in before-H3), so the zero is not a blind instrument.
- Withheld turns carrying a tool directive: before-H3 7/7, before-LH 4/5; after-H3 0/1, after-LH 0/9. This is N1, fixed by the merge-by-kind guidance channel and the withheld-turn allowlist.
- Next step: assert this check as an invariant on golden replay, so a new guard that reintroduces a contradiction fails CI instead of a live run.

### 4. Many independent recovery guards (structural root of 1 and of past N-series defects)

After-cohort runs show a dozen distinct guard kinds acting (`exit_gate`, `deliverable_decision`, `loop_resolution`, `stall_deliverable`, `required_tool_quota`, `dispatcher_early_stop`, `ri-early-stop`, grounding redirect, unresolved-call redirect, thinking-runaway redirect, head-truncation, nudges). Each owns its counters and its prose. N5-N7 were defects created by fixes to these guards. Act-or-answer is the first concrete slice of Phase 5's one recovery policy: one decision per stalled turn (force a call, allow an answer, or end), with one counter.

## Live A/B: act-or-answer (2026-11-06, commit `c5e6510c8`)

Built as `.withHarness({ actOrAnswer: true })` / `RA_ACT_OR_ANSWER=1`, default off (`8d337c4ab`, provider `toolChoice` `8859e53fe`). Arms differ only by the env switch; same commit, k=3, cells chosen where no-call stalls concentrated in the after cohorts (cogito:8b `rw-7` and `lh-1`, qwen3:4b `lh-1`). Accuracy is the suite's partial credit; no run fully solved in either arm.

| Cell | Arm | Accuracy (3 runs) | Mean | Tool calls | Fires (call returned) | Tokens (sum) |
|---|---|---|---|---|---|---|
| cogito:8b rw-7 | off | 0.00, 0.00, 0.00 | 0.00 | 3 | — | 32.6k |
| cogito:8b rw-7 | on | 0.00, 0.33, 0.67 | 0.33 | 13 | 5 (5) | 36.4k |
| cogito:8b lh-1 | off | 0.00, 0.00, 0.11 | 0.04 | 5 | — | 138.9k |
| cogito:8b lh-1 | on | 0.78, 0.78, 0.11 | 0.56 | 16 | 10 (8) | 206.2k |
| qwen3:4b lh-1 | off | 0.00, 0.11, 0.11 | 0.07 | 25 | — | 188.4k |
| qwen3:4b lh-1 | on | 0.22, 0.22, 0.00 | 0.15 | 11 | 5 (5) | 89.8k |

Reading:
- The mechanism fires and works live: 20 forced retries, 18 returned a tool call (the other 2 kept the original reply, as designed). Outstanding work at the fire was almost always an unwritten deliverable (`file-write`, `artifact:report.md` / `sources.md` / `findings.json`).
- Off-arm cogito `rw-7` ended 23 of 23 mid-run turns with no call; on-arm, 5 of 8 no-call turns were turned into calls.
- Mean accuracy rose in all three cells on both tiers. At k=3 per cell each gap is inside Bernoulli noise on its own; the uniform direction and the activation counts are the evidence, not any single gap.
- Tokens: cogito +41% across its two cells (runs keep working instead of stalling out), qwen -52% (fewer looping calls). The ablation gate's 15% overhead ceiling would reject the cogito tier on raw tokens even though accuracy rose; cost per accuracy point fell. Whether the gate should read cost per accuracy point is an owner decision.

Next: ablation-warden run on the gate's matrix before any default change; delete the prose producers the rule makes dead only after that run shows they stop firing.

## Proactive mode and the per-model split (2026-11-07, commits `3c0f61142`..`dc7d9eb80`)

`actOrAnswer: "proactive"` forces the first request of a turn that has outstanding tool work. Same cells, k=3:

| Cell | Off | Retry | Proactive |
|---|---|---|---|
| cogito:8b rw-7 mean accuracy | 0.00 | 0.33 | 0.56 (no-call turns 1/19 vs 23/23 off) |
| cogito:8b lh-1 mean accuracy | 0.04 | 0.56 | 0.85 (96k tokens vs 139k off, 206k retry) |
| qwen3:4b lh-1 mean accuracy | 0.07 | 0.15 | 0.00 |

qwen's loss is one failure: `.json` deliverables written as a JSON document inside a JSON string with unescaped inner quotes (the task text quotes "component model"). Across all qwen arms, forced writes succeeded 0/18 and native writes 3/18. The harness changes that followed are structural and stay regardless of the model: file-write accepts the JSON value itself through the healing pipeline's new value-shape stage, one parameter projection (`toParameterJsonSchema`) carries `semantic` / `enum` / `items` end to end (enums were previously dropped before the model), and two misleading recovery texts were corrected. qwen still chose string content after those changes, so forcing reliability is a property of the model.

Consequence: forcing is a per-model decision, learned the way `parallelCallCapability` is (calibration prior, local observations, community profiles): `auto` picks proactive for models that stall and force reliably (cogito), retry or off for models whose forced calls fail (qwen3:4b on JSON writes), and off for models that rarely stall (paid tiers pay nothing).

## Instrument note

`model:ignored-guidance` and `model:evidence-not-gathered` count runs where the harness had a structural option (force the call) and used prose instead. Once act-or-answer exists, a no-call stall with forcing available and unused should attribute to the harness. Owner decision; harness-warden instrument change.
