# Architecture Sweep 2026-07-07 — 05-tool-calling-governance

## Findings (ranked by leverage)

1. **`requiredTools` is structurally the visibility floor in ≥3 independent sites** — not one. The 2026-07-07 regression (tool-schemas.ts:180-191) only patched ONE of them. Required tools are force-re-added in: runtime adaptive filter (`tool-schemas.ts:166,179`), runtime builtins opt-in (`tool-schemas.ts:102`), and kernel prune `classifiedRequired` (`think.ts:375-183`, `computePromptSchemas` at think.ts:164-184). Any filter that prunes visibility silently leans on requiredTools to protect tools. `builtins:[...]` needed its own explicit floor (tool-schemas.ts:189-191) precisely because it wasn't coupled to requiredTools. This coupling is implicit and undocumented — the exact failure mode the audit flags.

2. **Visibility is computed in 4 sequential, overlapping sites across 2 packages** with no single authority: runtime `prepareReasoningToolSchemas` (5 stages, tool-schemas.ts:78-224) → kernel `computePromptSchemas` (think.ts:137-197) → `buildToolSchemas` gate-narrowing (context-utils.ts:166-186) → `pressureCritical` narrowing (think.ts:346-363). Then a SEPARATE execution gate re-decides callability (act.ts:355-377). Prime Tool-Surface-Compiler candidate.

3. **`ToolService.execute` never enforces `requiresApproval` or `riskLevel`** (tool-service.ts:319-409) despite JSDoc `@throws ToolAuthorizationError if execution not approved` (tool-service.ts:67). Both are dead metadata at the service layer. Only enforcement is the kernel HITL gate, and only in `mode:"detach"` (act.ts:230).

4. **Batch execution path is a ~155-line inline reimplementation** of the canonical `executeToolAndObserve` primitive (act.ts:608-760 vs tool-observe.ts). They have already drifted: verifier+memory are **unconditional** on batch (act.ts:699,735) but **env-gated** (`RA_TOOL_OBSERVE_SYMMETRY`) on single (act.ts:156,878).

5. **One dead classification function**: `inferRequiredTools` (infer-required-tools.ts:123) has zero live callers — exported and imported into execution-engine.ts:21 but never invoked. Redundant with `classifyToolRelevance`.

6. **Arg/name healing runs in 3-4 uncoordinated layers** (see Healing section) — `normalizeToolCallArguments` + `runHealingPipeline` (6 stages) + `resolveToolArgs` JSON repair, with the pipeline itself re-run up to 3× per call.

## Tool-surface concept census (concept → defined → applied → precedence)

Two pipelines. **Runtime** builds `input.availableToolSchemas`; **kernel think.ts** re-prunes it per iteration; **act.ts** gates execution.

| Concept | Defined | Applied | Precedence |
|---|---|---|---|
| builtins opt-in | config.builtins | tool-schemas.ts:91-108 removes `BUILTIN_TOOL_NAMES` unless opted; allowed+required always re-added | Runtime stage 1. `builtins:true`=all; array = floor at :189 |
| focusedTools | config → effectiveFocusedTools | tool-schemas.ts:144-147 prompt-only filter (execution NOT blocked) | Runtime stage 3a; wins over allowedTools for visibility |
| allowedTools (visibility) | config.allowedTools | tool-schemas.ts:148-151 prompt filter | Runtime stage 3b (only if no focused) |
| allowedTools (hard exec gate) | input.allowedTools | act.ts:355-377 blocks non-listed (META bypass) | Execution, before guards |
| adaptive filtering | config.adaptiveToolFiltering + >10 tools | tool-schemas.ts:159-206 uses classified relevant ∪ required ∪ ALWAYS_INCLUDE ∪ builtins-array | Runtime stage 4; only if reduces & ≥2 remain |
| relevantTools (classified) | classifier.ts output → input.relevantTools | adaptive filter (:171) + think prune (:181) | feeds both runtime & kernel prunes |
| requiredTools | classifier / config / nominated | floor in adaptive (:179), builtins (:102), prune (:179), gate-narrow (:181); hard gate act.ts:410-419 | **implicit floor everywhere** (finding 1) |
| forbiddenTools | config.forbiddenTools (TaskContract) | tool-schemas.ts:217-222 excludes from schemas+names | Runtime stage 5, LAST — wins over required/ALWAYS_INCLUDE |
| lazy disclosure (RA_LAZY_TOOLS) | env, default-on | tool-capabilities.ts:128-145 registers `discover-tools`; think.ts:360-399 visible = required∪relevant∪**used**∪**discovered**∪allowed∪meta | Kernel, per-iteration; `discoveredToolsStoreRef` reset per run |
| classification prune | hasClassification + >15 tools | computePromptSchemas think.ts:174-184 (non-lazy arm) | Kernel; allowedTools=FLOOR, never-prune-to-meta-only guard :191-195 |
| pressureCritical (final-answer-only) | think.ts:102-110,346 | narrows effectiveSchemas to final-answer only when **!lazyMode** & no missing-required (think.ts:361) | Kernel; suppressed under lazy (default) |
| gateBlockedTools | think-guards.ts:147-161 writes meta | buildToolSchemas context-utils.ts:173-184 narrows to missingRequired+meta | Kernel, in buildToolSchemas (post-prune) |
| META floors | kernel-constants META_TOOLS/INTROSPECTION | survive every prune (think.ts:172,182; guard.ts:84); bypass exec gate (act.ts:358) | Universal floor |
| contract tool sets | TaskContract forbidden/required | forbidden→tool-schemas.ts:217; required→classifier | forbidden LAST-wins; required as floor |

