---
type: harness-report
status: complete
created: 2026-10-28
tags: [harness-report, todo, meta-tools, plan-checklist, spike, local-models]
probe: todo-surface-probe
verdict: directional-spike-evidence
related:
  - "[[2026-10-28-plan-and-goal-primitives]]"
---

# Todo surface probe (2026-10-28)

> [!warning] Directional spike evidence, not a lift-rule verdict
> n=5 per cell, 3 local tiers, deterministic toy tasks. The data informs Open question 1 of
> [[2026-10-28-plan-and-goal-primitives]]. It does not KEEP or REMOVE anything.

Raw data: `wiki/Research/Harness-Reports/2026-10-28-todo-surface-probe.json` (90 valid cells plus 30 excluded gpt-oss cells, with per-cell todo args, tool calls, visible tool lists, and first-call prompt tokens).

## TL;DR

1. **Capable local models do not use `todo`.** qwen3:14b and gemma4:12b made 0 `todo` calls in 30 arm-B runs each, including 10 runs of the 6+ step task. The tool description says to call it "ONCE at the start of any task with 3+ distinct steps". They ignore that instruction.
2. **The small model misuses it.** qwen3:4b called `todo` in 5 of 5 L-class arm-B runs. All 6 calls used invalid actions: `calculate_total`, `complete`, `answer`. It treated `todo` as a compute or answer tool. There were 0 valid `add` calls and 0 checklists. No model added a checklist to the trivial task.
3. **The fixed cost is exact and small.** Exposing `todo` adds **+50 prompt tokens per LLM call** on qwen3 and **+59** on gemma4. The value is identical across all 5 runs of every cell. On a one-call trivial task that is +6% to +20% of total tokens. On M and L tasks run-to-run variance hides it.
4. **No success lift is measurable.** T and M are at ceiling (5/5 in both arms on every tier). L is at floor on qwen3:4b (0/5 vs 0/5) and at ceiling on gemma4:12b (5/5 vs 5/5). qwen3:14b L is 1/5 (A) vs 2/5 (B). That gap is noise, and it cannot be caused by `todo` because arm B never called it.
5. **Recommendation: option (1).** Keep the checklist display-only, with `todo` opt-in. Do not default `todo` on, Cortex chat included, on this evidence.

## Setup

| Item | Value |
|---|---|
| Strategy | `reactive`, `maxIterations: 15`, provider `ollama` |
| Arm A | Framework default: no `.withMetaTools` call. This resolves to `{brief:false, find:false, pulse:false, recall:true, harnessSkill:true}` (`runtime-construction.ts:331-344`). |
| Arm B | `.withMetaTools({brief:false, find:false, pulse:false, recall:true, harnessSkill:true, todo:true})`: the default set plus `todo`. |
| Tiers | qwen3:4b (small), qwen3:14b (mid), gemma4:12b (mid, second family) |
| n | 5 per (tier × class × arm). Arms interleaved per rep. 90 valid cells. |
| Tools | `inventory_lookup(id)`, `price_lookup(id)`, `report_file(body)`. Deterministic and in-process. No web, no keys. |
| Probe | Throwaway script in the session scratchpad, not committed. |

Task classes and their programmatic checks:

| Class | Prompt (abridged) | Pass condition |
|---|---|---|
| T (trivial) | "What is the capital city of Japan? Answer in one word." | Output matches `/tokyo/i`. |
| M (3-5 steps) | Look up A100, B200 and C300, then give the total units. | Output contains `186` and all 3 lookups happened. |
| L (6+ steps) | Look up quantity and price for 4 SKUs, compute the total value, file a report, then answer. | Output contains `1115`, a filed report body contains `1115`, and all 8 lookups happened. |

Arm B must **not** be written as `.withMetaTools({ todo: true })` alone. `withMetaTools` means "exactly what you name" (`builder/withers/tools.ts:143`), so that call silently drops `recall`. Comparing it against the default would mix the effect of adding `todo` with the effect of removing `recall`. The probe avoids this by spelling out the default set plus `todo`.

## Instrument checks (before reading any result)

