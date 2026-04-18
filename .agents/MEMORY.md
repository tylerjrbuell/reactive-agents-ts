# Reactive Agents Build Memory

## Feedback
- [No Co-Authored-By lines in commits](feedback_no_coauthor.md) — never add Claude co-author trailers; shows publicly on GitHub contributors page
- [Commit before branching](feedback_commit_before_branch.md) — always commit/stash exploratory changes before creating feature branches
- [Keep .agents/MEMORY.md in sync](feedback_agents_memory_sync.md) — update both Claude memory AND `.agents/MEMORY.md` so other AI agents have context
- [Skip plans for content/skill writing](feedback_skip_plans_for_content.md) — don't write formal implementation plans for SKILL.md or doc writing tasks; implement directly
- [Clean types, no any](feedback_clean_types.md) — strict TypeScript required; no `any` casts, use `unknown` + guards or proper types

## Adaptive Calibration (Apr 2026)
- [Adaptive Harness Framework](project_adaptive_harness.md) — three-tier calibration, 24-task plan shipped on feat/adaptive-harness-framework

## Projects
- [Project Dispatch](project_dispatch.md) — NL automation builder product, separate repo, Elysia + Svelte + SQLite
- [Composable Strategy Architecture](project_composable_strategies.md) — V1.1: strategies as composable capabilities, not exclusive modes
- [Composable Provider Adapters](project_composable_adapters.md) — V1.1 DONE in v0.8.5: all 7 hooks implemented
- [Composable Reasoning Phases](project_composable_phases.md) — ✅ SHIPPED Apr 3, 2026: `strategies/kernel/` composable phase architecture merged to main

## V1.0 Readiness Audit (Apr 17, 2026)

Full 4-agent audit run. Architecture solid; gaps are wiring, DX, and trust. First-run UX: **6.5/10**.

### CRITICAL blockers
1. **Bun-only, zero docs** — `bun:sqlite`/`Bun.*` in published packages, no `engines` field. Node users: `ReferenceError: Bun is not defined`. Fix: add `"engines": {"bun":">=1.0"}` + prominent docs.
2. **`rax demo` is fake** — scripted responses, hardcoded token count (314), fake sleep padding. CLI says "live demo." Fix: use real provider or clearly label as example output.
3. **Sub-agent `maxIterations` silently capped at 3** — `agent-tool-adapter.ts:214-217`: `Math.min(userValue, 3)`. Builder docs say `.withDynamicSubAgents({ maxIterations: 8 })` works — it doesn't.
4. **`MAX_RECURSION_DEPTH = 3` not configurable** — `agent-tool-adapter.ts:6`. Deep agent hierarchies silently fail.
5. **Calibration defaults to `:memory:`** — `reactive-intelligence/types.ts:164`. Learning lost every restart. Should default to `.reactive-agents/calibration.db`.
6. **Observability OFF by default** — requires `.withObservability()`. Should be on by default.

### HIGH friction
- `rax init` hardcodes Anthropic — OpenAI/Ollama users fail on first `bun run dev`
- `FRAMEWORK_INDEX.md` ALL paths broken — `strategies/shared/*` → `strategies/kernel/*` (dir renamed Apr 3)
- `concepts/composable-kernel.md` — same stale paths, still describes pre-refactor architecture
- ~20 undocumented env vars (only 6 of 26 in README): `LLM_MAX_RETRIES`, `LLM_TIMEOUT_MS`, `TAVILY_API_KEY`, `CORTEX_URL`, `LITELLM_BASE_URL`, `OLLAMA_ENDPOINT` vs `OLLAMA_BASE` (duplicate)
- `effect` in `dependencies` not `peerDependencies` — dual-copy risk; move to peer
- Provider SDKs not declared as peer deps — `Cannot find module '@anthropic-ai/sdk'` with no hint
- `StatusRenderer` replaces Effect `Logger` with `Logger.none` on TTY — logs vanish silently
- Ollama default model `cogito:14b` — most users get silent 404; change to `llama3.2`
- Duplicate `AgentConfig` type (core skeletal vs runtime full) — autocomplete confusion
- `rax demo` circular dep — imports `reactive-agents` but not in CLI package.json deps