Precedence summary (visibility): forbidden > (focused|allowed) > adaptive-reduce, with {required, META, allowed, builtins-array, used, discovered} as additive floors. Callability (act.ts) is decided *separately*: allowedTools hard gate → guards → final-answer gate.

## Classification pass inventory (+ cost)

Per agent run:
- **1 LLM classification pass**: `classifyToolRelevance` via `classifyTools` (pre-loop-dispatch.ts:135 → classifier.ts:153). Gated by `wantsClassification` (classifier.ts:98-103) AND `classifierReliability` not low/skip. Cost: one round-trip; skipped→literal-mention fallback (classifier.ts:111-140).
- **0-LLM heuristics** (3): `nominateRequiredTools` keyword-cue (runner.ts:252, seeds `meta.nominatedTools`, consumed by guard.ts:49-51 as required floor when caller declared none); `extractOutputFormat` regex (tool-schemas.ts:119); `filterToolsByRelevance` keyword fallback (tool-schemas.ts:175).
- **DEAD**: `inferRequiredTools` — 0 live callers (finding 5). Redundant.
- **Recurring LLM cost is NOT classification**: `extractObservationFacts` (tool-execution.ts:835) fires **one LLM call per successful non-meta tool result** when `shouldExtract` (act.ts:147-148: obsMode true, or local/mid tier). This dwarfs the single classify pass over a multi-iteration run.

Redundancy: nominate (heuristic required) + classify (LLM required) + literal-mention (fallback required) all produce "required" via different mechanisms, merged incidentally through `input.requiredTools`/`meta.nominatedTools`. Three producers, no single resolver.

## Execution path divergences

- **Single-call**: act.ts:843 `executeToolAndObserve` (canonical primitive, tool-observe.ts). Heals upstream once (act.ts:328), passes `healed` flag. Verifier+memory OMITTED unless `RA_TOOL_OBSERVE_SYMMETRY=1` (act.ts:878-889).
- **Batch (≥2 planned)**: act.ts:608-760 INLINE `Effect.all` — re-implements emitLog, `executeNativeToolCall`, errorRecovery, fact-extraction, obsStep, compose-tags. Does NOT call the primitive. Verifier (act.ts:699) + memory (via `memoryService` in executeNativeToolCall, act.ts:618) are **unconditional**. Re-heals each member (act.ts:531).
- **plan-execute**: primitive with `heal` config (internal heal) + `preprocess` sanitize (tool-observe.ts:176-214).
- **Phase E asymmetry (noted in prompt)**: batch tool-results were invisible to `.on()` until E1 added unconditional `emitToCompose("observation.tool-result")` at act.ts:735. Single path always emitted via primitive (tool-observe.ts:349). Verification symmetry still split (batch always / single env-gated) — E2 incomplete.

**Guard census** (guard.ts): `blockedGuard`, `availableToolGuard` (the "not available in this run" hard-fail, isGuardHardFailure act.ts:84), `duplicateGuard`, `sideEffectGuard`, `repetitionGuard`, `metaToolDedupGuard` — run via `checkToolCall(defaultGuards)` **before dispatch** in BOTH single (act.ts:768) and batch (act.ts:524). Guards NOT in that pipeline but acting as gates: allowedTools exec-gate (act.ts:356, *before* guards), final-answer hard gate (act.ts:410, arbitration), HITL approval gate (act.ts:230), `request_user_input` pause (act.ts:262). Arbitration (arbitrator.ts) only decides final-answer success, not per-call blocking.