- **Workspace resolution.** `createRequire` is anchored at `packages/benchmarks`. It resolves runtime to `packages/runtime/src/index.ts` and tools to `packages/tools/src/index.ts`. Reasoning resolves to `packages/reasoning/dist`. `turbo run build` was fully cached (34/34), so that dist matches the current source.
- **Tool surface per arm.** Printed from the `tool-surface-resolved` trace event and cross-checked against `llm-exchange.toolSchemaNames`. Within each class, the arms differ only by `todo`:
  - T and L, arm A: `inventory_lookup, price_lookup, report_file, recall`
  - T and L, arm B: `inventory_lookup, price_lookup, report_file, todo, recall`
  - M, arm A: `inventory_lookup, recall`
  - M, arm B: `inventory_lookup, todo, recall`

  Lazy disclosure prunes M to the one relevant tool in both arms. `todo` survives the pruning.
- **Harness skill text never reaches the model.** `buildHarnessSkill` generates a `todo(...)` line. The kernel injects that text only when `brief` or `pulse` is enabled (`resolve-think-surface.ts:224`). Both are off by default, so the system prompt is identical (534 characters) in both arms. In arm B the model's only `todo` guidance is the tool description itself. That matches what a user who flips `todo: true` gets today.
- **Where args live.** Tool args appear on `tool-call-end`, not on `tool-call-start`. The first smoke run read the wrong event and logged null `todo` args. The parser was fixed before any counted run.
- **Smoke-run confound, fixed before counting.** In the first smoke run the probe tools took a `sku` parameter. `repetitionGuard` then replaced the 3rd and later distinct-SKU lookups with "Stop repeating this tool". Arms A and B both failed M and L for that reason, so the comparison was meaningless. The probe parameter was renamed to `id`, which is in `TARGET_ARG_KEYS`, so the distinct-target carve-out applies. This is logged as side finding S1 below.
- **Checker spot-check on L failures.** All failures are real model errors:
  - qwen3:4b sends `report_file` in the same parallel batch as the lookups, with an invented value such as `$123456.78`. The final answer is then correct, but the filed report is wrong.
  - qwen3:14b either never files the report or files a wrong value.

## Results

`tok` is total trace tokens over every LLM exchange, given as mean ± standard deviation, with the median in parentheses. Wall time is in seconds.

| Tier | Class | Arm | Pass | tok | LLM calls | Wall (median) | Runs with todo | Todo calls (errors) |
|---|---|---|---|---|---|---|---|---|
| qwen3:4b | T | A | 5/5 | 636±114 (608) | 1.0 | 2.1 | – | – |
| qwen3:4b | T | B | 5/5 | 725±39 (743) | 1.0 | 2.4 | 0/5 | 0 |
| qwen3:4b | M | A | 5/5 | 1543±62 (1535) | 2.0 | 3.8 | – | – |
| qwen3:4b | M | B | 5/5 | 1680±65 (1669) | 2.0 | 3.9 | 0/5 | 0 |
| qwen3:4b | L | A | 0/5 | 3446±245 (3272) | 2.0 | 11.8 | – | – |
| qwen3:4b | L | B | 0/5 | 4842±1945 (3789) | 2.0 | 14.0 | **5/5** | 6 (**6**) |
| qwen3:14b | T | A | 5/5 | 496±27 (485) | 1.0 | 4.3 | – | – |
| qwen3:14b | T | B | 5/5 | 527±15 (516) | 1.0 | 3.6 | 0/5 | 0 |
| qwen3:14b | M | A | 5/5 | 2126±1066 (1624) | 2.6 | 14.6 | – | – |
| qwen3:14b | M | B | 5/5 | 1769±64 (1789) | 2.0 | 15.9 | 0/5 | 0 |
| qwen3:14b | L | A | 1/5 | 6929±4500 (5093) | 2.4 | 68.5 | – | – |
| qwen3:14b | L | B | 2/5 | 5313±3028 (4597) | 3.8 | 51.4 | 0/5 | 0 |
| gemma4:12b | T | A | 5/5 | 275±7 (279) | 1.0 | 1.1 | – | – |
| gemma4:12b | T | B | 5/5 | 331±7 (327) | 1.0 | 0.9 | 0/5 | 0 |
| gemma4:12b | M | A | 5/5 | 1886±384 (2070) | 3.6 | 9.2 | – | – |
| gemma4:12b | M | B | 5/5 | 1630±536 (1202) | 2.8 | 5.2 | 0/5 | 0 |
| gemma4:12b | L | A | 5/5 | 3465±258 (3547) | 3.8 | 16.6 | – | – |
| gemma4:12b | L | B | 5/5 | 4442±2342 (3199) | 4.6 | 16.8 | 0/5 | 0 |

