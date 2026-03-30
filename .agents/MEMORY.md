# Reactive Agents Build Memory

## Feedback
- [No Co-Authored-By lines in commits](feedback_no_coauthor.md) — never add Claude co-author trailers; shows publicly on GitHub contributors page
- [Commit before branching](feedback_commit_before_branch.md) — always commit/stash exploratory changes before creating feature branches
- [Keep .agents/MEMORY.md in sync](feedback_agents_memory_sync.md) — update both Claude memory AND `.agents/MEMORY.md` so other AI agents have context

## Projects
- [Project Dispatch](project_dispatch.md) — NL automation builder product, separate repo, Elysia + Svelte + SQLite
- [Composable Strategy Architecture](project_composable_strategies.md) — V1.1: strategies as composable capabilities, not exclusive modes
- [Composable Provider Adapters](project_composable_adapters.md) — V1.1 DONE in v0.8.5: all 7 hooks implemented
- [Composable Reasoning Phases](project_composable_phases.md) — V1.1: explicit phase pipeline (plan/execute/verify/reflect/terminate), strategies become presets

## Current Status (Mar 29, 2026)
- **v0.8.5+ in progress** — 22 packages + 2 apps, 3,036 tests across 350 files (3036 pass, 30 skip, 0 fail)
- **Harness quality controls shipped** — 6 new builder methods for execution quality and reliability
- **Preparing for Show HN** — architecture solid, DX polished, local model reliability improved

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
- Session resumption in bootstrap — prior debrief + active plan surfaced into memCtx

### Kernel Hooks Fix
- `ToolCallCompleted` no longer emitted for system observations (completion-guard redirects)
- Eliminates "unknown" tool name from metrics dashboard
- Debug-level `Effect.logDebug` still fires for troubleshooting visibility

## What Shipped v0.8.5 (Mar 28, 2026)

### Gate Hardening & Dynamic Stopping
- Relevant tools pass through gate even when required tools pending
- Satisfied required tools can be re-called for supplementary research  
- Per-tool call budget auto-set to 3 for search tools from classification results
- Novelty signal (Jaccard word-token overlap): <20% novel → inject synthesis nudge
- `computeNoveltyRatio()` in tool-utils — pure math, no LLM call

### Text Tool Call Fallback (NativeFCStrategy)
- Parse JSON tool calls from model text output (fenced or bare JSON)
- Validates against available tools, normalizes underscore→hyphen
- Supports 4+ JSON schemas; native toolCalls always take priority

### Provider Adapter Hooks — ALL 7 COMPLETE
- taskFraming, toolGuidance, continuationHint, errorRecovery, synthesisPrompt, qualityCheck, systemPromptPatch
- midModelAdapter: lighter guidance for 7-30B models
- selectAdapter() returns midModelAdapter for tier="mid"
- All hooks wired in react-kernel.ts at correct call sites

### Observability & DX
- logModelIO: full FC conversation thread with role labels [USER]/[ASSISTANT]/[TOOL]
- Raw response logged before parsing; messages[] on ReasoningStepCompleted event
- strategyUsed shows actual sub-strategy (e.g. "reactive" not "adaptive")
- [think] log shows "(adaptive→reactive)" suffix at INFO level
- Actionable failure messages: loop detection + required tools + stall detection all include Fix: suggestions

### CLI & Web Framework
- rax init: uses unified "reactive-agents" package (not 14 granular packages)
- @reactive-agents/react: useAgentStream + useAgent hooks
- @reactive-agents/vue: useAgentStream + useAgent composables  
- @reactive-agents/svelte: createAgentStream + createAgent stores
- All consume AgentStream.toSSE() endpoints; compatible with Next.js, SvelteKit, Nuxt

## Architecture (v0.8.5) — CRITICAL PATTERNS

### Two Independent Records
```
state.messages[]  ← What LLM sees (proper multi-turn FC conversation thread)
state.steps[]     ← What systems observe (entropy, metrics, debrief) — unchanged
```

### Gate Logic (in priority order)
1. Pre-filter calls exceeding maxCallsPerTool budget
2. Required tools missing → allow only first missing required tool
3. Relevant tools OR satisfied required tools → allow through
4. Otherwise → blockedOptionalBatch: true (redirect message injected)

### Provider Adapter Hook Points (all 7)
- systemPromptPatch: at system prompt build time
- toolGuidance: appended after schema block in system prompt
- taskFraming: first iteration user message (iteration === 0)
- continuationHint: after each tool round in nudge message
- errorRecovery: appended to failed tool observation content
- synthesisPrompt: replaces progress message on research→produce transition
- qualityCheck: injected before final answer (gated by qualityCheckDone meta flag)

### Benchmark Results (Anthropic Sonnet 4)
- 35/35 (100%) consistently
- 897 avg tok/task (-15%), 42% fewer tokens on simple tasks
- Zero iteration explosions

## Critical Build Patterns
- **Native FC**: All providers pass `tools` to both `complete()` AND `stream()` methods
- **Loop detection**: `maxConsecutiveThoughts: 3` — nudge observations reset the counter
- **Compressed results in FC**: Strip `[STORED: key]` header → `[toolName result — compressed preview]`
- **adapter in handleActing**: must be re-computed via selectAdapter() — NOT inherited from handleThinking scope
- See [build-patterns.md](build-patterns.md) for tsconfig, package.json, Effect-TS patterns

## Architecture Debt (Remaining)
1. `react-kernel.ts` at ~1,650 LOC — benefits from splitting (FC path, guards, observations as separate modules)
2. cogito:14b still inconsistent on reactive strategy (8B works fine, 14B doesn't)
3. Benchmark: c6-multi-agent still fragile across providers
4. Provider adapter: 2 of 5 V1.1 composable hooks planned (full composable system deferred)

## Show HN Readiness
- ✅ Text tool call fallback for models that output JSON in text
- ✅ Gate hardening: relevant + satisfied-required tools pass through
- ✅ Dynamic stopping: novelty signal + per-tool budget
- ✅ Full prompt observability (logModelIO)
- ✅ Actionable failure messages with Fix: suggestions
- ✅ Adaptive strategy sub-strategy reporting
- ✅ rax init uses unified package
- ✅ React/Vue/Svelte web hooks
- ✅ Provider adapter 7/7 hooks
- 🔲 react-kernel.ts split (code quality for contributors)
- 🔲 Benchmark suite published results
- 🔲 Docs refresh (in progress)

## Post-v0.8.5 Roadmap
- [Composable Strategy Architecture](project_composable_strategies.md) — V1.1
- Phase 5: Evolutionary Intelligence (`@reactive-agents/evolution`, v1.1+)

## Archive
Historical memories (completed work, patterns): [MEMORY-ARCHIVE.md](MEMORY-ARCHIVE.md)
