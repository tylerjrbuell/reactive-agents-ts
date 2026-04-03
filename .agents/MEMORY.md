# Reactive Agents Build Memory

## Feedback
- [No Co-Authored-By lines in commits](feedback_no_coauthor.md) — never add Claude co-author trailers; shows publicly on GitHub contributors page
- [Commit before branching](feedback_commit_before_branch.md) — always commit/stash exploratory changes before creating feature branches
- [Keep .agents/MEMORY.md in sync](feedback_agents_memory_sync.md) — update both Claude memory AND `.agents/MEMORY.md` so other AI agents have context

## Projects
- [Project Dispatch](project_dispatch.md) — NL automation builder product, separate repo, Elysia + Svelte + SQLite
- [Composable Strategy Architecture](project_composable_strategies.md) — V1.1: strategies as composable capabilities, not exclusive modes
- [Composable Provider Adapters](project_composable_adapters.md) — V1.1 DONE in v0.8.5: all 7 hooks implemented
- [Composable Reasoning Phases](project_composable_phases.md) — ✅ SHIPPED Apr 3, 2026: `strategies/kernel/` composable phase architecture merged to main

## Current Status (Apr 3, 2026)
- **v0.8.5+ / kernel refactor merged** — 22 packages + 2 apps, 3,242 tests across 381 files (0 fail)
- **Kernel composable phase architecture shipped** — `strategies/kernel/` with `Phase[]` pipeline, `Guard[]` chain, `MetaToolHandler` registry, `makeKernel()` factory
- **Preparing for Show HN** — architecture solid, DX polished

## What Shipped Apr 3, 2026

### Kernel Composable Phase Architecture
- `strategies/shared/` renamed to `strategies/kernel/` — name describes what it is, not who uses it
- `react-kernel.ts` 1,700 → 197 lines; thin orchestrator + `makeKernel({ phases?: Phase[] })` factory
- `kernel-runner.ts` 612 → 339 lines; ICS, reactive observer, loop detector extracted to `utils/`
- **`kernel/phases/`** — four phase files, each answers one question:
  - `context-builder.ts` — what will the LLM see this turn? (pure data, no LLM calls)
  - `think.ts` — what did the LLM decide to do? (stream, FC parsing, fast-path, loop detection)
  - `guard.ts` — is this tool call allowed? (`Guard[]` pipeline, `checkToolCall(guards)`)
  - `act.ts` — what happened when tools ran? (`MetaToolHandler` registry, final-answer gate)
- **`kernel/utils/`** — 11 utility files + `ics-coordinator.ts`, `reactive-observer.ts`, `loop-detector.ts`
- `Phase` type: `(state: KernelState, context: KernelContext) => Effect<KernelState, never, LLMService>`
- `Guard` type: `(tc, state, input) => GuardOutcome` — strategies pass custom chains to `checkToolCall()`
- `MetaToolHandler` registry in `act.ts` — new inline meta-tools are one-line additions
- Spec: `docs/superpowers/specs/2026-03-30-kernel-refactor-design.md`

## What Shipped Mar 29, 2026

### Harness Quality Controls (6 new builder methods)
- `withMinIterations(n)` — blocks fast-path exit before N iterations
- `withVerificationStep({ mode: "reflect" })` — LLM self-review pass after initial answer
- `withOutputValidator(fn)` — structural validation with retry on failure (up to 2x by default)
- `withCustomTermination(fn)` — user-defined done predicate, re-runs until true (max 3x)
- `withProgressCheckpoint(n)` — checkpoint config stored; execution integration deferred to V1.1
- `withTaskContext(record)` — background data injected into reasoning memory context

### Memory Consolidation Improvements
- Date normalization in MemoryExtractor (Tier 1 + Tier 2 + heuristic fallback) — "yesterday" → ISO date
- Near-duplicate decay in MemoryConsolidatorLive Step 4 — SQL substr(content,1,40) matching

## Architecture (Post Apr 3 Refactor) — CRITICAL PATTERNS

