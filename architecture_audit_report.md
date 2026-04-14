# Architecture Audit Report — Apr 14, 2026

**Scope:** Full monorepo (25 packages + 2 apps)
**Methodology:** Three-dimensional analysis — architecture health, documentation accuracy, simplification opportunities

---

## Phase 1: Known Debt Verification

| Debt item | Status | Finding |
|-----------|--------|---------|
| ~690 LOC dead text-assembly code in `context-engine.ts` | ✅ **RESOLVED** | File is now 191 LOC. `buildDynamicContext`, scoring helpers, dead fields all removed (Apr 13 overhaul). Only `buildStaticContext`, `buildEnvironmentContext`, `buildRules` remain — all live and actively called. |
| `buildDynamicContext`/`buildStaticContext` behind flags | ✅ **RESOLVED** | `buildDynamicContext` deleted. `buildStaticContext` is now the only entry point, actively used. |
| 5/7 provider adapter hooks unwired | ✅ **RESOLVED** | All 7 hooks wired: `systemPromptPatch` (think.ts:168), `toolGuidance` (act.ts), `taskFraming` (act.ts), `continuationHint` (think.ts:673), `errorRecovery` (act.ts:498+649), `synthesisPrompt` (act.ts:773), `qualityCheck` (think.ts:727). No separate `provider-adapters/` directory — hooks live in `@reactive-agents/llm-provider` with `selectAdapter()`. |
| `KernelState.meta` untyped bag | ❌ **STILL OPEN** | `meta: Readonly<Record<string, unknown>>` — 34 `as any` casts in kernel phases. |
| Strategy routing for local models disabled | ✅ **RESOLVED** | Strategy routing is implemented via 5 registered strategies + `StrategySelector` in execution engine. No commented-out routing found. |

---

## Agent 1: Architecture Health

### Layer Violations

