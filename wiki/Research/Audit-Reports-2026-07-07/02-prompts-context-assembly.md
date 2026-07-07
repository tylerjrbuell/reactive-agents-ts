# Architecture Sweep 2026-07-07 — 02-prompts-context-assembly

Evidence complete. Here is the audit.

## Findings (ranked by leverage)

**F1 — Two full prompt-assembly systems; one is dead but still shipped/exported/maintained.** The kernel think phase assembles prompts exclusively through `buildThinkProviderRequest` (think.ts:246) → `project()` (assembly/project.ts:47), a 5-stage pipeline. The entire APC/ContextManager stack — `ContextManager.build` (context-manager.ts:109), `buildIterationSystemPrompt` (:212), `composePrompt`/`PromptSectionRegistry`/`DEFAULT_SECTIONS` (prompt-composer.ts, prompt-sections-default.ts), and `buildConversationMessages` (context-utils.ts:241) — has **no live caller**. Confirmed: `defaultContextCurator` + `curate()` were deleted (index.ts:128; context/index.ts:25), and the only `ContextManager.build(` references are docstrings/comments. This is ~1,200 lines of sophisticated, commented, test-backed code (APC-2/3/4, shape-gating, section registry) that never runs in production. Massive maintenance-signal hazard: an auditor reading context-manager.ts/prompt-sections-default.ts would reasonably believe that's the prompt.

**F2 — Harness guidance is assembled then dropped in the live path.** think.ts:435–458 builds a full `GuidanceContext` (requiredToolsPending, loopDetected, icsGuidance, oracleGuidance, errorRecovery, actReminder, qualityGateHint, evidenceGap), reads+clears `state.pendingGuidance` (:432–434), even runs the `nudge.loop-detected` pipeline transform (:445–457) — and then the `guidance` variable is **never used again**. It is not passed to `buildThinkProviderRequest` (:496) or `project()`. The assembly stages contain zero `guidance`/`icsGuidance`/`actReminder` references. Rendering guidance into the system prompt was ContextManager's job (guidanceSection, prompt-sections-default.ts:247) — which is dead (F1). Unless act/observe phases separately inject these as user messages, harness steering signals are computed and discarded every iteration. Highest-leverage correctness item.

**F3 — Goal text duplicated every prompt.** Same `project()` run emits the goal twice: `Goal: ${goal}` appended to the system prompt (system-prompt.ts:61) AND `{role:"user", content: goal}` as messages[0] (project-results.ts:37). Both sourced from `log.byKind("goal")`. This is the previously-measured Goal-block duplication — verified, still present, structural (not iteration-dependent).

**F4 — Tool-result cap table duplicated across two owners; drift risk + documented resolution path points at the dead one.** `CONTEXT_PROFILES[tier].toolResultMaxChars` (context-profile.ts:81/98/107/115: 4000/1200/800/600) and `TIER_TOOL_RESULT_PRESERVE` (capability.ts:42: identical 4000/1200/800/600) are the same constants maintained in two places; capability.ts:24 admits it "Mirrors" the legacy table. The live render cap is `capability.toolResultPreserveBudget` (project-results.ts:88). But context-profile.ts:28–31 documents the resolution order as "input.resultCompression.budget → profile.toolResultMaxChars → 800" citing runner.ts:509/tool-execution.ts:571 — that path governs tool-execution *storage* compression, a different budget than the assembly *render* cap. Two budgets, two owners, one documented pointer aimed at the storage side.

## Prompt assembly census (site → what it builds → duplication)

LIVE:
- **Kernel think / `project()`** — assembly/project.ts:47; stages: `systemPromptStage` (Environment + persona `buildSystemPrompt` + `buildToolReference` + `Goal:` line + remaining-steps + optional RULES; system-prompt.ts:51–68), `selectToolsStage`, `projectResultsStage` (builds the whole message thread + per-result full/preview+ref; project-results.ts), `compactHistoryStage`, `finalizeStage`. Then think.ts:608–611 suffixes `driverInstructions` + `rationaleInstructions` → `systemPromptWithDriver`.
- **Harness skill injection** — think.ts:402–410: `${harnessContent}\n\n${input.systemPrompt}` gated on `isNonTrivial && (brief||pulse)`; then `harnessPipeline.transform('prompt.system')` (:412–421).
- **finalize synthesis gate** — finalize.ts:118 `enforceQualityGate` → `buildSynthesisPrompt` (output-synthesis.ts:217) as user msg, `systemPrompt: withEnvContext(undefined)` (:152).
- **plan-execute** — planning (:227/:279), analysis (:448 `withEnvContext`), reflect (:845), synthesis (:1086). Plus plan-prompts.ts builders: `buildPlanGenerationPrompt` (:236), `buildStepExecutionPrompt` (:368), `buildReflectionPrompt` (:414), `buildPatchPrompt` (:317), `buildAugmentPrompt` (:461).
- **blueprint** — planning (:214), synthesis (:513).
- **reflexion** — gen (:186), critique (:332), improve (:480), execution-agent literal (:594).
- **tree-of-thought** — expansion (:360 `withEnvContext`), scoring (:423/:458), execute (:683).
- **adaptive** — classify (:169).
- **code-action** — generate (:123/:252 `withEnvContext`).
- **direct** — passes `input.systemPrompt` raw (:139).
- **runtime setup classifier** — setup/classifier.ts:166 forwards `config.systemPrompt` to `classifyToolRelevance` (no full assembly).