### Kernel Directory Layout
```
strategies/kernel/
  kernel-state.ts      ← KernelState, Phase type, KernelContext, ThoughtKernel
  kernel-runner.ts     ← the loop (runKernel)
  kernel-hooks.ts      ← KernelHooks lifecycle hooks
  react-kernel.ts      ← makeKernel() + reactKernel + executeReActKernel
  phases/
    context-builder.ts ← pure data: buildSystemPrompt, toProviderMessage, buildConversationMessages, buildToolSchemas
    think.ts           ← LLM stream, FC parsing, loop detection, fast-path
    guard.ts           ← Guard[], defaultGuards, checkToolCall()
    act.ts             ← MetaToolHandler registry, final-answer gate, tool dispatch
  utils/
    ics-coordinator.ts, reactive-observer.ts, loop-detector.ts
    tool-utils.ts, tool-execution.ts, termination-oracle.ts, strategy-evaluator.ts
    stream-parser.ts (was thinking-utils), context-utils.ts, quality-utils.ts, service-utils.ts, step-utils.ts
```

### Two Independent Records (unchanged)
```
state.messages[]  ← What LLM sees (proper multi-turn FC conversation thread)
state.steps[]     ← What systems observe (entropy, metrics, debrief)
```

### Extending the Kernel
- **New phase**: add `phases/reflect.ts`, insert into `makeKernel({ phases: [..., reflect] })`
- **New guard**: add `Guard` fn to `guard.ts`, add to `defaultGuards[]`
- **New inline meta-tool**: add one entry to `metaToolRegistry` in `act.ts`
- **Custom kernel**: `makeKernel({ phases: [myThink, act] })`

### Provider Adapter Hook Points (all 7)
- systemPromptPatch, toolGuidance, taskFraming, continuationHint, errorRecovery, synthesisPrompt, qualityCheck
- `selectAdapter(capabilities, tier)` picks adapter by tier

## Critical Build Patterns
- **Native FC**: All providers pass `tools` to both `complete()` AND `stream()` methods
- **Anthropic streaming**: Use raw `streamEvent` not helper events (`inputJson` fires before `contentBlock`)
- **Gemini tool results**: `functionResponse.name` must use `msg.toolName` not hard-coded "tool"
- **Ollama streaming**: `chunk.message.tool_calls` on `chunk.done`, emit `tool_use_start` + `tool_use_delta`
- **Loop detection**: `maxConsecutiveThoughts: 3` — nudge observations reset the counter
- See [build-patterns.md](build-patterns.md) for tsconfig, package.json, Effect-TS patterns

## Architecture Debt (Remaining)
1. `buildDynamicContext`/`buildStaticContext` still in codebase behind flag (~560 LOC dead)
2. `context-engine.ts` has ~690 LOC mostly dead text-assembly functions
3. cogito:14b still inconsistent on reactive strategy (8B works fine, 14B doesn't)
4. Strategy routing disabled — no clean solution for local model multi-step tasks
5. Provider adapter: remaining 5 V1.1 composable hooks not yet wired into phases

## Show HN Readiness
- ✅ Kernel composable phase architecture (clean codebase for contributors)
- ✅ Text tool call fallback for models that output JSON in text
- ✅ Gate hardening: relevant + satisfied-required tools pass through
- ✅ Dynamic stopping: novelty signal + per-tool budget
- ✅ Full prompt observability (logModelIO)
- ✅ Actionable failure messages with Fix: suggestions
- ✅ Provider adapter 7/7 hooks
- ✅ React/Vue/Svelte web hooks
- 🔲 Benchmark suite published results
- 🔲 Docs refresh (in progress)

## Post-v0.8.5 Roadmap
- [Composable Strategy Architecture](project_composable_strategies.md) — V1.1
- Phase 5: Evolutionary Intelligence (`@reactive-agents/evolution`, v1.1+)

## Archive
Historical memories (completed work, patterns): [MEMORY-ARCHIVE.md](MEMORY-ARCHIVE.md)
