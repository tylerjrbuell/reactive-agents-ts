# Reactive Agents Build Memory

## Feedback
- [No Co-Authored-By lines in commits](feedback_no_coauthor.md) — never add Claude co-author trailers; shows publicly on GitHub contributors page
- [Commit before branching](feedback_commit_before_branch.md) — always commit/stash exploratory changes before creating feature branches
- [Keep .agents/MEMORY.md in sync](feedback_agents_memory_sync.md) — update both Claude memory AND `.agents/MEMORY.md` so other AI agents have context
- [Skip plans for content/skill writing](feedback_skip_plans_for_content.md) — don't write formal implementation plans for SKILL.md or doc writing tasks; implement directly

## Projects
- [Project Dispatch](project_dispatch.md) — NL automation builder product, separate repo, Elysia + Svelte + SQLite
- [Composable Strategy Architecture](project_composable_strategies.md) — V1.1: strategies as composable capabilities, not exclusive modes
- [Composable Provider Adapters](project_composable_adapters.md) — V1.1 DONE in v0.8.5: all 7 hooks implemented
- [Composable Reasoning Phases](project_composable_phases.md) — ✅ SHIPPED Apr 3, 2026: `strategies/kernel/` composable phase architecture merged to main

## Current Status (Apr 10, 2026)
- **Harness Reliability Engineering Complete** — all phases from plan.md implemented: tier classification, expert strategy efficiency, output quality gates, checkpoint meta-tool, tier-adaptive kernel guards, terminal execution, calibration drift detection
- **Terminal execution tool integrated** — `.withTerminalTools()` builder method + shell-execute registered with security allowlist/blocklist
- **Calibration drift infrastructure wired** — `subscribeCalibrationUpdates()` initialized in runtime layer, emits CalibrationDrift events via EventBus when model entropy behavior shifts
- **AGENTS.md updated** — snapshot now includes terminal execution + calibration drift in recently shipped highlights
- **Production-ready**: all 9 kernel guards + oracle + context pressure gates now tier-aware; tier-specific behavior: local models exit sooner (conservative), frontier models get more iterations (bounded)

## What Shipped Apr 10, 2026

### Harness Reliability & Efficiency Hardening (Plan.md Phases 1-9)
- **Phase 1 - Tier Classification** ✅: gemini-2.5-flash resolves to "large" tier via PROVIDER_TIER_PATTERNS prefix matching
- **Phase 2 - Expert Strategy Efficiency** ✅: ToT tier budgets (6-12 iterations) + stagnation convergence; assembleDeliverable strips ToT prefixes
- **Phase 3 - Output Quality Gate** ✅: task-intent extraction → format validation → synthesis repair pipeline; all kernel exits route through single `finalizeOutput()` path
- **Phase 4 - Checkpoint Meta-Tool** ✅: auto-checkpoint integrated before context compaction; survives across window boundaries
- **Phase 5 - Tier-Adaptive Kernel** ✅: entropy thresholds, token deltas, context pressure gates all scale by tier (local/mid/large/frontier)
- **Phase 6 - Terminal Execution** ✅: shell-execute tool with security allowlist (git, ls, cat, grep, find, node, bun, npm, python, curl, echo, mkdir, cp, mv, wc, head, tail, sort, jq)
  - New builder method: `.withTerminalTools()` or `.withTools({ terminal: true })`
  - Files: `packages/runtime/src/builder.ts` (method + imports), `packages/runtime/src/agent-config.ts` (config), `packages/runtime/tests/builder-terminal-tools.test.ts` (3/3 tests pass)
- **Phase 7 - Calibration System** ✅: drift detection infrastructure complete + wired to runtime
  - New: `packages/reactive-intelligence/src/sensor/calibration-update-subscriber.ts` (listens TaskCompleted, emits CalibrationDrift on drift)
  - Wiring: `subscribeCalibrationUpdates()` initialized in `createReactiveIntelligenceLayer()`
  - Tests: `packages/reactive-intelligence/tests/calibration-drift.test.ts` (3/3 pass) — drift detection, event emission verified
  - Files: `packages/reactive-intelligence/src/runtime.ts` (Layer initialization), `packages/reactive-intelligence/src/index.ts` (export)