**~11 independent live assemblies** + 5 plan-prompts builders. Duplications:
- "You are a synthesizer. Combine execution results into a clear, concise final answer. Exclude all internal agent metadata." — verbatim in plan-execute.ts:1088 AND blueprint.ts:515.
- "You are a planning agent. Decompose the goal into…" — near-dup plan-execute:228/280, blueprint:215.
- Environment block re-derived at every strategy sub-call via `withEnvContext` (plan-execute:448, tot:360, code-action:123, finalize:152) in addition to `systemPromptStage:54`.
- Persona literals: 17 `You are a…` strings across strategies (plan-execute 7, blueprint 4, reflexion 3, tot 2, adaptive 1) — no shared persona source.

DEAD (exported from index.ts, not called): `ContextManager`, `composePrompt`, `PromptSectionRegistry`, `DEFAULT_SECTIONS`/`makeDefaultSectionRegistry`, `buildIterationSystemPrompt`, `buildConversationMessages` + its chain (`applyMessageWindowWithCompact` message-window.ts, `applyAgeAwareCuration`/`curationAgeAware` tool-formatting.ts, `applyOverhaulContextProjection` overhaul/context-projection.ts), `buildStaticContext` wrapper (context-engine.ts:108 — but its primitives `buildEnvironmentContext`/`buildToolReference`/`buildRules` ARE live via system-prompt.ts:3). RA_MINIMAL_PROMPT escape hatch (context-manager.ts:226) is dead with its host.

## Cache-hostility notes

- **Prefix order is env-first, dynamic-middle.** systemPromptStage order = Environment → persona → tools → `Goal:` → remaining (system-prompt.ts:54–62). Environment (with `Date`) is the FIRST block, so the daily date rotation invalidates the *entire* cached prefix once/day; any custom `environmentContext` field mutation (threaded from state, from-kernel-state.ts:146) busts everything. context-engine.ts:29–48 documents this and defaults time precision to "date" to protect the prefix — but `RA_ENV_TIME_PRECISION=minute|second` reintroduces per-call invalidation of the whole prompt.
- **Tool block mutates per iteration.** The lazy-tools curator prunes `promptSchemas` per iteration (think.ts:387–399, computePromptSchemas), and `final-answer`/`abstain`/`request_user_input` are conditionally injected (think.ts:316–331). Because the tool reference sits mid-prompt, every change to the visible tool set invalidates the cache prefix from the tools block onward each iteration.
- **`Goal:` is stable but sits after tools** — so it can't rescue the prefix once tools mutate.
- **Good:** think.ts suffixes driver+rationale instructions LAST (:608–611); those are static-ish and correctly placed. Anthropic prompt-caching is provider-side (anthropic.ts:140 comment) — the assembly makes no explicit `cache_control` breakpoint decision; it relies on prefix stability it partially undermines.
- **No stable/dynamic partition exists in `project()`** — there is no "stable prefix section vs curated dynamic section" boundary; the pipeline concatenates everything with `\n` (system-prompt.ts:66).

## Preview/fullResult leak sites

