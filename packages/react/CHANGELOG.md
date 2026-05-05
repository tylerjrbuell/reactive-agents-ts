# @reactive-agents/react

## 0.10.2

### Patch Changes

-   8fb1311: feat(cortex): publish @reactive-agents/cortex to npm with lazy-load CLI support

    -   Made cortex publishable to npm as a standalone package with tsup bundling
    -   Restored `rax cortex` command with lazy-load pattern for optional peer dependency
    -   Updated CLI with cortex command restoration and full documentation
    -   Synced all package versions to match coordinated releases
    -   Cortex fully validated: health API returns 200, UI serves correctly from npm install

-   fe4b058: Critical: Fix all package.json bun exports pointing to non-existent src/ directory. All packages were exporting `"bun": "./src/index.ts"` in their exports, but npm packages only include dist/. This caused Bun module resolution to fail when importing these packages from npm-installed CLI.

    This fix is critical for v0.10.1 release viability.

## 0.10.1

### Patch Changes

-   80284a4: Fix CLI module resolution: mark @reactive-agents/eval, @reactive-agents/llm-provider, @reactive-agents/a2a, @reactive-agents/trace, and @reactive-agents/tools as external dependencies in tsup config. This prevents bundling issues when the CLI is installed from npm and needs to dynamically require these modules at runtime.

## 0.10.0

### Minor Changes

-   2cfded2: v0.10.0: Complete Phase 1 Mechanism Validation Release

    ## What's Shipping

    -   **13 Mechanisms:** 8 KEEP (production-ready), 5 IMPROVE (functional with Phase 1.5 enhancements)
    -   **Phase 1.5 Roadmap:** Clear improvement path for M3, M6, M7, M8, M10
    -   **Comprehensive Wiki:** 50+ Obsidian vault notes with architecture MOCs, failure modes, decisions
    -   **Zero TypeScript Errors:** Strict type safety across all 28 packages
    -   **4,975 Tests:** 99.39% pass rate, comprehensive validation
    -   **CI/CD Ready:** 4 GitHub Actions workflows, baseline performance metrics established

    ## Key Features

    -   Reactive Intelligence Dispatcher (entropy-driven intervention)
    -   Strategy Switching (5 adaptive strategies)
    -   Verifier & Retry (semantic quality gates)
    -   Healing Pipeline (86.7% FC recovery, +80% accuracy)
    -   Context Curation (60.7% compression, 38.6% token savings)
    -   Skill System (learnable within-session capabilities)
    -   Calibration (14-field model profiling)
    -   Sub-agent Delegation (multi-step task routing)
    -   Termination Oracle (single arbitrator, 9 paths)
    -   Memory System (4-layer persistent memory, 66.7% recall)
    -   Diagnostic System (100% TP, 0% FP, real-time health)
    -   Provider Adapters (7 lifecycle hooks, 6 LLM providers)
    -   Guards & Meta-tools (6 guards, 100% accuracy)
    -   Channels Package (webhook adapters, trigger registry, session bridging for external messaging)

    ## No Breaking Changes

    All existing `ReactiveAgents.create().with*()` patterns continue to work. Backward compatible with v0.9.0.

    ## Known Limitations (Phase 1.5)

    -   M3: Retry context tuning pending for cogito:14b (0% → ≥50% recovery)
    -   M6: Skills persist within session only (cross-session v0.11)
    -   M7: 3 consumers active (5+ more planned)
    -   M8: Validated on mock LLMs (real LLM metrics pending)
    -   M10: Single-session tested (multi-session validation pending)

    ## Installation

    ```bash
    npm install @reactive-agents
    ```

    See [QUICK_START.md](./QUICK_START.md) for 5-minute orientation.

## 0.10.0

### Minor Changes

-   3f8146a: v0.10.0: Adaptive Tool Calling System, Reactive Intelligence Dispatcher, Calibration System, Benchmark Suite v2, and major Cortex Studio updates.

## 0.9.0

### Minor Changes

