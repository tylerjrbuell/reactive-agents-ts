# Reactive Agents Build Memory

## Feedback
- [No Co-Authored-By lines in commits](feedback_no_coauthor.md) — never add Claude co-author trailers; shows publicly on GitHub contributors page
- [Commit before branching](feedback_commit_before_branch.md) — always commit/stash exploratory changes before creating feature branches
- [Keep .agents/MEMORY.md in sync](feedback_agents_memory_sync.md) — update both Claude memory AND `.agents/MEMORY.md` so other AI agents have context

## Projects
- [Project Dispatch](project_dispatch.md) — NL automation builder product, separate repo, Elysia + Svelte + SQLite
- [Composable Strategy Architecture](project_composable_strategies.md) — V1.1: strategies as composable capabilities, not exclusive modes
- [Composable Provider Adapters](project_composable_adapters.md) — V1.1: expand adapter from 2 to 7 lifecycle guidance hooks, entropy-driven

## Current Status (Mar 27, 2026)
- **v0.8.x → pre-V1.0** — 22 packages + 2 apps, ~2,995 tests across 345 files
- **186 commits unreleased since v0.8.0** — major architectural transformation complete but needs consolidation
- **5 GitHub stars** — underground, opportunity to clean architecture before adoption scales
- **Decision: NO rush release** — spend time on deep analysis and architectural cleanup first

## What Shipped This Session (Mar 27, 2026)

### V1.0 Harness Optimization (native FC migration)
- Native function calling replaces text-based ACTION: parsing across all providers
- ToolCallResolver + NativeFCStrategy in `@reactive-agents/tools`
- ProviderCapabilities on all 6 providers + `supportsPromptCaching`
- Anthropic stream() raw `streamEvent` fix (correct tool_use ordering)
- Ollama stream() tool_use events + Gemini toolName bug fixed
- Specs: `docs/superpowers/specs/2026-03-26-v1-harness-optimization-design.md`

### Message-Thread Kernel
- `state.messages[]` = primary LLM conversation interface (proper multi-turn FC)
- `state.steps[]` = observability record (entropy, metrics, debrief) — UNCHANGED
- Sliding window compaction in `packages/reasoning/src/context/message-window.ts`
- Tier-adaptive windows: local=2, mid=3, large=5, frontier=8 turns
- Lean static system prompt (200-400 tokens, down from 800-1,400)
- Fixed double-context bug (history + thoughtPrompt = 2-3x waste)
- Spec: `docs/superpowers/specs/2026-03-27-message-thread-kernel-design.md`

### Provider Adapter System (`packages/llm-provider/src/adapter.ts`)
- `ProviderAdapter` interface with `continuationHint` + `systemPromptPatch` hooks
- Default adapter: structured decision framework for ALL models ("You must still call: X. Call X now.")
- Local adapter: stronger guidance + multi-step completion instructions + system prompt patch
- `selectAdapter(capabilities, tier)` — picks adapter by tier
- `recommendStrategyForTier()` — DISABLED (reactive handles all tiers natively now)

### Reactive Strategy Fixed for All Models
- Structured decision framework in FC conversation thread (mirrors text-based ReAct binary choice)
- Progress summary after each tool execution: "You must still call: X"
- Completion message when all required tools called: "All required tools called. Synthesize and give final answer."
- Nudge observation injected on EVERY thinking iteration (not just empty responses)
- Fast-path gated by `hasRequiredTools` — won't exit before tools are used
- Loop detection fix: nudge observations reset consecutive-thought counter
- FC compressed format: `[toolName result — compressed preview]` not `[STORED: _tool_result_N]`

### Benchmark Fixes
- `e5-file-execute`: task prompt rewritten (code-execute/tmp + file-write/cwd was impossible)
- `m5-tool-search`: fast-path gated by required tools, now fires web-search first
- `c6-multi-agent`: unresolved `{{from_step:sN}}` degrades gracefully not hard-fail
- `plan-execute`: validates plan covers all required tools, injects missing steps with smart args
  - File-write injection extracts path from task description via regex