## Governance gaps

1. **`requiresApproval`/`riskLevel` unenforced by ToolService** (tool-service.ts:319-409): execute = lookup→validate→cache→sandbox→event. No auth step. JSDoc lies (tool-service.ts:67). riskLevel used only as `listTools` filter (tool-registry.ts:60-62).
2. **Approval only in kernel + only "detach"**: act.ts:230 gates `approvalPolicy.mode==="detach"` via `shouldGate` (tool-gating.ts:51). Runtime folds per-tool `requiresApproval` into `policy.tools` (tool-gating.ts docstring:36-41) — so the flag IS reachable, but ONLY through the kernel act path in detach mode. Direct `ToolService.execute` (plan-execute, non-kernel callers) bypasses approval entirely.
3. **file-root**: enforced in file handlers + healing path resolution (act.ts:190-201 `getFileRoot()`), correctly sandbox-aware. This one is solid.
4. **sandbox**: `makeSandbox` = timeout only (tool-service.ts:371-377); Docker opt-in for code-execute (code-execution.ts:148). No default filesystem/network isolation.
5. Batch approval OK — gate runs on `normalizedPendingCalls` before the batch/single split (act.ts:231), covering both. But still detach-only.

## Better shape (keep/merge/delete)

**Tool Surface Compiler** — one pure resolver `resolve(config, task, classification, state) → {visible, callable, required, floors, reasons: Map<tool, why>}`:
- **Merge into it**: `prepareReasoningToolSchemas` (5 stages), `computePromptSchemas`, `buildToolSchemas` gate-narrowing, `pressureCritical` narrowing, act.ts allowedTools exec-gate. One explicit precedence chain replaces 4 sequential filter sites across 2 packages.
- **Keep** every concept (all earn their place empirically) but make each a labeled rule with a reason string — kills the "which floor saved this tool" guessing that caused the regression.
- **Make explicit**: `required` as a first-class floor input, decoupled from visibility side-effects. Today it's 3 incidental re-adds.
- **Delete**: `inferRequiredTools` (dead). Collapse nominate+classify+literal-mention into the compiler's `required` producer with priority order.

**One execution pipeline**:
- **Keep** `executeToolAndObserve` (tool-observe.ts) as THE primitive.
- **Delete** the act.ts:608-760 inline batch block; call the primitive per member inside `Effect.all`. This auto-fixes the verifier/memory single-vs-batch asymmetry and the Phase-E visibility split.
- **Collapse healing**: one heal site. Fold `normalizeToolCallArguments` (act.ts:88, ad-hoc web-search/http-get) and `resolveToolArgs` JSON-repair (tool-execution.ts:396) into `runHealingPipeline` stages so calls heal exactly once.

**Governance**: move approval/riskLevel enforcement INTO `ToolService.execute` (the choke every path shares) so plan-execute and direct callers can't bypass; keep the kernel HITL gate as the durable-pause UX layer on top.

## Signals worth exploiting

- `runner.ts` already emits `meta.nominatedTools` same-commit with its guard.ts:49 consumer — the pattern the compiler should generalize (producer+consumer+reason together).
- `HealingResult.actions[]` (healing-pipeline.ts:81) already records every repair — a ready-made per-call "why healed" audit stream; surface it as the compiler's reason substrate.
- `RA_TOOL_OBSERVE_SYMMETRY` (act.ts:156) + `RA_LAZY_TOOLS` + `RA_CURATION_AGEAWARE` are existing killswitch seams — the compiler/pipeline merge can ride the same opt-out idiom for safe A/B.
- `discoveredToolsStoreRef` + `state.toolsUsed` already give the compiler live "expand visible set" inputs (think.ts:387) — lazy disclosure is a working proof the compiler's `visible ≠ callable` split is sound.
- `ToolNotFoundError.availableTools` (tool-execution.ts:752) + `availableToolGuard` suggestion (guard.ts:91-96) duplicate the same "did-you-mean" logic — consolidate into the compiler's reason output.

Key files: act.ts (execution orchestrator + gates), tool-observe.ts (canonical primitive), tool-execution.ts (core + arg-repair + fact-extract), guard.ts (6 guards), tool-schemas.ts (runtime 5-stage visibility), classifier.ts (the 1 LLM pass), think.ts:137-399 (kernel per-iteration prune), context-utils.ts:166-186 (gate-narrow), tool-service.ts:319-409 (governance gap), healing-pipeline.ts (6-stage heal), tool-gating.ts:51 (shouldGate).