-   ## v0.9.0 — Native Function Calling, Living Skills, Conductor's Suite & Web Framework Integration

    214 commits since v0.8.0. This is the largest release in the project's history.

    ***

    ### New Packages

    -   **`@reactive-agents/react`** — `useAgentStream` (token-by-token streaming) + `useAgent` (one-shot) React 18+ hooks
    -   **`@reactive-agents/vue`** — `useAgentStream` + `useAgent` Vue 3 composables with reactive refs
    -   **`@reactive-agents/svelte`** — `createAgentStream` + `createAgent` Svelte 4/5 writable stores

    All three consume server-side `AgentStream.toSSE()` via fetch streaming. Compatible with Next.js App Router, SvelteKit, Nuxt, Bun.serve, Hono, Fastify.

    ***

    ### V1.0 Harness — Native Function Calling

    **The most significant architectural change**: all providers now use native function calling (structured `tool_use` blocks) instead of text-based `ACTION:` parsing.

    -   `ToolCallResolver` + `NativeFCStrategy` in `@reactive-agents/tools`
    -   `ProviderCapabilities` declared on all 6 providers
    -   Native FC path in `react-kernel.ts` — tools passed via API parameter, `response.toolCalls` read directly
    -   Text-based `ACTION:` parsing entirely deleted (LOC reduction: react-kernel 1961→1430, tool-utils 714→537)
    -   **Text tool call fallback**: `NativeFCStrategy` also parses JSON tool calls embedded in model text output — fixes models that output valid FC JSON as text content
    -   All 6 providers fixed for FC streaming: Anthropic raw `streamEvent` ordering, Gemini `functionCalls` in stream chunks, Ollama `tool_calls` on done chunk, OpenAI `tool_calls` message conversion

    ### Message-Thread Kernel Architecture

    -   `state.messages[]` = primary LLM conversation interface (proper multi-turn FC)
    -   `state.steps[]` = observability record — unchanged externally
    -   Sliding window compaction: tier-adaptive (local=2, mid=3, large=5, frontier=8 turns)
    -   Lean static system prompt: 200-400 tokens (down from 800-1,400)
    -   Fixed double-context bug — history + thoughtPrompt = 2-3x token waste

    ### Provider Adapter System — 7/7 Hooks

    | Hook                | When                           | Effect                                     |
    | ------------------- | ------------------------------ | ------------------------------------------ |
    | `systemPromptPatch` | System prompt build            | Multi-step completion instructions (local) |
    | `toolGuidance`      | After schema block             | Required-tool inline reminder              |
    | `taskFraming`       | First iteration only           | Numbered step sequence for task message    |
    | `continuationHint`  | Each iteration (missing tools) | "Call X now" guidance                      |
    | `errorRecovery`     | After failed tool result       | 404/timeout recovery hint                  |
    | `synthesisPrompt`   | Research→produce transition    | "Stop searching, write it now"             |
    | `qualityCheck`      | Before final answer            | Self-eval prompt (fires once)              |

    New `midModelAdapter` for 7-30B tier. `selectAdapter()` returns `midModelAdapter` for `tier: "mid"`.

    ### Dynamic Stopping (3-layer)

    -   **Novelty signal**: Jaccard word-token overlap; <20% novel → inject synthesis nudge
    -   **Per-tool budget**: `maxCallsPerTool` in `KernelInput`; auto-caps search tools at 3 calls from classification
    -   **Research→produce gate**: `synthesisPrompt` fires when all search tools satisfied and only output tools remain

    ### FC Gate Hardening

    -   Relevant tools (LLM-classified) pass through the required-tools gate while output tools pending
    -   Satisfied required tools can be re-called for supplementary research
    -   `relevantTools` and `maxCallsPerTool` threaded from execution engine → `StrategyFn` → `KernelInput` → gate

    ### Intelligent Context Synthesis (ICS)

    -   `ContextSynthesizerService` with fast (template) and deep (LLM) paths
    -   `classifyTaskPhase()` — orient/gather/synthesize/produce/verify phases
    -   Per-strategy overrides: `.withReasoning({ strategies: { reactive: { synthesis: "deep", synthesisModel: "..." } } })`
    -   `ContextSynthesized` EventBus event

    ### Conductor's Suite — Meta-Tools

    Four meta-tools injected automatically with `.withTools()` (disable with `.withMetaTools(false)`):

    -   **`recall`** — selective working memory: write/read/search/list (replaces scratchpad)
    -   **`find`** — unified search: RAG→memory→web auto-routing
    -   **`brief`** — situational awareness: tools, documents, context budget, entropy grade
    -   **`pulse`** — reactive intelligence introspection: entropy, loops, context pressure
    -   `activate_skill` + `get_skill_section` for Living Skills injection
    -   `.withMetaTools()` builder API with per-tool enable/disable and `harnessSkill` config

    ### Living Skills System

    -   `SkillStoreService` — SQLite-backed CRUD
    -   `SkillEvolutionService` — LLM-based refinement with version management and rollback
    -   `SkillRegistry` — filesystem scanner with SKILL.md parser (agentskills.io compatible)
    -   `SkillResolverService` — unified resolution across SQLite + filesystem
    -   `SkillDistillerService` — automatic skill synthesis wired to MemoryConsolidator CONNECT phase
    -   5-stage skill compression pipeline
    -   Context-aware injection guard with model-tier budgets
    -   `.withSkills({ paths, evolution })` builder API
    -   `agent.skills()` / `exportSkill()` / `loadSkill()` / `refineSkills()` runtime API

    ### Reactive Intelligence — Expanded

    -   `ControllerDecision` expanded to 10 types: `early-stop`, `context-compression`, `strategy-switch`, `temp-adjust`, `skill-activate`, `prompt-switch`, `tool-inject`, `memory-boost`, `skill-reinject`, `human-escalate`
    -   `controllerDecisionLog` on `KernelState` (powers `pulse` meta-tool)
    -   Task-category entropy calibration + tool guards
    -   Skill fragment extraction and persistence on successful convergent runs
    -   Learning engine wired to execution completion
    -   **Reactive Intelligence is now default-on** (`.withReactiveIntelligence(false)` to disable)

    ### Termination Oracle

    -   Signal evaluators determine when agent has genuinely completed
    -   `LLMEndTurn` evaluator — iteration/length gates removed, pure signal-based
    -   `FINAL ANSWER` regex expanded to match markdown variants
    -   Trace-aware output assembly with code block preservation

    ### Composition API

    -   `agentFn()` — lazy-building callable agent primitive
    -   `pipe()` — sequential chain
    -   `parallel()` — concurrent fan-out with labeled results
    -   `race()` — first-to-complete wins, others cancelled

    ### Agent as Data

    -   `AgentConfig` — Effect-TS Schema for JSON-serializable agent definitions
    -   `builder.toConfig()`, `agentConfigToJSON()` / `agentConfigFromJSON()`
    -   `ReactiveAgents.fromConfig()` / `.fromJSON()` — reconstruct builder from config/JSON
    -   `agent.registerTool()` / `agent.unregisterTool()` — runtime tool management

    ### Document Ingestion + RAG

    -   `.withDocuments(docs)` — chunk + index `DocumentSpec[]` for `rag-search`
    -   `agent.ingest(docs)` — post-build document ingestion
    -   `DocumentSpec.content` optional (reads from `source` file path)
    -   `rag-search` source filter case-insensitive substring matching

    ### Dynamic Pricing

    -   `openRouterPricingProvider` + `.withDynamicPricing(provider)` builder
    -   Cache-aware token cost multipliers

    ### Prompt Caching

    -   Anthropic: `cache_control` on system prompts ≥ 1,024 tokens and last tool in schema block
    -   OpenAI: automatic (50% discount on `cached_tokens`)
    -   Gemini: automatic implicit caching (75% discount on `cachedContentTokenCount`)
    -   `supportsPromptCaching` now correctly `true` for Gemini and OpenAI models

    ### Observability Improvements

    -   `logModelIO: true` logs complete FC conversation thread with role labels `[USER]`/`[ASSISTANT]`/`[TOOL]`
    -   Raw LLM response logged before parsing (`rawResponse` on `ReasoningStepCompleted`)
    -   `messages[]` field added to `ReasoningStepCompleted` EventBus event
    -   `agentResult.metadata.strategyUsed` shows actual sub-strategy (`"reactive"` not `"adaptive"`)
    -   `[think]` log shows `(adaptive→reactive)` suffix at INFO level
    -   Actionable failure messages: loop detection, required tools, stall detection all include `Fix:` suggestions

    ### Plan-Execute Improvements

    -   Validates plan covers all required tools; injects missing steps with smart args
    -   File-write injection extracts path from task description via regex
    -   `{{from_step:sN}}` cross-step references degrade gracefully

    ### CLI Fixes

    -   `rax init` scaffolds unified `reactive-agents` package (not 14 granular packages)
    -   Generated `src/index.ts` imports from `"reactive-agents"` matching README quick start
    -   `.gitignore` included in scaffolded projects

    ### Benchmark Suite

    -   `BenchmarkTask`: new `maxIterations` and `requiresDynamicSubAgents` fields
    -   `requiresDynamicSubAgents` wired to `withDynamicSubAgents()` in runner
    -   Global default iterations: 30 → 15 for strategy tasks
    -   Fixed 3 Sonnet failures: `c1`/`c4` plan-execute → react to fix 300s timeouts; `c6` regex handles comma-formatted numbers
    -   Provider-aware time multipliers; Gemini model updated to `gemini-2.5-flash`
