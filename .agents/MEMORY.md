# Reactive Agents Build Memory

## Feedback
- [No Co-Authored-By lines in commits](feedback_no_coauthor.md) — never add Claude co-author trailers; shows publicly on GitHub contributors page
- [Commit before branching](feedback_commit_before_branch.md) — always commit/stash exploratory changes before creating feature branches
- [Keep .agents/MEMORY.md in sync](feedback_agents_memory_sync.md) — update both Claude memory AND `.agents/MEMORY.md` so other AI agents have context

## Projects
- [Project Dispatch](project_dispatch.md) — NL automation builder product, separate repo, Elysia + Svelte + SQLite
- [Composable Strategy Architecture](project_composable_strategies.md) — V1.1: strategies as composable capabilities, not exclusive modes

## Current Status (Mar 27, 2026)
- **v0.8.x → pre-V1.0** — 22 packages + 2 apps, ~2,995 tests across 345 files
- **V1.0 Harness Optimization** — merged to main (2026-03-26/27)
  - Native function calling replaces text-based ACTION: parsing
  - ToolCallResolver + NativeFCStrategy in `@reactive-agents/tools`
  - ProviderCapabilities on all 6 providers
  - Message-thread kernel: `state.messages[]` as primary LLM conversation interface
  - Sliding window compaction: tier-adaptive (local=2, mid=3, large=5, frontier=8 turns)
  - Provider adapters: model-tier-specific behavior hooks (continuationHint, systemPromptPatch)
  - Auto strategy routing: local/mid tier → plan-execute-reflect for multi-step tool tasks
  - Prompt caching: Anthropic explicit cache_control, OpenAI automatic, Gemini automatic
  - Specs: `docs/superpowers/specs/2026-03-26-v1-harness-optimization-design.md`, `2026-03-27-message-thread-kernel-design.md`
  - Results: Anthropic 35/35 (100%), 897 avg tok/task (-15%), cogito:14b completes multi-step tasks
- **Task-category entropy calibration** — merged (from stashed changes)
  - Per-category entropy weights, EXPECTED_TOOL_RANGE, task classifier taxonomy
- **Conductor's Suite** — merged
- **Living Intelligence System** — merged

## Critical Build Patterns
- See [build-patterns.md](build-patterns.md) for tsconfig, package.json, and Effect-TS patterns
- Starlight + Bun: Must use `legacy: { collections: true }` in astro.config.mjs
- Gemini SDK: `@google/genai` (v1+), NOT `@google/generative-ai` (legacy)
- Gemini provider uses `import()` not `require()` for lazy SDK loading
- **Native FC**: All providers must pass `tools` to both `complete()` AND `stream()` methods
- **Anthropic streaming**: Use raw `streamEvent` not helper events (inputJson fires before contentBlock)
- **Gemini tool results**: `functionResponse.name` must be actual tool name, not "tool"

## Architecture (Post V1.0 Harness Optimization)
- **Two independent records**: `state.messages[]` (LLM sees) + `state.steps[]` (observability reads)
- **ToolCallResolver**: bridges LLM response → structured tool calls via NativeFCStrategy
- **Provider Adapters**: `ProviderAdapter` interface with `continuationHint` + `systemPromptPatch` hooks
- **Strategy routing**: `recommendStrategyForTier()` auto-routes local/mid to plan-execute for multi-step
- **Text-based fallback**: Still exists behind `useNativeFunctionCalling` flag for mock LLMs in tests

## V1.0 Roadmap
- [V1.0 Roadmap](project_v1_roadmap.md) — P0: skill learning loop, messaging gateway, hero experience, sub-agent fixes
- [Platform Adapters](project_platform_adapters.md) — Runtime-agnostic layer: DatabaseAdapter, ProcessAdapter, ServerAdapter

## Post-V1.0 Roadmap
- Phase 5: Evolutionary Intelligence (`@reactive-agents/evolution`, v1.1+)
- [Composable Strategy Architecture](project_composable_strategies.md) — strategies as capabilities not modes
- Spec: `spec/docs/09-ROADMAP.md`

## Telemetry
- [Telemetry enrichment gaps](project_telemetry_gaps.md) — 4 known gaps

## Archive
Historical memories (completed work, patterns captured in code): [MEMORY-ARCHIVE.md](MEMORY-ARCHIVE.md)
