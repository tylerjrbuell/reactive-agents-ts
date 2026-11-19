---
type: audit
status: complete
created: 2026-11-19
tags: [harness, calibration, adaptive, audit, traceability, lift-gate]
---

# Adaptive-harness audit: does model probing and calibration run, change behavior, and show up in a trace?

Read-only audit (harness-warden, mission `adaptive-harness-audit`). Zero tokens spent, no code edited. Evidence: code reading (`path:line`), trace scans of `2026-11-18-zoo-live` (262 runs), `packages/benchmarks/benchmark-traces` (529 runs) and `~/.reactive-agents/traces` (4,048 files), plus one zero-token resolver run on the local observation store. Scratch scripts were run from the session scratchpad and are not committed.

## Bottom line

1. **The harness has real probing, but it is two different systems and neither adapts by default in the way the owner pitch implies.**
   - System A, capability probe (`/api/show`): runs automatically on first use of an Ollama model, caches to `~/.reactive-agents/capabilities/`. It measures context window, thinking mode, tool-template presence, dialect, tokenizer family. This one genuinely differs per model and does change behavior.
   - System B, behavioral calibration (`ModelCalibration`): a manual CLI (`calibration-runner.ts`), results committed as JSON for 9 models. Everything else resolves to "no calibration". It never runs at first use.
2. **Shipped behavioral calibration barely discriminates between models.** All 9 shipped files carry `optimalToolResultChars: 2000` and `systemPromptAttention: strong`. The v2 scorers could not tell models apart (the 2026-11-11 ablation says so). Only `parallelCallCapability`, `observationHandling`, `toolCallDialect` and `actOrAnswer` (2 models) vary.
3. **The most model-specific calibration field, `actOrAnswer`, is inert by default.** Its consumer (`resolveActOrAnswer`) only reads calibration when the harness setting is `"auto"`. The default is OFF (`actOrAnswerMode()` returns `false` unless `RA_ACT_OR_ANSWER` is set, `packages/reasoning/src/harness-flags.ts:206`). In all 4,500+ scanned traces, `actOrAnswerSource` is `"explicit"` or absent; it is never `"calibration"` or `"default"`.
4. **Lift is unproven.** The only calibration A/B on record (2026-11-11 v3 priors) was BELOW the bar: -3.0pp cogito:8b, -0.9pp qwen3:4b. The act-or-answer prior has its own A/B (cogito:8b proactive 0.56/0.85 vs off 0.00/0.04) but no gated adaptive-on vs adaptive-off arm exists.
5. **Accountability is weak.** A single trace cannot answer "what was measured, what was set, why". `run-started.config.builder.calibration` records only the mode string `"auto"`. No resolved values, no provenance, no probe version, no staleness verdict.
6. **Two defects found** (code reading; see Findings F1, F2): `calibration: "skip"` does not disable the `optimalToolResultChars` override, and the printed provenance line hardcodes its sources.
7. **Principle violations ("key on measured behavior, not model name")**: the tier heuristic in `profile-resolver.ts` is still a model-name regex table, a second duplicate registry in reactive-intelligence disagrees with it, and calibration files are keyed by model id. Table in section 5.

## 1. Inventory

"Where stored" is the durable home. "Default" is what a plain `ReactiveAgents.create()...build()` run does.

