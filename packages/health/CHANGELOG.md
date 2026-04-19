# @reactive-agents/health

## 0.9.1

## 0.9.0

### Patch Changes

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