### Fixed schema tax (deterministic)

The first-call prompt tokens were identical across all 5 runs of every cell, so this measurement has no noise:

| Tier | T: A → B | M: A → B | L: A → B | Δ per call |
|---|---|---|---|---|
| qwen3:4b / qwen3:14b | 332 → 382 | 396 → 446 | 482 → 532 | **+50** |
| gemma4:12b | 225 → 284 | 291 → 350 | 381 → 440 | **+59** |

The tax is charged on every LLM call of every run, whether or not the model uses `todo`.

- **Relative size.** These probes have tiny prompts, so the tax is 10-26% of the first call's prompt. A production agent with a larger system prompt and tool set pays the same 50-59 absolute tokens per call, which is a much smaller fraction.
- **Total-token effect on T.** The arm B − arm A gap in mean total tokens is +6% (qwen3:14b), +14% (qwen3:4b) and +20% (gemma4:12b).
- **M and L.** Run-to-run variance dominates the total-token deltas: −42% to +40%, with standard deviations up to 4,500 tokens. No direction can be read from them.

### Adoption behaviour

- **Trivial task.** 0/15 arm-B runs called `todo`. The concern that exposing `todo` makes models add checklists to trivial tasks did not occur on any tier.
- **Capable tiers on M and L.** 0/20 arm-B runs on qwen3:14b and gemma4:12b called `todo`. Both models dispatch the lookups as one or two parallel batches and answer. Under the default prompt (no harness skill text), the tool description alone does not get these models to plan with `todo`.
- **Small tier on L.** 5/5 arm-B runs on qwen3:4b called `todo`, and every call was invalid. The actions were `calculate_total` (×2), `complete` (×2) and `answer` (×2). Some calls also passed `items` holding values or step names. The model used `todo` as a compute or "submit answer" escape hatch.

  This misuse cost tokens: mean +40% and median +16% versus arm A, and mean wall time 21.1 s vs 12.7 s. Pass rate was 0/5 in both arms, so a success effect cannot be measured. The tool's error text ("Unknown action … Valid: add | start | done | list") did not lead the model to retry with a valid action.
- **Item completion.** No run produced a checklist, so there is no completion data to report.

## Reading against the lift rule (≥3pp lift AND ≤15% token overhead, ≥2 tiers)

- **Lift: not shown.**
  - T and M are at ceiling on all three tiers.
  - L is at floor (qwen3:4b) or at ceiling (gemma4:12b).
  - qwen3:14b L is +20pp (1/5 → 2/5). That is inside the ~±26pp noise band for n=5 Bernoulli cells. It also cannot be attributed to `todo`, because arm B made 0 `todo` calls. Any change there comes from the 50-token schema perturbation or from sampling.
- **Overhead: mixed.** The deterministic per-call tax is small in absolute terms. On trivial one-call tasks it exceeds 15% on 2 of 3 tiers (gemma4:12b +20%, qwen3:4b +14% mean / +22% median). On qwen3:4b L, misuse adds +16% to +40%.
- **Net: the lift rule is not met.** These numbers give no support for making `todo` default-on.

## Threats to validity