| Finding | File | Risk |
|---------|------|------|
| `reasoning` imports `@reactive-agents/prompts` | [service-utils.ts](file:///home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/reasoning/src/strategies/kernel/utils/service-utils.ts#L11) | **Medium** — reasoning's declared deps are core, llm-provider, memory, tools. This is outside boundary. |

**No upward imports found.** No packages import from `@reactive-agents/runtime` or `reactive-agents` facade upward. ✅

### Untyped `as any` Casts

| Location | Count | Primary cause |
|----------|-------|---------------|
| Kernel phases + utils (`strategies/kernel/`) | 34 | `state.meta.entropy as any`, `state.meta.controllerDecisions as any`, `input.contextProfile as any` |
| `message-window.ts` | 9 | `KernelMessage` type narrowing bypassed via casts |
| `execution-engine.ts` | 55 | `memoryContext as any`, `modelConfig as any`, `event as any`, `obs as any` mutation |
| `context-manager.ts` | 1 | `availableToolSchemas as any` |
| `reflexion.ts` | 1 | `critiqueResponse as any` |
| **Total across reasoning** | **44** | — |
| **Total across runtime** | **135** | — |

> [!IMPORTANT]
> `execution-engine.ts` at **4,054 LOC** is the single largest file in the codebase with **55 `as any` casts** and **135 total across the runtime package**. This is the #1 coupling hotspot.

### Scope Creep

| File | LOC | Problem | Risk |
|------|-----|---------|------|
| [execution-engine.ts](file:///home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/runtime/src/execution-engine.ts) | 4,054 | Monolithic file handling 10+ phases, tool classification, skill resolution, telemetry, memory flush, verification — all inline | **High** |
| [builder.ts](file:///home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/runtime/src/builder.ts) | 4,835 | Single builder file with all 30+ `with*()` methods | **Medium** |
| [tool-utils.ts](file:///home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/reasoning/src/strategies/kernel/utils/tool-utils.ts) | 944 | 5+ concerns: formatting, parsing, gating, injection, planning | **Medium** |
| [think.ts](file:///home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/reasoning/src/strategies/kernel/phases/think.ts) | 997 | System prompt assembly, LLM streaming, FC parsing, fast-path, loop detection, oracle, termination | **Medium** |
| [act.ts](file:///home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/reasoning/src/strategies/kernel/phases/act.ts) | 870 | Tool dispatch, meta-tools, adapter hooks, tool-call parsing, final-answer | **Medium** |

### Dead / Disabled Systems

| Item | File | Evidence | Risk |
|------|------|----------|------|
| `ContextManager.build()` | [context-manager.ts](file:///home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/reasoning/src/context/context-manager.ts) (253 LOC) | Only imported in `context-builder.ts` (comment ref), `index.ts` (barrel), and test file. Zero production callers. | **Medium** |
| `evidence-grounding.ts` | [evidence-grounding.ts](file:///home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/reasoning/src/strategies/kernel/utils/evidence-grounding.ts) (112 LOC) | Zero production callers — only imported by test file | **Low** |
| `context-utils.ts` | [context-utils.ts](file:///home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/reasoning/src/strategies/kernel/utils/context-utils.ts) (240 LOC) | Zero `src/` imports — only re-exported from barrel, used in tests | **Low** |

### Coupling Hotspots

| File | Concern |
|------|---------|
| `kernel-runner.ts` (1,108 LOC) | Imported by strategies and tightly coupled to 15 utilities |
| `tool-utils.ts` (944 LOC) | Imported by 16+ files across kernel phases and utils |
| `kernel-state.ts` (639 LOC) | Core types used by every kernel file |

---

## Agent 2: Documentation Accuracy

### AGENTS.md Issues

| Claim | Problem | Severity |
|-------|---------|----------|
| Package dependency tree lists 22 packages | **Missing 3 packages**: `@reactive-agents/health`, `@reactive-agents/reactive-intelligence`, `@reactive-agents/react/vue/svelte` (web hooks), totaling 25 actual packages | **High** |
| "22 publishable packages" (line 372) | Actually 25 packages (or more). `health` and `reactive-intelligence` are both used by `runtime` | **High** |
| Per-Layer Quick Reference table | Missing entries for `health`, `reactive-intelligence`, `react`, `vue`, `svelte` | **Medium** |
| Architecture Audit skill's Quick Reference says "10 phases: BOOTSTRAP → GUARDRAIL → STRATEGY-SELECT → THINK → ACT → OBSERVE → MEMORY-FLUSH → VERIFY → AUDIT → COMPLETE" | Actual phases in execution-engine.ts are: BOOTSTRAP(1) → GUARDRAIL(2) → COST_ROUTE(3) → STRATEGY_SELECT(4) → AGENT_LOOP(5, contains THINK/ACT/OBSERVE inline) → VERIFY(6) → MEMORY_FLUSH(7) → COST_TRACK(8) → AUDIT(9) → COMPLETE(10). THINK/ACT/OBSERVE are **not** standalone phases — they're sub-loops inside the AGENT_LOOP phase | **Medium** |
| Skills index lists `harness-improvement-loop` skill in MEMORY.md but it's not in AGENTS.md skill index | Skill exists at `.agents/skills/harness-improvement-loop/` but isn't listed | **Low** |

### MEMORY.md Issues

| Section | Problem | Severity |
|---------|---------|----------|
| "Architecture (Post Apr 3 Refactor)" section, line 164 | Lists `utils/ (19 files)` but actual directory has **20 files** (including `.gitkeep`) | **Low** |
| Provider adapter hooks section (line 184-186) | Says "`selectAdapter(capabilities, tier)` picks adapter by tier" but actual signature is `selectAdapter(capabilities, tier, modelId?)` — 3 params | **Low** |
| Architecture Debt item #3 (line 242) | Claims "ContextManager.build() is dead production code (only tests call it)" — **confirmed still accurate** | ✅ |
| Architecture Debt item #5 (line 244) | Claims "ReActKernelInput duplicates ~25 fields from KernelInput… phases use `as ReActKernelInput` casts" — **confirmed**: 5 `as ReActKernelInput` casts found | ✅ |

### context-builder.ts Header

The file header at [context-builder.ts](file:///home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/reasoning/src/strategies/kernel/phases/context-builder.ts) says it handles "what will the LLM see this turn" but the system prompt assembly (with guidance/ICS/progress) is actually done in `think.ts`. Already flagged in debt register as "Open".

---

## Agent 3: Simplification Opportunities

### Top 3

| # | File | Problem | Effort | Impact |
|---|------|---------|--------|--------|
| **1** | `execution-engine.ts` (4,054 LOC) | Monolithic god-file with 10 phases, 55 `as any` casts, inline tool classification, skill resolution, memory flush, verification, telemetry — all in one `Effect.gen`. Extract phases to individual files like the kernel did. | **High** | **High** |
| **2** | `state.meta: Record<string, unknown>` | 34+ `as any` casts across kernel. Replace with typed discriminated union or branded sub-records (`meta.entropy: EntropyMeta`, `meta.controller: ControllerMeta`, etc.). | **Medium** | **High** |
| **3** | `ReActKernelInput` / `KernelInput` duplication | ~25 duplicated fields. Phases use `as ReActKernelInput` to access extras. Make `ReActKernelInput extends KernelInput` or merge into one type. | **Medium** | **High** |

### Additional Simplification Candidates

| File | Problem | Effort | Impact |
|------|---------|--------|--------|
| `tool-utils.ts` (944 LOC) | 5+ concerns: formatting, parsing, gating, injection, planning. Split into `tool-formatting.ts`, `tool-parsing.ts`, `tool-gating.ts`. | Medium | Medium |
| `context-manager.ts` + `context-builder.ts` | Two parallel context assembly systems. `ContextManager.build()` was built (Apr 13) but never wired to production. Either wire it or delete it. | Medium | High |
| `kernel/index.ts` barrel | `export *` from 13 modules leaks internal utils as public API. Replace with explicit named exports. | Low | Medium |
| `evidence-grounding.ts` + `context-utils.ts` | Dead production code (only tests import). Either delete or wire to production paths. | Low | Low |

---

## Phase 3: Triage

### Fix Immediately (< 25 lines, ≤ 2 files)

None of the findings qualify for immediate safe fixes — all documentation inaccuracies involve structural changes to the package tree that should be verified first and require additions to a complex structured table. I recommend addressing them together in the next docs pass, but they're all factual corrections that don't need planning.

### Flag for Planning

All findings are categorized in the **Architecture Debt Register** update below.

### Escalate to User

> [!CAUTION]
> **4 decisions need your input:**

1. **`ContextManager.build()` — wire or delete?** 253 LOC, 13 tests, built Apr 13, never wired to production. `think.ts` still does its own context assembly. The original intent was to migrate system prompt assembly into `ContextManager`, but that Phase 5 work was deferred. Do we commit to finishing the migration, or delete `context-manager.ts` and keep `think.ts` as the authority?

2. **`execution-engine.ts` decomposition — prioritize?** At 4,054 LOC with 55 `as any` casts, this is the biggest tech debt item. The kernel successfully decomposed via the Apr 3 composable phase refactor. Should `execution-engine.ts` get the same treatment (Phase-per-file extraction)?

3. **`state.meta` typed replacement — API-breaking?** Typing `meta` properly touches every kernel consumer. Is it better to do a clean break (one major version), or incrementally add typed accessors while maintaining the bag?

4. **`@reactive-agents/prompts` import from reasoning** — is this dependency intentional? `service-utils.ts` imports `PromptService` from prompts, which is outside reasoning's declared boundary. Should prompts be added to reasoning's allowed deps, or should the usage be refactored?

---

## Updated Architecture Debt Register

| Area | File | Problem | Effort | Impact | Status |
|------|------|---------|--------|--------|--------|
| Dead code | `context-engine.ts` | `buildDynamicContext`, scoring helpers, dead fields | — | — | ✅ Fixed (Apr 13) |
| Dead config | `context-profile.ts` | `promptVerbosity`, `rulesComplexity`, etc. inert | — | — | ✅ Fixed (Apr 13) |
| Dead config | `kernel-state.ts` | `synthesisConfig` naming misleading | Low | Low | Open |
| Dead API | `message-window.ts` | `applyMessageWindow` + `contextBudgetPercent` unused | — | — | ✅ Fixed (Apr 13) |
| Parallel systems | `think.ts` / `tool-utils.ts` / `act.ts` | Two overlapping result presentations | High | High | Partially addressed |
| Config duplication | `kernel-runner.ts` / `context-profile.ts` | `toolResultMaxChars` duplicates `resultCompression.budget` | Low | Low | Open |
| Stale docs | `context-engine.ts` | File header said "scoring, budgeting, rendering" | — | — | ✅ Fixed (Apr 13) |
| Stale docs | `context-builder.ts` | Header overstates scope | Low | Low | Open |
| Parallel context | `context-manager.ts` / `context-builder.ts` | Two context assembly paths; `ContextManager.build()` dead in production | Medium | High | Open — **Escalated** |
| Type duplication | `kernel-state.ts` | `ReActKernelInput` duplicates ~25 fields from `KernelInput` | Medium | High | Open |
| Untyped meta | `kernel-state.ts` | `state.meta: Record<string, unknown>` → 34+ `as any` casts | Medium | High | Open — **Escalated** |
| Layer violation | `service-utils.ts` | `reasoning` imports `@reactive-agents/prompts` | Medium | Medium | Open — **Escalated** |
| Scope creep | `tool-utils.ts` | 944 LOC, 5+ concerns, imported by 16 files | Medium | Medium | Open |
| Dead code | `context-manager.ts` | `ContextManager.build()` et al. never called in production | Medium | Medium | Open |
| Dead code | `evidence-grounding.ts` | Zero production callers | Low | Low | Open |
| Dead code | `context-utils.ts` | Zero `src/` imports — tests only | Low | Medium | Open |
| Barrel leak | `kernel/index.ts` | `export *` leaks internal utils as public API | Medium | Medium | Open |
| Loop vs switch | `loop-detector.ts` / `kernel-runner.ts` | Loop streak logic may mask patterns preventing strategy switching | Medium | Medium | Open |
| **NEW: Missing docs** | `AGENTS.md` | Package tree missing `health`, `reactive-intelligence`, `react`, `vue`, `svelte` (3 → 25 total) | Low | High | Open |
| **NEW: Scope creep** | `execution-engine.ts` | **4,054 LOC god-file** with 55 `as any` casts, 10+ phases inline | High | High | Open — **Escalated** |
| **NEW: `as any` debt** | `execution-engine.ts` | 55 `as any` casts — `memoryContext`, `modelConfig`, `event`, `obs` mutation | Medium | High | Open |
| **NEW: `as any` debt** | `message-window.ts` | 9 `as any` casts for `KernelMessage` type narrowing | Low | Medium | Open |

---

## Summary

- **Known debt resolved:** 4/5 items (context-engine cleanup, adapter hooks, strategy routing, dead flags)
- **`as any` hotspots:** 44 in reasoning, 135 in runtime, 179+ across the monorepo source files (excluding tests)
- **Documentation gaps:** AGENTS.md missing 3 packages (`health`, `reactive-intelligence`, web hooks) from dependency tree
- **#1 simplification opportunity:** `execution-engine.ts` (4,054 LOC) — decompose into phase-per-file like the kernel refactor
- **#2 simplification opportunity:** `state.meta` typed replacement (34+ `as any` casts eliminated)
- **#3 simplification opportunity:** Merge `ReActKernelInput` into `KernelInput` (5 cast sites eliminated)
- **4 escalations** requiring user decision before action