### Stale docs priority (5/5 = worst)
- `FRAMEWORK_INDEX.md` 5/5 — all kernel paths broken
- `concepts/composable-kernel.md` 5/5 — old import paths
- `ROADMAP.md` 5/5 — last updated Mar 11, lists shipped features as future
- `CONTRIBUTING.md` 5/5 — claims 15 packages / 283 tests
- `packages/reactive-agents/README.md` 5/5 — 14 packages, deprecated `withMemory("1")`

### Repo cleanup needed
Delete before v1.0: `test.ts` (46KB!), `main.ts`, `scratch.ts`, `scratch/`, `output.txt`, `harness-reports/`

## Current Status (Apr 17–18, 2026)
- **3 CLI built-in tools shipped** — `git-cli`, `gh-cli`, `gws-cli` in `@reactive-agents/tools`; brings capability tool count to **9** (webSearch, cryptoPrice, httpGet, fileRead, fileWrite, codeExecute, git-cli, gh-cli, gws-cli) alongside 8 meta-tools; injectable `CliRunner` type for testability; `ENOENT` produces human-readable error
- **Permanently-failed required tools fix** — `getEffectiveMissingRequiredTools()` excludes tools that were attempted but never succeeded; prevents loop-until-maxIterations on ENOENT/unavailable tools; fixes act.ts, guard.ts, kernel-runner.ts, lane-controller.ts
- **Tool pruning guard** — `PRUNE_MIN_TOOLS = 15` in think.ts; classification-based pruning only activates above 15 tools, preventing git-cli/etc. from being hidden on small tool sets
- **Sub-agent maxIterations un-capped** — removed `Math.min(userValue, 3)` from agent-tool-adapter.ts; user config honored
- **Turborepo integrated (Apr 18)** — serial `bun run --filter ... build` chain replaced with `turbo run build`; cold build 34s, warm rebuild **0.18s** (FULL TURBO, 28/28 cached). Root `turbo.json` + `apps/cortex/ui/turbo.json` override (SvelteKit outputs to `build/` + `.svelte-kit/`). Task order derived from package.json `dependencies` — no manual script chain to maintain.
- **False circular deps removed (Apr 18)** — turbo surfaced a cycle between `@reactive-agents/a2a` ↔ `@reactive-agents/tools`. Neither package's `src/` imports the other; the old serial chain masked it because tsup builds each package standalone. Removed `@reactive-agents/tools` from a2a's deps and `@reactive-agents/a2a` from tools' deps. **Publishing-behavior change**: consumers who installed either package no longer get the other auto-installed transitively. Needs a changeset before the next release (patch-level: declarations were wrong, no runtime behavior changed).
- **4,153 tests across 461 files** — 852/852 reasoning, 656/656 tools, all passing

## Current Status (Apr 13, 2026)
- **Context Engineering Overhaul complete** — dead code removed (`compaction.ts`, `context-budget.ts`, `buildDynamicContext`, `autoForwardSection`); `ContextManager` service introduced as deterministic context assembly authority; `steeringNudge` fully migrated to typed `PendingGuidance` → system prompt `Guidance:` section
- **Plan-Execute-Reflect fixes shipped** — planner decomposition, quantity enforcement, reflection augmentation, satisfaction override removal
- **Observation Quality Pipeline shipped** — FC recall hint preservation, storedKey threading, tier-adaptive compression, optional LLM extraction
- **Parallel/Sequential tool calling hardened** — infinite loop fix, sequential quantity clamping, softened required-tools nudge in sequential mode
- **3,879 tests across 430 files** — all passing, 0 regressions, build clean