- **projectResultsStage** (project-results.ts:86–99) is the honesty layer: latest result gets `recencyBudgetChars`, older results get `toolResultPreserveBudget`; overflow → `store.preview(ref, budget)` (structure-aware, footer with ref, result-store.ts:73–110), fit → full. Full data stays in `ResultStore` recoverable via `write_result_to_file(result_ref=…)`. This is the correct FM#3 mitigation and it works for the *rendered thread*.
- **Leak surface — finalize/synthesis reads a different source.** `collectToolData` (finalize.ts:95–103) harvests raw `tool_result` content **from `KernelMessage[]`**, not from the ResultStore. Those messages are the *pre-projection* kernel thread (full content or the compressed inline form written at execution time), NOT the assembly's preview+ref projection. So synthesis can receive either (a) already-compressed previews if execution-time compression fired (context-profile.ts toolResultMaxChars path), or (b) full raw data — a different duality than what the LLM saw in-thread. The synthesis prompt then splices `rawForSynthesis` directly (output-synthesis.ts:256). This is the classic preview-vs-real-data split: the model that produced the draft saw preview+ref (project-results.ts), but the synthesis pass sees `collectToolData`'s separately-harvested content. Two harvest paths, no shared projection.
- **scaffold-leak detector** (finalize.ts:69, `detectScaffoldLeak`) exists precisely because previews/markers leak into final answers — confirms the duality is a live failure mode being patched downstream rather than prevented at one projection point.
- **compactHistoryStage** (compact-history.ts) bulk-truncates by dropping half the thread and inserting `[history compacted: N earlier messages summarized]` (:17) — a *pointer with no content and no ref*, unlike project-results' preview+ref. Dropped tool results here are unrecoverable in-thread (no ref surfaced), so a stored key that scrolls out becomes unrecallable (think.ts:520–544 recall-gate comment corroborates).

## Better shape (keep/merge/delete)

Keep (live substrate to build the one pipeline on):
- **`project()` staged pipeline** (assembly/project.ts) — this IS the single pipeline; formalize it as canonical.
- **`ResultStore` + preview/materialize/summarize** (result-store.ts) — the single honest projection primitive; make it the *sole* tool-result harvest source (fix F-leak by routing finalize.collectToolData through the store).
- **`ResolvedCapability` tiering** (capability.ts) — the live per-tier shaper.
- Env/tool/rules primitives in context-engine.ts (buildEnvironmentContext/buildToolReference/buildRules) — reused by system-prompt.ts.

Merge:
- Fold the harness **guidance** render into a `project()` stage (new `guidanceStage` consuming GuidanceContext) so F2 is fixed and there's one place signals become prompt text. Thread `guidance` through `buildThinkProviderRequest`.
- Collapse the two tier tables (F4): delete `CONTEXT_PROFILES.toolResultMaxChars` OR `TIER_TOOL_RESULT_PRESERVE`, single source in capability.ts, have profile reference it.
- Extract a shared persona/synthesizer/planner literal module; the "You are a synthesizer…" and "You are a planning agent…" strings should be one constant each (kills plan-execute↔blueprint dup).
- Make Environment a *stable* leading block (date only by default already) and move goal/tools to a clearly-delimited dynamic tail so a cache breakpoint can be placed between them.

Delete (dead weight, drift/mislead risk):
- context-manager.ts (`ContextManager`, `buildIterationSystemPrompt`, RA_MINIMAL_PROMPT), prompt-composer.ts, prompt-sections-default.ts (all of APC-2/3/4), the dead `buildConversationMessages` chain in context-utils.ts + message-window.ts + overhaul/context-projection.ts (if confirmed unused outside the dead caller) + `buildStaticContext` wrapper. Their APC-0 evidence/shape-gating lessons should migrate as predicates on `project()` stages, not as a parallel system.

## Signals worth exploiting

- `AssemblyTrace` (assembly/trace.ts, `pushStage`/`recordMessage`) already records per-stage byte deltas and per-result `projection: "full"|"preview+ref"` (project-results.ts:104) — a ready-made instrument to measure cache-prefix stability and preview ratios per iteration. `RA_ASSEMBLY_DEBUG=1` (think.ts:505) and `RA_PROMPT_DUMP` (:511) dump the exact assembled prompt for diffing.
- `TaskShape` (classifyTask, used at context-manager.ts:271) and `isHighConfidenceTrivial` (prompt-sections-default.ts:102) are the shape-gating predicates already validated by APC-0 — reusable as `project()` stage gates without the dead host.
- `ContextProfile.thinkingModel` (context-profile.ts:66) and the tier `toolSchemaDetail`/`toolResultPreserveBudget` are the existing per-tier levers; the token-budget shaping at think.ts:616–627 (tierMaxTokens + thinkingAllowance) is the only per-tier output-budget decision and is hardcoded inline — candidate to move onto the profile.
- Calibration (`ModelCalibration.steeringCompliance`, `observationHandling`, `systemPromptAttention`) is read at context-manager.ts:121 (dead) and setup/tool-schemas.ts:121 (live) — the steering-channel decision is currently stranded in dead code; wiring it into the new guidanceStage would revive per-model steering shaping.

Note: F2 (guidance dropped) is asserted from the assembly-side evidence (no guidance reference in project()/stages and the unused `guidance` var post-think.ts:458). I did not exhaustively verify that act/observe phases don't inject these signals as user messages elsewhere — that's the one claim to confirm before acting, and it's the highest-value one.