- **Phase 8 - Recall Audit** ✅: verified recall=true in meta-tools defaults; propagates to FC schemas
- **Phase 9 - Docs** ✅: harness-control-flow.md + local-model-performance.md accurate; AGENTS.md updated with shipped capabilities

### Implementation Summary
- **Files Modified**: 7 (builder.ts, agent-config.ts, runtime.ts, index.ts, AGENTS.md + 2 new source files + 2 new test files)
- **Tests Added**: 6 new tests, all passing (builder-terminal-tools: 3/3, calibration-drift: 3/3)
- **Code Quality**: Effect-TS patterns, TypeScript verified, security enforced, documentation synchronized

## Current Status (Apr 8, 2026)
- **v0.9.0 docs canonicalization pass** — `AGENTS.md` is canonical; `CLAUDE.md` reduced to compatibility pointer
- **Documentation workflow upgraded** — `update-docs` skill now explicitly includes `.agents/MEMORY.md` + repo memory updates and audits all 13 project skills in `.agents/skills/`
- **`harness-improvement-loop` skill added** — runs instrumented agent probes (5 probe types, debug verbosity, JSONL output), analyzes real runtime output against expected harness behavior, produces accumulating improvement reports; fix phase delegated to `agent-tdd`
- **Governance docs synchronized** — root/cortex AGENTS, spec `DOCUMENT_INDEX.md`, contributing guide, and reasoning guide aligned with latest changelog behaviors
- **Preparing for Show HN** — architecture solid, DX polished

## What Shipped Apr 8, 2026

### Documentation and Guidance Consolidation
- `CLAUDE.md` converted to compatibility pointer only; no duplicate operational truth
- `AGENTS.md` now includes current v0.9.0 snapshot + recent shipped highlights and explicit docs cross-reference rules
- `docs/spec/docs/DOCUMENT_INDEX.md` rewritten to reflect canonical docs + modern reading order
- `apps/docs/src/content/docs/guides/contributing.md` updated with current test counts and AGENTS-first doc policy
- `apps/docs/src/content/docs/guides/reasoning.md` expanded with required-tools gate hardening and native FC text JSON fallback behavior

## What Shipped Apr 7, 2026

### MCP Client Production Hardening
- `packages/tools/src/mcp/mcp-client.ts` rewritten on `@modelcontextprotocol/sdk` (Client, StdioClientTransport, StreamableHTTPClientTransport, SSEClientTransport)
- **Two docker MCP patterns**: (A) stdio MCP — reads JSON-RPC from stdin (GitHub MCP, filesystem); (B) HTTP-only — starts HTTP server, ignores stdin (mcp/context7)
- **Smart auto-detection**: stdio connect races against HTTP URL detection in stderr; when HTTP wins, client switches to port-mapped HTTP mode automatically
- **`docker rm -f` is the ONLY reliable container stop** — `subprocess.kill()` leaves the container running; Docker daemon keeps it alive independently
- **Two-phase docker containers**: probe `rax-probe-<name>-<pid>` (initial stdio attempt), managed `rax-mcp-<name>-<pid>` (port-mapped HTTP); PID ensures no conflicts between concurrent agents
- Transport auto-inferred: `command` → `"stdio"`, endpoint `/mcp` → `"streamable-http"`, other endpoint → `"sse"`
- `transport` field is now optional in `MCPServerConfig`, `runtime.ts`, `agent-config.ts`
- `cleanupMcpTransport(serverName)` calls `docker rm -f <containerName>` then `transport.close()`; called by Cortex DELETE and agent dispose
- Cortex: `parseConfigBody` + `expandMcpConfigsFromJson` handle Cursor/Claude JSON mcpServers shapes
- Full test coverage: 27 mcp-client tests in tools package, 29 tests in Cortex mcp-config-import + api-mcp-servers

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