## Current Status (Apr 12, 2026)
- **Pass 2 complete** — 18 probes (6 confirm + 12 wide), 18 pass / 5 fail, 0 regressions
- W2 + W4 confirmed with JSONL evidence; W6 (recovery nudges compound W2), W7 (ICS over-tool-classifies), W8 (strategy switching unreachable) newly discovered
- IC-1 (loop-detector.ts L94 one-line fix) and IC-2 (builder.ts withReasoning maxIter propagation) ready for agent-tdd handoff
- Coverage improved: 7 covered / 15 partial / 3 uncovered (was 8 uncovered in Pass 1)
- Report: `harness-reports/improvement-report-20260412-2.md`

## What Shipped Apr 12, 2026

### Self-Improving Harness Loop (Pass 1 — Apr 12 AM)
- **`scripts/harness-probe-analyze.ts`** — JSONL analyzer with correct metric schema; safe to import (`import.meta.main` guard); outputs `-analysis.json` per probe
- **`scripts/harness-evolve.ts`** — evolution engine: evaluates pass criteria, generates drill-down/graduation probe candidates, tracks coverage gaps across 26 feature areas, checks regression baselines; `--dry-run` flag
- **`harness-reports/loop-state.json`** — persistent state: `knownWeaknesses[]`, `regressionBaselines[]`, `metricRegistry[]` (36 names after Pass 2), `coverageMap{}`, `probeHistory[]`
- **SKILL.md Phase 5: Evolve** — new section in `.agents/skills/harness-improvement-loop/SKILL.md`

### Pass 2 Probe Results (Apr 12 PM)
- **W2 confirmed** (loop-detector.ts L94): `else break` resets streak on ANY non-thought step — JSONL shows duplicate web-search calls (same query twice) not triggering detection; `w2-ics-required-tool` ran 6 iters, no loop
- **W4 confirmed** (builder.ts withReasoning): `w4-reasoning-opt-maxiter` ran 16 iters with configured maxIterations=3; `w4-direct-maxiter` (withMaxIterations) correctly stopped at 2
- **W2 root cause detail**: default tier is "mid" → `maxSameTool=3` (needs 3 identical calls); Ollama probes without `withContextProfile({ tier: "local" })` never trigger duplicate-tool detection
- **W6 NEW**: `getToolFailureRecovery()` (4f809a2d) adds `type="observation"` nudges that reset W2 streak — fixed by IC-1
- **W7 NEW**: ICS over-classifies tools for knowledge tasks — qwen3:14b called tool for "explain a monad" (direct-answer-efficiency: iter=6 expected ≤1)
- **W8 NEW**: Strategy switching is dead code — W2 prevents loop detection from firing, so `if (loopMsg !== null)` branch never runs; `strategy-switch-on-loop` probe: 15 iters, no switch
- **IC-1 ticket ready**: loop-detector.ts L94: `else break` → `else if (steps[i]!.type === "action") break` — fixes W2+W6+W8
- **IC-2 ticket ready**: builder.ts ~L1328: add `if (options?.maxIterations !== undefined) this._maxIterations = options.maxIterations;` in withReasoning()

**Confirmed JSONL metric schema** (use these, never `{event: "ThinkStart"}`):
- `execution.iteration` — gauge, ONE record at end (not per-iter)
- `reasoning.steps` — counter, fires per kernel step (value=1); labels: `strategy`, `kernelPass`
- `entropy.composite` — gauge per iter; labels: `iteration`, `shape`, `confidence`
- `execution.phase.count` — counter per phase; labels: `phase` (think/act/observe/bootstrap/complete…)
- `execution.tool.execution` — counter per tool call