- Prompt caching: Anthropic cache_control, OpenAI automatic, Gemini automatic

## Architecture (Post Mar 27 Refactor) — CRITICAL PATTERNS

### Two Independent Records
```
state.messages[]  ← What LLM sees (proper multi-turn FC conversation thread)
state.steps[]     ← What systems observe (entropy, metrics, debrief) — unchanged
```

### FC Conversation Thread Flow
1. Execution engine seeds `state.messages` with `[{role:"user", content: task}]`
2. `handleThinking` reads messages → `applyMessageWindow` → provider LLM call
3. `handleActing` appends: `assistant(thought+toolCalls)` + `tool_result(s)` + progress/completion message
4. Text-based path still exists behind `useNativeFunctionCalling` flag (test mocks)

### Provider Adapter Hook Points
- V1.0: `continuationHint` (post-tool guidance), `systemPromptPatch` (system prompt)
- V1.1: taskFraming, toolGuidance, errorRecovery, synthesisPrompt, qualityCheck

### Benchmark Results (Anthropic Sonnet 4)
- **35/35 (100%)** consistently
- 897 avg tok/task (-15%), 42% fewer tokens on simple tasks
- Zero iteration explosions

## Critical Build Patterns
- **Native FC**: All providers pass `tools` to both `complete()` AND `stream()` methods
- **Anthropic streaming**: Use raw `streamEvent` not helper events (`inputJson` fires before `contentBlock`)
- **Gemini tool results**: `functionResponse.name` must use `msg.toolName` not hard-coded "tool"
- **Ollama streaming**: `chunk.message.tool_calls` on `chunk.done`, emit `tool_use_start` + `tool_use_delta`
- **Loop detection**: `maxConsecutiveThoughts: 3` — nudge observations reset the counter
- **Compressed results in FC**: Strip `[STORED: key]` header → `[toolName result — compressed preview]`
- See [build-patterns.md](build-patterns.md) for tsconfig, package.json, Effect-TS patterns

## Architecture Debt (FOR DEEP ANALYSIS NEXT SESSION)
1. `react-kernel.ts` grew to ~1,961 LOC — needs splitting (FC + text + guards = 3 separate concerns)
2. Two code paths coexist (FC + text-based) — text only needed for test mocks
3. `buildDynamicContext`/`buildStaticContext` still in codebase behind flag (~560 LOC dead)
4. `context-engine.ts` has ~690 LOC mostly dead text-assembly functions
5. Test mocks use `supportsToolCalling: false` — testing legacy path not real FC path
6. Provider adapter only has 2/7 planned hooks — composable system half-built
7. cogito:14b still inconsistent on reactive strategy (8B works fine, 14B doesn't)
8. Strategy routing disabled — no clean solution for local model multi-step tasks
9. Benchmark: e5-file-execute, c6-multi-agent still fragile across providers

## V1.0 Priorities (Next Steps)
- **START WITH**: Deep architectural analysis session (not implementation)
- Map what's dead weight, what's duplicated, what needs splitting
- Design clean V1.0 architecture → focused implementation plan
- [V1.0 Release Priorities](project_v1_priorities.md) — cleanup targets identified
- [V1.0 Roadmap](project_v1_roadmap.md) — P0: skill learning loop, messaging gateway, hero experience

## Post-V1.0 Roadmap
- [Composable Strategy Architecture](project_composable_strategies.md) — V1.1
- [Composable Provider Adapters](project_composable_adapters.md) — V1.1
- Phase 5: Evolutionary Intelligence (`@reactive-agents/evolution`, v1.1+)

## Telemetry
- [Telemetry enrichment gaps](project_telemetry_gaps.md) — 4 known gaps

## Archive
Historical memories (completed work, patterns): [MEMORY-ARCHIVE.md](MEMORY-ARCHIVE.md)