1. **Tasks are parallel-batchable.** The L class needs 8 lookups and 1 report, and capable models do it in 1-2 parallel batches. A checklist helps most on long sequential work, where context drifts across many iterations (15+ steps, dependent actions, compaction). This probe does not cover that regime. `todo`'s possible benefit there is untested.
2. **Local tiers only.** No frontier tier was run (no keys were in scope). Frontier models may adopt `todo` where local models do not. The plan's Cortex question involves whichever model the user picks.
3. **Default prompt only.** The harness skill line never rendered (see Instrument checks). A prompt that teaches `todo`, for example with `brief` or `pulse` enabled or with stronger guidance, could change adoption. That would be a different arm with its own token cost.
4. **n=5 per cell.** Bernoulli SE is about 13pp per cell, so gaps under about 26pp are noise. Token means on M and L have high variance, driven by qwen3 thinking spirals (one qwen3:14b L/A run took 357 s and 15.8k tokens).
5. **gpt-oss excluded.** All 30 gpt-oss cells failed at iteration 0 with an environmental model-load error in the local Ollama: `read GGUF metadata ... unsupported tensor "blk.0.ffn_down_exps.weight" size overflows`. Each cell shows 0 tokens and `llm_error`. They are kept in the JSON under `excluded` and are not analysed.
6. **The probe tool was adapted to avoid S1.** Real user tools named `*_lookup` with a `sku` argument hit the repetition ceiling (S1). In that case, more tool calls are blocked in both arms, regardless of `todo`.

## Recommendation (Open question 1)

**Option (1): keep the checklist display-only and `todo` opt-in.** Do not default `todo` on, and that includes Cortex chat.

- The plan's Decision 5 already states this. This probe gives it an empirical basis.
- **Capable local tiers.** `todo` is a dead surface on capable local models. It costs 50-59 tokens on every call and is never used.
- **Small tier.** On qwen3:4b it is a misuse attractor that adds tokens with no success change.
- **Cortex chat.** For Task 0 ruling 2, this is evidence that a chat-session `todo: true` default *needs* ablation. Cortex should ship `todo: false` with the settings toggle until a frontier-tier ablation on long sequential tasks exists.
- **Option (3), triage-gated default on long tasks.** This may still be the right Phase-2 shape. The only regime where `todo` could earn its cost is the one this probe did not test (threat 1). Option (3) should come only after a probe in that regime with arms like these, run on ≥1 frontier tier plus ≥2 local tiers.
- **Option (2), one surface with `todo` default-on.** Not supported.

## Side findings (separate from the todo question; route to domain wardens)

- **S1: `repetitionGuard` hard-caps distinct-argument calls on user tools (kernel-warden).**
  - **Where:** `packages/reasoning/src/kernel/capabilities/act/guard.ts:338-420`, together with `decide/tool-gating.ts:106-138`.
  - **Name heuristic:** a tool counts as parallel-safe only if its name contains `search`, `http`, `fetch`, `get`, `read`, `list` or `query`. A tool named `inventory_lookup` is therefore "sequential-only", with a ceiling of 2 calls.
  - **Missing carve-out:** the distinct-target carve-out recognises only the arg keys `path`, `file`, `target`, `url`, `id` and `command` (`guard.ts:97`). So `inventory_lookup({sku:"C300"})`, a new SKU, is replaced with "Stop repeating this tool".
  - **Observed effect:** in the smoke run this blocked the 3rd and 4th lookups of the M and L tasks in both arms, and the model then fabricated a total (`$123,456.78`). This is the same defect class as the 2026-08-15 rw-7 carve-out, at a third site. Per the boundary-first rule, the fix belongs at the boundary: treat a call as non-repetition when its full args differ from every prior call to the same tool, rather than adding more key names. It needs its own probe before and after the change.
- **S2: default `harnessSkill: true` is a no-op under default meta-tools (runtime-warden / kernel-warden).**
  - **Where:** `runtime-construction.ts:340-376` generates skill text for the enabled set. `resolve-think-surface.ts:224` injects it only when `brief` or `pulse` is on, and both are off by default.
  - **Effect:** the `recall` line and the `todo` line never reach the model. Either the injection gate or the default is wrong. This is relevant to the plan because any "todo with harness guidance" arm needs that gate fixed or bypassed.
- **S3: `.withMetaTools({ todo: true })` drops `recall` (DX footgun; runtime-warden or plan Task 8 notice).** "Exactly what you name" means a user who adds `todo` loses the load-bearing `recall`. `recall` is the tool that overflow previews tell the model to call. The plan's Decision 5 tells users to enable `.withMetaTools({ todo })`, so this footgun sits directly on the plan's documented path. Either merge over the defaults or document it loudly.
- **S4: environmental.** The local Ollama cannot load the `gpt-oss:latest` blob. gpt-oss also has no capability entry, so it falls back to a 2048-token context. Not a framework defect. Re-pull the model before using it as a tier.