## Current Status (Apr 10, 2026)
- **Cortex Lab parity** — Builder wires **runtime verification** (`withVerification`) and **host shell** (`terminalTools` → `shell-execute` + `terminal: true`) with explicit UI + docs disclaimers; config parity test + POST `/api/runs` + gateway normalized config updated
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
- `react-kernel.ts` 1,700 → 181 lines; thin orchestrator + `makeKernel({ phases?: Phase[] })` factory
- `kernel-runner.ts` 612 → ~1,107 lines (grew with ICS, tier-adaptive, output synthesis, lane controller, auto-checkpoint)
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
  kernel-runner.ts     ← the loop (runKernel) — ~1,107 lines
  kernel-hooks.ts      ← KernelHooks lifecycle hooks
  kernel-constants.ts  ← META_TOOLS, INTROSPECTION_META_TOOLS
  react-kernel.ts      ← makeKernel() + reactKernel + executeReActKernel (~181 lines)
  output-assembly.ts   ← output formatting/synthesis helpers
  index.ts             ← barrel exports
  phases/
    context-builder.ts ← pure data: buildSystemPrompt, toProviderMessage, buildConversationMessages, buildToolSchemas
    think.ts           ← LLM stream, FC parsing, system prompt + guidance assembly, termination oracle
    guard.ts           ← Guard[], defaultGuards, checkToolCall()
    act.ts             ← MetaToolHandler registry, final-answer gate, tool dispatch
  utils/ (19 files)
    ics-coordinator.ts, reactive-observer.ts, loop-detector.ts
    tool-utils.ts, tool-execution.ts, termination-oracle.ts, strategy-evaluator.ts
    stream-parser.ts, context-utils.ts, quality-utils.ts, service-utils.ts, step-utils.ts
    requirement-state.ts, lane-controller.ts, auto-checkpoint.ts
    task-intent.ts, tool-capabilities.ts, evidence-grounding.ts
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
- **Loop detection**: `maxConsecutiveThoughts: 3` — only ACTION steps reset the streak (NOT observations — IC-1 fix Apr 12)
- See [build-patterns.md](build-patterns.md) for tsconfig, package.json, Effect-TS patterns

## What Shipped Apr 13, 2026 — Context Engineering Overhaul

### Phase 1 — Dead Code Removal
- Deleted `compaction.ts` + `context-budget.ts` (never used on FC kernel path)
- Stripped `buildDynamicContext`, scoring helpers, and dead fields from `context-engine.ts`
- Cleaned `context-profile.ts`, `message-window.ts`, `context-utils.ts` — removed dead exports

### Phase 2 — autoForwardSection Removed
- Deleted entire `autoForwardSection` block from `think.ts`; signature simplified in `context-builder.ts`
- Tool results no longer double-injected as USER messages into the conversation thread

### Phase 3 — ContextManager Service
- New `packages/reasoning/src/context/context-manager.ts` — deterministic, pure-function context assembly
- `ContextManager.build(state, input)` returns `{ systemPrompt, messages }` ready for LLM
- Exports `GuidanceContext`, `ContextManagerOutput`, `buildGuidanceSection()`
- 13 TDD tests (all pass on first run)

### Phase 4 — steeringNudge → PendingGuidance
- `KernelState.steeringNudge` removed; replaced by typed `PendingGuidance` interface + `pendingGuidance?` field
- All 6 write sites in `kernel-runner.ts` updated to set `pendingGuidance` fields
- `context-builder.ts` no longer injects steering signals as USER messages
- `think.ts` reads `state.pendingGuidance`, constructs `GuidanceContext`, appends `Guidance:` section to system prompt, then clears field
- `extractedFact?: string` added to `StepMetadataSchema` (required for `buildPriorWorkSection`)

**Tests:** 3,879 pass / 22 skip / 0 fail across 430 files. Build clean.

## What Shipped Apr 12, 2026 — IC-1/IC-2/IC-3 Loop & Builder Fixes

### IC-1 — loop-detector.ts:94 (W2 + W6 + W8 simultaneously)
- `else break` → `else if (steps[i]!.type === "action") break`
- Observation steps no longer reset consecutive-thought streak; strategy switching now reachable