| # | Mechanism | Measures | When | Knob it sets | Default | Stored | Code |
|---|---|---|---|---|---|---|---|
| 1 | Ollama capability probe | `/api/show`: context length, parameter size, thinking support, tool-template presence, dialect, family | first use of a (model, endpoint); then cached | tier hint, `recommendedNumCtx` -> `profile.maxTokens`, `supportsThinkingMode` -> `profile.thinkingModel` (token allowance), driver route | ON (Ollama only) | `~/.reactive-agents/capabilities/<provider>-<model>-<endpoint>.json` (30+ files present) | `llm-provider/src/providers/local-probe.ts`; `reasoning/src/context/context-profile.ts:212-234` |
| 2 | Static capability rows | declared per model, not measured | build time | same fields as 1 for cloud models and named local models | ON | source files | `llm-provider/src/capability-anthropic.ts`, `capability-ollama-local.ts` |
| 3 | Model digest check | live weights digest vs recorded | each `loadCalibration` for digest-bearing records | drops stale calibration, emits recalibrate signal | ON, but no shipped file carries a digest, so it never fires | in the record | `llm-provider/src/calibration.ts:loadCalibration`, `model-digest.ts` |
| 4 | Calibration probe suite | steering, parallel batching, recall handling, attention decay, result-size ladder, dialect (5 probes, probeVersion 3) | manual: `bun calibration-runner.ts --model X --commit`; 30-120 s per model (free, local only) | writes `ModelCalibration` JSON | OFF (not run at runtime) | `llm-provider/src/calibrations/<id>.json` (9 models, all `probeVersion: 2`) | `llm-provider/src/calibration-runner.ts`, `calibration-scoring.ts` |
| 5 | Shipped calibration resolve | loads the JSON by normalized model id | run start | see 6-10 | ON when `calibration` is `"auto"` (engine default) | in-memory + JSON | `runtime/src/engine/phases/agent-loop/setup/calibration.ts` |
| 6 | `optimalToolResultChars` | -- | kernel start | `ContextProfile.toolResultMaxChars` (local tier default 1200 -> 2000 for the 9 calibrated models) | ON, via a separate path (F1) | -- | `llm-provider/src/calibration.ts:288-297`, `reasoning/src/kernel/loop/runner.ts:205-211` |
| 7 | `observationHandling` | -- | each think turn | `uses-recall` force-keeps the recall tool; `hallucinate-risk` adds scaffolding (scaffolding has no reader) | ON | -- | `reasoning/src/kernel/capabilities/reason/think.ts:430`, `decide/tool-call-refusals.ts:182` |
| 8 | `parallelCallCapability` | -- | blueprint strategy; parallel-tool-hint | caps blueprint worker concurrency 1/2/4; gates the parallel hint line | blueprint: ON when that strategy runs. Hint: OFF (flag) | -- | `reasoning/src/strategies/blueprint.ts:149-151`, `kernel/capabilities/reason/parallel-tool-hint.ts:86` |
| 9 | `actOrAnswer` | forced-call outcomes (A/B) | run start | resolves `"auto"` to proactive/retry/off | **OFF**: needs `RA_ACT_OR_ANSWER=auto` | JSON (2 models) | `reasoning/src/harness-config.ts:316-348` |
| 10 | `classifierReliability` | classifier false-positive rate | run start | `low`/`skip` bypasses the LLM classifier call | no shipped file sets it; only the learned tier can | -- | `reasoning/src/strategies/adaptive.ts:192`, `runtime/.../setup/classifier.ts` |
| 11 | `systemPromptAttention` | per-turn rule retention | build tools | prunes the `final-answer` tool description; `weak` adds scaffolding (no reader) | ON, but all 9 files say `strong`, so nothing differs | -- | `tools/src/skills/final-answer.ts` (per 2026-11-11 ablation) |
| 12 | `steeringCompliance`, `knownToolAliases`, `knownParamAliases`, `toolCallDialect` (as route) | -- | -- | no live reader for steering; dialect claim is provenance only, capability routes (design law #1) | -- | -- | `llm-provider/src/calibration.ts` header; `runner.ts:226-245` |
| 13 | Learned tier (observations) | per run: parallel turns, classifier calls, stalls, forced-call outcomes (last 50 runs) | recorded every run; applied only if opted in | overrides 9 (partly), 8, 10 once 5 runs exist | **recorded ON, applied OFF** (`.withCalibration("auto",{learned:true})`) | `~/.reactive-agents/observations/<model>.json` (50 files; qwen3:4b 1,121 samples, cogito:8b 1,202, gemma4:e4b 385) | `reactive-intelligence/src/calibration/observations-merge.ts`, `runtime/src/observers/run-observer.ts` |
| 14 | Community tier | fetched profile | run start | overrides declared fields | OFF (opt-in; blocked by `DO_NOT_TRACK`) | `~/.reactive-agents/community-profiles/` | `reactive-intelligence/src/calibration/community-profile-client.ts` |
| 15 | Policy compiler `compileHarnessPlan` | tier + calibration + horizon + classification | run start, recompile mid-run | strategy nomination, scaffolding depth, budget class, tool surface, memory posture | **OFF** (`adaptiveHarness`) | `state.meta.harnessPlan` | `reasoning/src/kernel/policy/harness-plan.ts:171`, `runner.ts:485` |
| 16 | Calibration drift detection | entropy distribution vs baseline | each run | drift event | claimed in `Agents-Extended-Reference.md`; not verified in this audit | -- | -- |

## 2. Trace evidence per model

Scans: all `run-started` records plus a keyword search of every other event.

| model | runs scanned (zoo-live) | `builder.calibration` in `run-started` | resolved calibration values in any event | `actOrAnswerSource` | tier / window / numCtx | maxTokens per think call |
|---|---|---|---|---|---|---|
| gemma4:e4b | 127 | `"auto"` x127 | none | `explicit` x127 | local / 32768 / 32768 | 7200 (634 calls), 1200 (12) |
| cogito:8b | 130 | `"auto"` x130 | none | `explicit` x130 | local / 32768 / 32768 | 1200 (794 calls), ~31.5k (3) |
| qwen3:4b | 5 | `"auto"` x5 | none | `explicit` x5 | local / 32768 / 32768 | 7200 (15), ~31.8k (1) |

Wider corpus (`~/.reactive-agents/traces`, 4,048 files; `packages/benchmarks/benchmark-traces`, 529 runs): same picture. `adaptiveHarness` is `false` in 100 % of runs; `numCtxPolicy` is `"fixed"` in 100 %. `actOrAnswerSource` is never `calibration` or `default`.

What does vary per model, truthfully:

- **thinking allowance**: gemma4:e4b gets `maxTokens` 7200 on think calls, cogito:8b gets 1200. Source is the capability probe's `supportsThinkingMode` -> `profile.thinkingModel` -> `+THINK_MODEL_ALLOWANCE` (`reasoning/src/kernel/llm-gateway.ts:170`). Consistent with the 8b/e4b capability rows. I did not verify cogito's flag value directly. This is System A, not calibration.
- **parallel-tool-hint gate**: the only trace that records a calibration field. 45 `harness-signal-injected` events with `origin:"parallel-tool-hint"` carry `metadata.parallelCallCapability:"reliable"`, all on gemma4:e4b (15 runs, arm `pth`). cogito:8b (`sequential-only`) has zero hint events, but also zero runs with the flag on, so the suppression half of the gate was never observed.

What does NOT vary: tier (`local`), window (32768) and `numCtx` (32768) are identical across the three models. `toolResultMaxChars` is 2000 for all three (calibration) versus a 1200 tier default. So the context cap and tool-result inlining do not differ by model in this corpus.

**Truthful answer to "did any knob change behavior per model?":** calibration, as shipped, changes behavior in two places (tool-result budget 1200->2000 for calibrated models, recall force-on), but with the same value for every model measured. Per-model divergence appears only from the capability probe (thinking allowance) and, for one flagged mechanism, `parallelCallCapability`. Nothing in the corpus shows `actOrAnswer`, `classifierReliability`, learned or community tiers, or the policy compiler acting.

### What the learned tier would say (zero-token resolver run)

`resolveModelCalibrationWithProvenance(model, {localObservations:true})` against the local observation store:

| model | shipped | with learned tier |
|---|---|---|
| gemma4:e4b | parallel `reliable`, actOrAnswer unset | parallel `sequential-only`, classifier `high`, actOrAnswer `off` |
| cogito:8b | parallel `sequential-only`, actOrAnswer `proactive` | classifier `high`, actOrAnswer **`off`** |
| qwen3:4b | parallel `reliable`, actOrAnswer `retry` | parallel `sequential-only`, classifier `high` |
| cogito:14b | parallel `reliable` | parallel `sequential-only`, actOrAnswer `retry` |

Two abstract problems here, both in the learned design, not model quirks:

- **Measured propensity is not measured capability.** "Parallel turns observed" is low because nothing in the default harness asks the model to batch (the hint is off). Learning `sequential-only` from that is circular, and it would flip gemma4:e4b from `reliable`, which a probe measured.
- **The learned `actOrAnswer: off` for cogito:8b contradicts the controlled A/B** (proactive 0.56/0.85 vs off 0.00/0.04, 2026-11-06). The observations come from runs under whatever arm was active (ablation arms with `RA_ACT_OR_ANSWER=0` dominate the recent history), so low stall rate reflects the arm, not the model. `deriveActOrAnswer` guards against self-flipping off proactive only when unforced turns are scarce (`observations-merge.ts` header comment). It cannot detect that other mechanisms rescued the stalls. The store is also global across all experiments on the machine (1,202 cogito:8b samples). Keeping it opt-in was the right call.

Another observation: recorded `dialect` is `"none"` in the latest observation of all three models, including gemma4:e4b whose probe row says `native-fc`. That field is stale or wrong in the observation writer. Not chased further.

## 3. Traceability gaps (additive trace events; do not build here)

Test: "from one trace, answer what was measured, what was set, why."

| # | Gap | Evidence | Proposed additive field or event | Owner |
|---|---|---|---|---|
| G1 | `run-started.config.builder.calibration` is the mode string only | all traces: `"auto"` | `calibration: { source: "shipped\|community\|learned\|default\|none", probeVersion, calibratedAt, runsAveraged, digestStatus, fields: { parallelCallCapability, observationHandling, systemPromptAttention, optimalToolResultChars, actOrAnswer, classifierReliability }, provenance: Record<field, source> }` taken from `resolveModelCalibrationWithProvenance` | runtime-warden (`execute-agent-started.ts:108`, `buildRunConfigSnapshot`) |
| G2 | Provenance line is console text, not trace, and hardcodes `sources: ["prior"]` (F2) | `runtime/src/engine/execute-completion-obs.ts:75-89` | fix by reading the resolver's provenance map | runtime-warden |
| G3 | Capability probe result not in trace: tier, `recommendedNumCtx`, `supportsThinkingMode`, probe `source` (`probe`/`static`/`fallback`), probeVersion | `projection-rendered` has `window` and `tier` only; no source | `capability-resolved` event at run start: `{ model, provider, source, tier, maxContextTokens, recommendedNumCtx, supportsThinkingMode, toolCallDialect, probeVersion, fromCache }` | provider-warden (emit) + kernel-warden |
| G4 | Applied overrides not recorded: no event says "toolResultMaxChars set to 2000 by calibration (default 1200)" | `runner.ts:205-211` merges silently | `profile-overrides-applied` event: `{ field, from, to, source }` | kernel-warden |
| G5 | Which calibration-fed branch fired is invisible: recall force-on, blueprint concurrency, classifier bypass | `think.ts:430`, `blueprint.ts:149` | one `calibration-effect` event per consumer: `{ field, value, consumer, effect }`. Parallel-tool-hint already does this inside `harness-signal-injected.metadata`; reuse that shape | kernel-warden |
| G6 | `actOrAnswerSource` records `explicit` for an env-forced value and cannot distinguish "off by default" from "off by calibration" | 100 % of traces say `explicit` | the default path records `explicit` because `actOrAnswerMode()` returns `false`, not `"auto"`; add `default-off` source | kernel-warden |
| G7 | Policy compiler plan not in trace (`state.meta.harnessPlan` only) and `adaptiveHarness` off | no `plan` event kinds in any corpus | `harness-plan-compiled` event with `rationale` string (it already exists: `harness-plan.ts` `reasons`) | kernel-warden |
| G8 | Stale or missing calibration is silent: a model with no JSON runs on tier defaults with no event | e.g. mimo-v2.6, bonsai-2:27b, gemma4:latest have capability rows but no calibration file | `calibration: { source: "none" }` in G1 covers this | runtime-warden |
| G9 | Observation `dialect` field is `"none"` for native-FC models | `~/.reactive-agents/observations/*.json` | fix the writer | runtime-warden (`runtime/src/observers/run-observer.ts`) |

## 4. Findings (code-level)

| # | Finding | Evidence | Confidence |
|---|---|---|---|
| F1 | **`calibration: "skip"` does not disable the `optimalToolResultChars` override.** The kernel runner calls `selectAdapter(..., effectiveInput.modelId)` unconditionally, and `selectAdapter` loads the shipped JSON by model id on its own (`loadCalibration`). It ignores the resolved `input.calibration`. Consequences: (a) the documented `skip` contract ("pure tier-based adapters") is false for tool-result sizing; (b) the learned and community tiers can never change `optimalToolResultChars`; (c) any "calibration off" arm in an A/B is contaminated. | `runner.ts:205-211`; `llm-provider/src/adapter.ts:354-358`; `builder/withers/calibration.ts` doc for `"skip"` | High (read from code; not run) |
| F2 | **Provenance line misreports sources.** `sources` starts as `["prior"]`, adds `"local"` if any observations exist, and never adds `"community"`. It ignores the learned flag, so with `learned` off it still prints "local" if observations exist. The resolver already computes the true per-field provenance and this code does not use it. | `execute-completion-obs.ts:75-85` | High |
| F3 | **Calibration is not adaptive-at-first-use.** An unseen model (any model not among the 9) gets no behavioral calibration at all: `loadCalibration` returns `undefined`, `resolveCalibration` returns `undefined` unless the learned or community tier is opted in. The capability probe does run for new Ollama models, so context and thinking adapt, but steering/recall/parallel/actOrAnswer do not. | `setup/calibration.ts`; `runtime/src/calibration-resolver.ts` | High |
| F4 | **Shipped priors are `probeVersion: 2`; the runner is v3.** The v3 regeneration was ablated and held (OPT-IN). So the shipped values come from scorers the repo's own ablation says could not discriminate. | `calibrations/*.json`; `calibration-runner.ts` `PROBE_VERSION = 3`; 2026-11-11 ablation | High |
| F5 | **`actOrAnswer` calibration reaches no default run.** See Bottom line 3. The strongest per-model evidence the framework has (cogito proactive vs qwen3 retry) is dead weight until `RA_ACT_OR_ANSWER=auto` becomes the default. That default needs a lift gate. | `harness-flags.ts:206`; trace corpus | High |
| F6 | **Three fields have no live reader**: `steeringCompliance`, and the `scaffoldingLevel` that `systemPromptAttention=weak` and `observationHandling=hallucinate-risk` raise (`harness-plan.ts:190-198`; plan compiler is off by default and `scaffoldingLevel` has no consumer per the `calibration.ts` header). They are measured, shipped and ignored. | headers of `calibration.ts` and `harness-plan.ts` | High (taken from the source's own census comments; not re-grepped for every consumer) |
| F7 | **`systemPromptAttention` and `optimalToolResultChars` cost probe time and have zero measured lift** (2026-11-11, n=3 per cell, 72 cells). Absence of effect at that power is not proof of equivalence, but there is no positive evidence either. | ablation note | High |

## 5. Model-name keying (violates "calibrate to measured behavior, not model name")

Legitimate, not flagged: provider-level registries of declared facts for cloud models (`capability-anthropic.ts` etc.) because those APIs expose no probe, and the tokenizer family bucket derived from the GGUF `family` field (`local-probe.ts:138`, a measured field).

| # | Location | What keys on the name | Severity | Why it breaks the principle |
|---|---|---|---|---|
| V1 | `packages/reasoning/src/context/profile-resolver.ts:9, 12-24, 26-48` (substring tables), `:66-90` (provider-scoped substrings), `:131-146` (`CAPABLE_LOCAL_PATTERNS` plus `/(\d+)b/` size regex plus `gpt-4o-mini` special case) | Model tier from name substrings: `qwen`, `llama`, `cogito`, `gemma`, `haiku`, `flash`, `opus`, `gpt-5`, `o1` | High | Tier decides scaffolding, budgets, adapter hooks. The registry-first path (W2b) now runs first, but any registry miss falls back to this table. The code comment calls it "provisional". It also mis-buckets any new family name (e.g. a model called `bonsai` lands in the default `mid`). |
| V2 | `packages/reactive-intelligence/src/calibration/model-registry.ts:5-18` (`MODEL_REGISTRY`) | Second, duplicate tier and context registry keyed by model id. Disagrees with V1: `gpt-4o-mini` is `frontier` here, `mid` in `profile-resolver.ts:142`; `claude-haiku-4` is `frontier` here, `mid` there | High | Two arbiters for one fact (design law #1: one capability arbiter). Which one wins depends on the caller. |
| V3 | `packages/llm-provider/src/calibration.ts:normalizeModelId` and `calibrationCandidatePaths` | Calibration JSON is looked up by model-id filename (`gemma4-e4b.json`) | Medium | Unavoidable as a cache key, but the effect is "no id match = no calibration", with no probe-on-miss (F3). A measured artifact keyed by name is acceptable only if a miss triggers measurement. |
| V4 | `packages/reasoning/src/harness-config.ts:328` (`provider === "ollama"` -> retry) and `strategy-nomination.ts:50`, `runner.ts:194` (`providerName === "ollama"` -> `local` tier), `lean-thinking.ts:59`, `prepare-think-gateway-call.ts:129, 248` | Provider-name branches stand in for a measured property ("tokens are free", "has num_ctx") | Low-Medium | Provider is not a model name, but "ollama" is used as a proxy for "small, free, local". A hosted 70B behind Ollama Cloud and a local 4B get the same default. Better: a measured or declared `Capability` flag (`freeTokens`, `hasNumCtx`). |
| V5 | `packages/runtime/src/build-validation.ts:261` (`modelLower.startsWith(p)` per provider prefix table) | Warn if a model id does not start with a known prefix | Low | Validation only, no behavior change. Warns on valid new model names. |
| V6 | `packages/llm-provider/src/providers/openai.ts:303`, `providers/local.ts:315-316`, `providers/gemini.ts:346, 412, 692` | `startsWith("claude")`/`startsWith("gpt")` to detect a wrong-provider model id and substitute a default | Low | Cross-provider config guard, not adaptation. Brittle for new names. |
| V7 | `packages/runtime/src/calibration-resolver.ts` `defaultCalibration` | Uniform defaults for unknown models: `parallelCallCapability: "partial"`, `optimalToolResultChars: 1200` | Info | Fine as a prior, but nothing measures it away. Only reached via the learned or community tier. |

I did not find `if (model === "qwen3:4b")`-style per-model patches in `reasoning`, `llm-provider`, `reactive-intelligence` or `runtime` source in this pass. The name-keying is concentrated in V1 and V2, which are tier heuristics, and the per-model JSON files. A zero-token follow-up grep for `modelId`/`model` comparisons in `packages/tools/src` and `packages/judgment/src` was not done.

## 6. Minimal accountable lift test (designed, not run)

Question: does an adaptive-on harness beat an adaptive-off harness, and does a correct calibration beat a wrong one? The second arm is what makes "adaptive" falsifiable: an adaptive harness must be hurt by the wrong prior.

### Prerequisite (zero-token fixes, otherwise the arms are not what they claim)

- P1. Fix F1 so `skip` truly turns off `optimalToolResultChars` (kernel/provider wardens). Without it, "adaptive-off" still carries the 1200->2000 override.
- P2. Add the G1 trace fields so each run records which calibration arm resolved. A cell is void if G1 says the arm did not resolve as designed (same discipline as `vis` print in the tool-surface confound memory).
- P3. Decide how "adaptive-on" enables the act-or-answer prior: it needs `RA_ACT_OR_ANSWER=auto`. Pin it per arm via the run `env` snapshot, so `run-started.config.env` proves it.

### Arms (existing flags only, after P1)

| arm | `calibration` | act-or-answer | parallelToolHint | learned |
|---|---|---|---|---|
| OFF | `"skip"` | `RA_ACT_OR_ANSWER=0` | off | off |
| ON | `"auto"` (shipped) | `auto` | `auto`-style where the flag allows | off |
| SWAP (control) | `"auto"` with the OTHER model's `ModelCalibration` object passed explicitly (cogito:8b gets qwen3:4b's, qwen3:4b gets cogito:8b's, gemma gets cogito's) | `auto` | same as ON | off |

`calibration` accepts a `ModelCalibration` object (`runtime/src/types.ts:27`), so SWAP needs no new mechanism. A fourth arm, learned-on, is excluded from this cell: it is confounded by the observation-store contamination above and should wait for per-run-arm filtering of observations.

### Tiers and tasks

- Tiers: cogito:8b, qwen3:4b, gemma4:e4b. gemma4:e4b is not in `STATIC_CAPABILITIES`-driven H3 tiers per the 2026-11-11 note ("the H3 bench voids their cells as fallback context"); verify before use, otherwise run gemma as an extra-bench tier and say so. At least two tiers are required by the lift rule, so cogito:8b and qwen3:4b are the gate tiers.
- Tasks: frozen H3 suite (6 tasks used in 2026-11-11: rw-2, rw-3, rw-9, h3-required-tools, h3-continuation, h3-exact-value) plus the tasks where act-or-answer matters (stall-after-work shapes from `zoo-live`: ab-trap-5, h3-exact-value).
- k: at least 8 per cell. The 2026-11-11 matrix at k=3 could only see roughly 30pp per task; for a 10pp effect use n >= 8.

### Pre-registered rule (written before any cell runs; commit it first)

Use the coded gate `evaluateLiftGate` with `DEFAULT_LIFT_POLICY` (>= 2 tiers, >= 3pp aggregate lift, <= 15 % token overhead; Ollama tokens count as free per the 2026-11-06 owner ruling, but report them anyway). Verdicts:

1. ON vs OFF: KEEP-as-default if the gate passes. Otherwise OPT-IN. A tier with a significant regression gives REWORK.
2. SWAP vs ON: calibration is evidence of adaptation only if ON beats SWAP by >= 3pp on average and on at least 2 tiers. If SWAP ~= ON, the calibrated values carry no model-specific information (this is what the shipped files, which are near-uniform, would predict), and the right action is to simplify the schema, not to add probes.
3. Per-field attribution is out of scope for this cell. One coordinated change per cycle.

### Overhead accounting

- Runtime tokens added by calibration: zero. It is a JSON read, no LLM call. Community tier adds one HTTP GET (off here).
- One-time probe cost: `calibration-runner.ts` 30-120 s wall per model, local, zero billed tokens. qwen3:14b did not finish in 586 s (2026-11-11), so it is excluded.
- Behavioral overhead: act-or-answer `proactive` forces a tool call; count `llm-exchange` tokens per arm from the trace, not the bill.
- Cell count and wall time: 3 arms x 2 gate tiers x ~8 tasks x k=8 = 384 cells, plus gemma if it joins (+192). The 2026-11-11 matrix ran 72 cells with cell times of 4 to 104 s, so estimate roughly 4 to 6 hours wall as about 10-15 foreground chunks of up to 590 s each (`timeout 590`, never background). Billed cost: $0 on Ollama.

### Abstract failure modes the test should address

1. **Forced-act on stall (decline-to-act)**: model answers instead of calling a tool; `actOrAnswer` per model.
2. **Dead-tool or unreadable-result handling**: `optimalToolResultChars` vs truncation, recall lure (`observationHandling`).
3. **Over-scaffolding a strong model / under-scaffolding a weak one**: the SWAP arm exposes both directions.
4. **Batching a model cannot sustain**: `parallelCallCapability` gate on the parallel hint (needs the cogito arm that was never run).

## 7. Ranked improvements

Principle: "calibrate to measured behavior, not model name". Ordered by leverage and by how cleanly each is falsifiable.

1. **Make the trace answer the accountability question (G1, G3, G4, G5, G2/F2).** Cheapest, zero behavior change, prerequisite for everything else. Without it no lift cell is trustworthy. Owners: runtime-warden (G1, G2, G8, G9), provider-warden (G3), kernel-warden (G4, G5, G6).
2. **Fix F1 (`skip` bypass) at the boundary.** One decision: the calibration the kernel acts on is `input.calibration` (the resolved, provenance-bearing value) and `selectAdapter` stops loading JSON on its own. This also makes the learned and community tiers able to set `optimalToolResultChars`. Boundary fix, not a patch at the third site (feedback_boundary_first). Owner: kernel-warden + provider-warden.
3. **Replace the name-substring tier heuristic with a probed or declared signal, and delete the duplicate registry (V1, V2).** One arbiter: `Capability` (probe or static row). On a miss, the fallback should be a measurement (cheap probe) or an explicit "unknown" posture, not a regex on `qwen|llama|cogito|gemma`. Delete `MODEL_REGISTRY` in reactive-intelligence or derive it from `Capability`. Owner: kernel-warden (`profile-resolver.ts`), intelligence owner (`model-registry.ts`).
4. **Probe on first use for unseen models, with a bounded budget (F3, V3).** A lite measure-on-miss (the dialect probe and attention probe are the cheapest, a few turns each) written to the user cache the loader already reads (`~/.reactive-agents/calibrations/`). Spike first: count how many distinct models in real traces lack a calibration file (mimo-v2.6 419 runs, bonsai-2:27b 99, gemma4:latest 48, qwen3.5 60 in `~/.reactive-agents/traces` have none) and prototype zero-token before building. Gate by the section 6 test; default OFF until it passes.
5. **Fix the learned-tier confound before promoting it.** Record, per observation, the harness arm (act-or-answer mode, hint flags) the run ran under, and derive each field only from runs where the arm lets that field express itself (e.g. parallel capability only from runs with the hint on; stall rate only from runs with forcing off and no other rescue). Today the learned tier would turn cogito:8b's `proactive` (A/B-proven) into `off`. Owner: runtime-warden + intelligence owner. Gate: the learned arm of the section 6 test.

Also noted, lower priority: remove or wire the dead measured fields (F6) rather than keep probing them; v3 priors stay held until a reader and a lift exist.

## Not proven / limits

- No live LLM cell was run; every behavioral claim is from code and recorded traces.
- The trace corpora are mostly experiment arms with `RA_ACT_OR_ANSWER=0`, so "never `calibration` source" reflects both the default and the arm design. The code default (`actOrAnswerMode()` false) independently confirms it.
- I did not verify the cogito:8b thinking-flag row; the 7200 vs 1200 `maxTokens` split is attributed to `supportsThinkingMode` by code reading plus the gemma capability row.
- Drift detection (inventory row 16) and the `packages/tools`, `packages/judgment` model-name grep were not covered.
- F1 and F2 are from reading; neither has a failing test written. A zero-token test (`selectAdapter` called with `calibration:"skip"` in a runner harness) would confirm F1.