### IC-2 — builder.ts withReasoning() (W4)
- Added `if (options?.maxIterations !== undefined) this._maxIterations = options.maxIterations;`
- `withReasoning({ maxIterations: N })` now correctly limits execution (was silently ignored)

### IC-3 — Ollama defaults to local tier (W2-secondary)
- Added `providerName?: string` to `KernelInput`
- `kernel-runner.ts`: auto-selects "local" profile when `providerName === "ollama"` (maxSameTool=2)
- `execution-engine.ts` (5 sites): passes `providerName: String(config.provider ?? "")`

**Test coverage:** 3 new behavioral tests in `loop-detection-behavioral.test.ts` + 2 in `max-iterations-enforcement.test.ts`. 1,384 tests total, 0 failures.

## Architecture Debt (Remaining)
> Last reconciled with code: 2026-04-18. See `AGENTS.md` "Architecture Debt" table for the full audited register.

1. cogito:14b still inconsistent on reactive strategy (8B works fine, 14B doesn't)
2. Strategy routing disabled — no clean solution for local model multi-step tasks
3. Optional: ModelCalibration schema + 6-probe calibration-runner.ts for pre-baked local model profiles
4. Barrel leak in `packages/reasoning/src/strategies/kernel/index.ts` — `export *` leaks internal utils as public API
5. Loop detector streak logic in `loop-detector.ts` / `kernel-runner.ts` can mask duplicate-tool patterns so strategy-switching may never trigger (W8)
6. `synthesisConfig` dead pass-through on `KernelState` / `KernelInput` — naming is misleading; not consumed by ICS

**Fixed (Apr 2026) — removed from this list:**
- `ContextManager.build()` is now the sole live context-assembly path (`phases/think.ts:208`)
- `ReActKernelInput` duplicate fields resolved — zero `as ReActKernelInput` casts remain
- `state.meta` `as any` reduced from 34+ to 4 occurrences in 2 files (mostly resolved)

## Safety & Security Gaps (Apr 16, 2026 Audit)
Identified during Zeus integration report — honest audit of what's implemented vs. what's missing.

### Working but limited
- **Guardrails (injection/PII/toxicity)**: All regex-based pattern matching, no ML classifiers. Catches known attacks; novel/obfuscated attacks can bypass.
- **Behavioral contracts**: Runtime-enforced tool blocks and iteration limits work. Denied-topic detection is substring `includes()` — can be rephrased around.
- **Kill switch**: Phase-boundary halt only. Cannot interrupt an in-flight LLM call or tool execution mid-operation.
- **Budget enforcement**: Hard stop works, but costs are estimated locally from token counts × model pricing — not synced with actual provider billing. Overage possible on final call before check triggers.
- **Loop detection**: Iteration counter only, not semantic. Can't detect oscillation between same states — just counts turns.

### Ephemeral / not persisted
- **Identity (Ed25519 certs)**: Implemented but in-memory only. Process restart loses all certificates, roles, delegations.
- **RBAC (roles/permissions)**: Implemented but in-memory only. No automatic tool-name-to-resource mapping.
- **Audit logging**: Records all actions but stored in-memory by default. No persistence without explicit JSONL export via observability layer.

### Missing entirely
- **ML-powered content filtering**: No semantic jailbreak detection, no embedding-based PII detection.
- **MCP container resource limits**: MCP Docker containers have no `--memory`/`--cpus` caps. HTTP MCP servers run with default networking (not `--network none` like code sandbox).
- **Mid-operation abort**: No way to forcibly interrupt a long-running LLM call or tool execution.
- **Real-time provider cost sync**: No integration with provider billing APIs for actual spend tracking.
- **Tool approval enforcement at runtime**: Risk levels and `requiresApproval` flags are defined on tools but approval gate wiring to InteractionManager not fully visible in execution engine.

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
