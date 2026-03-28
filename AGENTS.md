# Reactive Agents — Agent Workflow Guide

> Instructions for AI agents working on this codebase. Read this before making changes.

---

## Architecture Quick Reference

> Scan this before touching any package. Full dependency tree — read top to bottom for build order.

### Package Dependency Tree

```
Foundation (no reactive-agents deps)
├── @reactive-agents/core          — EventBus, AgentService, TaskService, all shared types
│
├── @reactive-agents/llm-provider  — LLMService, 6 provider adapters, streaming, tool calling
│
├── @reactive-agents/memory        — 4-layer memory (Working/Semantic/Episodic/Procedural), SQLite/FTS5/vec
│
├── @reactive-agents/reasoning     — 5 strategies + ThoughtKernel, KernelRunner, Structured Plan Engine
│   └── depends on: core, llm-provider, memory (PlanStoreService), tools (ToolService)
│
├── @reactive-agents/tools         — ToolService, ToolRegistry, 8 built-in tools, MCP client, sandbox
│   └── depends on: core, llm-provider
│
├── @reactive-agents/guardrails    — Injection/PII/toxicity detection, KillSwitch, BehavioralContracts
│   └── depends on: core, llm-provider
│
├── @reactive-agents/verification  — Semantic entropy, fact decomposition, NLI, hallucination detection
│   └── depends on: core, llm-provider
│
├── @reactive-agents/cost          — Complexity router, budget enforcer, semantic cache
│   └── depends on: core, llm-provider, memory
│
├── @reactive-agents/identity      — Ed25519 certs, RBAC, delegation, audit trail
│   └── depends on: core
│
├── @reactive-agents/observability — Distributed tracing, metrics, structured logging, MetricsCollector
│   └── depends on: core
│
├── @reactive-agents/interaction   — 5 autonomy modes, checkpoints, preference learning, approval gates
│   └── depends on: core
│
├── @reactive-agents/orchestration — Multi-agent workflows (sequential, parallel, pipeline, map-reduce)
│   └── depends on: core, llm-provider, tools
│
├── @reactive-agents/prompts       — Template engine, version control, tier-adaptive prompt variants
│   └── depends on: core, llm-provider
│
├── @reactive-agents/eval          — LLM-as-judge, EvalStore (SQLite), 5 scoring dimensions, regression checks
│   └── depends on: core, llm-provider
│
├── @reactive-agents/a2a           — Agent Cards, JSON-RPC 2.0, SSE streaming, A2A server/client
│   └── depends on: core
│
├── @reactive-agents/gateway       — Persistent harness: heartbeats, crons, webhooks, policy engine
│   └── depends on: core, llm-provider, tools
│
├── @reactive-agents/testing       — Mock LLMService, mock ToolService, mock EventBus, assertion helpers
│   └── depends on: core, llm-provider (dev only)
│
└── Facade & Runtime
    ├── @reactive-agents/runtime   — ExecutionEngine, ReactiveAgentBuilder, createRuntime()
    │   └── depends on: all packages above (optional via Effect Layers)
    └── reactive-agents            — Public API facade, re-exports builder + types
        └── depends on: runtime
```

### Per-Layer Quick Reference

| Package | First file to read | Key exports |
|---|---|---|
| `core` | `src/services/event-bus.ts` | `EventBus`, `AgentEvent`, `AgentId`, `TaskId` |
| `llm-provider` | `src/runtime.ts` | `LLMService`, `createLLMProviderLayer()` |
| `memory` | `src/runtime.ts` | `MemoryService`, `createMemoryLayer()` |
| `reasoning` | `src/strategy-registry.ts` | `ReasoningService`, `StrategyRegistry`, `ThoughtKernel` |
| `tools` | `src/services/tool-service.ts` | `ToolService`, `ToolDefinition`, `defineTool()` |
| `guardrails` | `src/services/guardrail-service.ts` | `GuardrailService`, `KillSwitchService` |
| `verification` | `src/services/verification-service.ts` | `VerificationService` |
| `cost` | `src/services/cost-service.ts` | `CostService` |
| `identity` | `src/services/identity-service.ts` | `IdentityService` |
| `observability` | `src/services/observability-service.ts` | `ObservabilityService`, `ThoughtTracer` |
| `gateway` | `src/services/gateway-service.ts` | `GatewayService`, `PolicyEngine`, `WebhookService` |
| `eval` | `src/services/eval-service.ts` | `EvalService`, `EvalStore`, `EvalSuite` |
| `runtime` | `src/builder.ts` | `ReactiveAgents`, `ReactiveAgentBuilder`, `createRuntime()` |

### Common Debugging Entry Points

| Symptom | Start reading |
|---|---|
| Agent not calling tools | `packages/reasoning/src/strategies/reactive.ts` → `packages/reasoning/src/strategies/shared/kernel-runner.ts` |
| EventBus events not firing | `packages/core/src/services/event-bus.ts` → check `ManagedRuntime` is shared |
| LLM call fails silently | `packages/llm-provider/src/runtime.ts` → provider-specific file in `src/providers/` |
| Memory not persisting | `packages/memory/src/runtime.ts` → check `createMemoryLayer()` wiring |
| Plan-execute loops forever | `packages/reasoning/src/strategies/plan-execute.ts` → `isSatisfied()` + all-steps-completed guard |
| Gateway not starting | `packages/gateway/src/services/gateway-service.ts` → check `.withGateway()` in builder |
| Metrics dashboard missing | `packages/observability/src/services/observability-service.ts` → `MetricsCollectorLive` layer |
| Custom kernel not registering | `packages/reasoning/src/strategy-registry.ts` → `registerKernel()` call |

---

## Coding Standards

**Read `CODING_STANDARDS.md` before writing any code.** It covers Effect-TS patterns, type safety, service definitions, error handling, naming, testing, file structure, and anti-patterns. All agents and contributors must conform.

Key references:
- `FRAMEWORK_INDEX.md` — comprehensive system map with file-level navigation, data flows, and architecture diagrams
- `CODING_STANDARDS.md` — authoritative coding standards (types, services, errors, testing, naming, performance)
- `.claude/skills/effect-ts-patterns/SKILL.md` — Effect-TS pattern reference (Schema.Struct, Context.Tag, Layer, Ref)
- `.claude/skills/review-patterns/SKILL.md` — 8-category compliance checklist for code review

## Golden Rules

1. **Read before writing.** Always read existing files before editing. Understand patterns before introducing new code.
2. **Follow Effect-TS patterns.** Load the `effect-ts-patterns` skill. No `throw`, no raw `await`, no plain interfaces.
3. **Type safety first (no `any`).** Treat TypeScript types as part of the public API. Do not use `any` (including `as any` casts) or leave arguments/returns untyped—prefer precise types, generics, and tagged unions so IDE IntelliSense stays rich, accurate, and powered by the latest TypeScript features.
4. **Control and observability over magic.** No black-box helpers or hidden globals. New code must expose explicit configuration, emit structured events/traces, and integrate with existing observability (EventBus, ThoughtTracer, tracing) so every decision is explainable and replayable.
5. **Deterministic over LLM-driven.** If a field can be computed from available data (tool stats from EventBus, outcome from terminatedBy, metrics from usage), compute it. Don't ask the LLM.
6. **Keep docs truthful.** Every code change that affects public API, test counts, or capabilities must update documentation (see Documentation Workflow below).
7. **Test everything.** New services need tests. New features need integration tests. Run `bun test` before declaring work complete.
7. **One concern per commit.** Don't mix unrelated changes.
8. **Write JSDoc comments.** Every public API needs a JSDoc comment.

## Terminal Execution Rules

When interacting with the terminal via tools (like `run_command` or similar), agents MUST follow these constraints to avoid hung polling and unreadable outputs:

1. **Never pipe commands (`| cat`, `| tail`, `| grep`) for long-running processes.**
   Piping routes standard output and error through an OS buffer block. If a process spins (like `bun test`) or takes more than a couple of seconds, the buffer does not flush, causing the agent's status check to return `No output` indefinitely. **Read raw output instead.**

2. **Always append strict timeouts to tests and scripts.**
   Because Node/Bun and Effect-TS frequently leave dangling event loop handles (e.g., unclosed sockets, pending promises), test runners can hang successfully completed tests forever. Always use `--timeout` flags (e.g., `bun test --timeout 15000`) so the runner releases the process.

3. **Avoid running the whole test suite dynamically.**
   When verifying new work, run ONLY the exact file or directory modified (e.g., `bun test packages/llm-provider/tests/pricing.test.ts`). Running the global suite takes too long for background polling thresholds.

4. **Synchronous commands for quick returns.**
   If a command is quick (compilation, single file test, lint check), assign a sufficient `WaitMsBeforeAsync` limit (e.g., `5000ms` to `10000ms`) so it evaluates synchronously and provides immediate feedback.

5. **Stop dangling servers in tests.**
   If writing a test involving `Bun.serve()`, `Express`, or an HTTP stream, ALWAYS call `.stop(true)` (or equivalent force-close teardown). Leaving a port bound keeps the execution engine trapped in the `RUNNING` status permanently.

## Vision Alignment Checklist

Before you add or modify code, confirm:

- **Explicit over implicit**: No hidden magic or one-liner “createAgent” helpers. New behavior is configured via explicit builders/layers, not global state.
- **Observable over opaque**: The behavior is visible in traces/events (EventBus, ThoughtTracer, tracing), without relying on `console.log`.
- **Type-safe reliability**: Inputs are validated (e.g. Zod schemas), errors are part of explicit tagged unions, and all public APIs use precise, generic-friendly types (no `any`/`unknown` escape hatches).
- **Composable and testable**: Logic is factored into small, Effect-TS services/middleware that can be wired together and tested independently.
- **Efficient and local-first**: Code respects token/latency budgets, reuses existing caching/batching/context systems, and works well with local as well as cloud models.
- **Secure and production-first**: Changes honor guardrails, avoid leaking secrets, and default to safe behavior suitable for production workloads.

---

## Development Workflow

### Before Starting Work

1. Read `CLAUDE.md` for project status, build commands, and architecture overview
2. Read the relevant spec in `spec/docs/` for the feature you're implementing
3. Check `spec/docs/14-v0.5-comprehensive-plan.md` for current sprint context
4. Load relevant skills (`effect-ts-patterns`, `architecture-reference`, `llm-api-contract`)

### Build & Test Cycle

```bash
bun install                   # Install dependencies
bun test                      # Run full suite (must pass before any PR)
bun test --watch              # Watch tests during development
bun run typecheck             # Workspace-wide TypeScript checks (no implicit any)
bun run build                 # Build all packages and apps (ESM + DTS)
bun run build:packages        # Build all workspace packages
bun run build:apps            # Build CLI and app bundles
bun run clean                 # Remove all dist outputs
bun run rax -- <args>         # Run the local `rax` CLI entrypoint
bun run docs:dev              # Start docs dev server
bun run docs:build            # Build docs for production
bun run docs:preview          # Preview built docs
```

### After Completing a Feature

Run this checklist:

- [ ] All tests pass (`bun test`)
- [ ] Build succeeds (`bun run build`)
- [ ] Documentation updated (see below)
- [ ] Changeset added (`bun run changeset`) — see Release Workflow below
- [ ] No new `TODO`/`FIXME` without a tracking issue
- [ ] Pattern compliance verified (`/review-patterns <changed-files>`)

---

## Documentation Workflow

### When to Update What

| Trigger                        | Files to Update                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **New package created**        | `CLAUDE.md` (package map + spec index), `README.md` (packages table), `CHANGELOG.md`, architecture-reference skill, docs site sidebar |
| **New/changed builder method** | `README.md` (quick start + capabilities), `apps/docs/src/content/docs/reference/builder-api.md`, `CLAUDE.md` (architecture section)   |
| **New CLI command**            | `README.md` (CLI section), `apps/docs/src/content/docs/reference/cli.md`, `CLAUDE.md` (CLI section)                                   |
| **Test count changed**         | `CLAUDE.md` (build commands section), `README.md` (development section)                                                               |
| **New reasoning strategy**     | `README.md` (strategies table), `apps/docs/src/content/docs/guides/reasoning.md`                                                      |
| **New LLM provider**           | `README.md` (providers table), `apps/docs/src/content/docs/features/llm-providers.md`, `CLAUDE.md` (env vars if needed)               |
| **New feature page needed**    | `apps/docs/src/content/docs/features/<name>.md` or `guides/<name>.md`                                                                 |
| **API signature change**       | Search all docs for old signature and update: `grep -r "oldMethod" apps/docs/`                                                        |
| **Version bump / release**     | Add a changeset (`bun run changeset`) — versions and CHANGELOG are managed automatically                                              |

### Docs Site (Starlight/Astro)

Location: `apps/docs/`

```bash
bun run docs:dev              # Preview locally
bun run docs:build            # Build for production
bun run docs:preview          # Preview built docs
```

Key files:

- `astro.config.mjs` — sidebar structure (autogenerated from directories)
- `src/content/docs/` — all documentation pages
- `src/content/config.ts` — content collection config (NOT `content.config.ts`)
- Must use `legacy: { collections: true }` for Bun workspace compatibility

### README.md

The README is the public face. Keep it accurate:

- Badge row at top
- Architecture diagram reflects actual layers
- Packages table lists all published packages
- Test counts match reality
- Code examples use actual API signatures (test them!)

### ROADMAP.md

Root `ROADMAP.md` is the authoritative forward-looking plan. Update when:

- A milestone ships (move from "target" to "✅ Released")
- Scope changes for a future version
- New competitive intelligence changes priorities

---

## Multi-Agent Coordination

### Team Structure

For large features (new packages, cross-cutting changes):

| Role        | Does                                | Doesn't                                    |
| ----------- | ----------------------------------- | ------------------------------------------ |
| **Lead**    | Plans, assigns, reviews, integrates | Write package code directly                |
| **Builder** | Implements packages using skills    | Make cross-package architectural decisions |
| **Tester**  | Writes tests, validates coverage    | Skip pattern review                        |

### Parallelization Rules

- Packages with no dependency relationship can be built in parallel
- Always validate gate dependencies before starting dependent work:
  ```
  core → llm-provider → {memory, tools, reasoning} → runtime
  ```
- Run workspace-wide `bun run build` after each package completes
- Use `/validate-build <pkg>` before moving to dependent packages

### Communication Protocol

When handing off between agents:

1. State what was completed (files created/modified)
2. State what was verified (tests passed, build clean)
3. State what's next (dependent work now unblocked)
4. Flag any known issues or deviations from spec

---

## Package Creation Checklist

When creating a new package (e.g., `@reactive-agents/a2a`):

1. [ ] Create `packages/<name>/package.json` with correct deps
2. [ ] Create `packages/<name>/tsconfig.json` extending root
3. [ ] Create `packages/<name>/tsup.config.ts` for build
4. [ ] Implement `src/types.ts`, `src/errors.ts`
5. [ ] Implement services following Effect-TS patterns
6. [ ] Create `src/runtime.ts` with layer factory
7. [ ] Create `src/index.ts` with all public exports
8. [ ] Write tests in `tests/`
9. [ ] Add to root `package.json` workspaces if needed
10. [ ] Add to root build script order
11. [ ] Run `bun install` to link workspace
12. [ ] Run `bun test packages/<name>` — all pass
13. [ ] Run `bun run build` — workspace compiles clean
14. [ ] Update `CLAUDE.md` package map
15. [ ] Update `README.md` packages table
16. [ ] Update architecture-reference skill dependency graph
17. [ ] Add spec file reference to `CLAUDE.md` spec index

---

## Quality Gates

### Before Any PR

| Check              | Command                    | Must              |
| ------------------ | -------------------------- | ----------------- |
| Tests pass         | `bun test`                 | 100% green        |
| Build clean        | `bun run build`            | No errors         |
| Pattern compliance | `/review-patterns <files>` | 8/8 pass          |
| Docs accurate      | Manual review              | No stale examples |

### Before Any Release

| Check            | Details                                                       |
| ---------------- | ------------------------------------------------------------- |
| All above        | Plus full integration test                                    |
| Changeset added  | `bun run changeset` with a clear summary of all changes       |
| Docs site builds | `bun run docs:build`                                          |
| README current   | Stats, packages, examples all accurate                        |
| ROADMAP updated  | Shipped items marked, new targets set                         |

> **Do not manually bump versions or edit CHANGELOG.** The `changesets/action` PR handles both automatically when the "chore: version packages" PR is merged. See Release Workflow below.

---

## Release Workflow

This project uses **[Changesets](https://github.com/changesets/changesets)** for versioning and publishing. Never manually bump `package.json` versions or edit `CHANGELOG.md` for new releases.

### Day-to-day: adding a changeset

Every PR that changes user-facing behaviour **must** include a changeset:

```bash
bun run changeset
# prompts: which packages changed? → select all (they're in a fixed group)
# bump type? → patch / minor / major
# summary? → one line description
```

This creates `.changeset/<random-name>.md`. Commit it with your code.

### Release cycle

```
feature work + bun run changeset
        ↓  push to main
changesets/action detects pending changesets
        ↓  opens "chore: version packages" PR automatically
PR shows: version bumps for all packages + generated CHANGELOG entries
        ↓  review and merge when ready to release
changeset publish runs → builds, resolves workspace deps, publishes to npm
        ↓
GitHub Release created automatically with CHANGELOG notes
```

### Bump types

| Type | When to use | Example |
|---|---|---|
| `patch` | Bug fixes, test fixes, docs | `0.7.6 → 0.7.7` |
| `minor` | New features, backwards-compatible API additions | `0.7.6 → 0.8.0` |
| `major` | Breaking API changes | `0.7.6 → 1.0.0` |

All 20 publishable packages move together (fixed group) — bumping any one package bumps all.

### Private packages (never published)

`@reactive-agents/benchmarks` and `@reactive-agents/health` have `"private": true` and are excluded from all publishing automatically. Do not remove this flag.

### Key files

| File | Purpose |
|---|---|
| `.changeset/config.json` | Fixed group of all packages, public access |
| `.github/workflows/publish.yml` | Runs `changesets/action` on every push to `main` |
| `package.json` `release` script | `bun run build && changeset publish` |

---

## Key File Paths

| Category  | Path                                       |
| --------- | ------------------------------------------ |
| **Memory** | `.agents/MEMORY.md` — **read first** for project context, status, patterns, and roadmap |
| Specs     | `spec/docs/`, `docs/superpowers/specs/`    |
| Plans     | `docs/superpowers/plans/`                  |
| Skills    | `.claude/skills/`, `.agents/skills/`       |
| Packages  | `packages/{core,llm-provider,memory,...}/` |
| CLI       | `apps/cli/`                                |
| Docs      | `apps/docs/src/content/docs/`              |
| Examples  | `apps/examples/`                           |
| CI        | `.github/workflows/`                       |
| v0.5 Plan | `spec/docs/14-v0.5-comprehensive-plan.md`  |

> **Note:** `.agents/MEMORY.md` contains cross-agent project memory — current status, build patterns, architecture decisions, known issues, and roadmap. All agents should read it before starting work and update it after completing significant features.

---

## Common Pitfalls

1. **`serviceOption` returns `Option`** — use `Option.isSome()` + `.value`, not direct access
2. **`ContextWindowManager.truncate()`** not `buildContext()` — buildContext requires systemPrompt
3. **Gemini SDK is `@google/genai`** not `@google/generative-ai`
4. **`mock.module()` in Bun** only intercepts ES `import()`, not CJS `require()`
5. **ReasoningService.execute** takes single params object, not positional args
6. **Starlight content config** must be `src/content/config.ts` not `src/content.config.ts`
7. **`workspace:*` is fine for internal deps** — `changeset publish` resolves these correctly. Do not manually replace them with pinned versions.
8. **Never manually bump versions** — `bun run changeset` + the "chore: version packages" PR handles all version bumps and CHANGELOG entries. Manual edits will conflict with changesets.

---

## Strategic Audit: Vision vs. Implementation (2026-03-02)

> Reasoning cache for agents. Authoritative source of truth for what exists, what doesn't, and what to build next. Reference docs: `spec/REACTIVE_AGENTS_TECHNICAL_SPECS.md` (18-layer architecture), `spec/docs/00-VISION.md` (philosophy + differentiators).

### Current State Snapshot

**1116 tests, 156 files, 18 packages + 2 apps.** Builder API has 30+ `.with*()` methods. All layers compose via Effect-TS through `createRuntime()`.

### Capability Matrix: Vision vs. Reality

| Vision Capability | Status | What Exists | What's Missing |
|---|---|---|---|
| **Control-First Architecture** | COMPLETE | Builder API (30+ methods), explicit config, no black boxes | — |
| **Multi-Strategy Reasoning** | COMPLETE | 5 strategies (ReAct, Plan-Execute, ToT, Reflexion, Adaptive) + shared kernel | See gap-analysis P1–P7 below |
| **4-Layer Memory** | COMPLETE | Working, Episodic, Semantic (FTS5+sqlite-vec), Procedural (bun:sqlite) | Auto-consolidation pipeline (tier promotion), attention mechanism |
| **Verification Stack** | STRONG | Semantic entropy, fact decomposition, multi-source, NLI, self-consistency, hallucination detection | Strategy auto-selector (complexity scoring → strategy dispatch) |
| **Context Engineering** | COMPLETE | Model-adaptive profiles, budget allocation, progressive compaction, 4-tier awareness | Tiered context manager (HOT/WARM/COLD/FROZEN classification), semantic caching with vector search |
| **Observability** | COMPLETE | EventBus, OpenTelemetry tracing, metrics dashboard, live streaming, structured logging | — |
| **Type Safety** | COMPLETE | Effect-TS throughout, Schema validation, tagged errors, no `any` | — |
| **Local-First Optimization** | PARTIAL | Context profiles adapt to model tier, compression, budget tracking | Auto-optimization (scouts learn optimal prompts per model), KV cache hints, hybrid cloud/local routing |
| **Cost Tracking** | COMPLETE | Token counting, USD estimation, budget enforcement, complexity routing, semantic cache | Per-task/daily budget policies as formal constraints |
| **Identity & Security** | COMPLETE | Ed25519 certs, RBAC, audit logging, guardrails (injection/PII/toxicity), subprocess sandbox | mTLS inter-agent, Vault integration |
| **Multi-Agent** | COMPLETE | A2A protocol, agent-as-tool, sub-agents (static+dynamic), MCP (4 transports), orchestration workflows | — |
| **Agent Gateway** | COMPLETE | Heartbeats (adaptive), crons, webhooks (GitHub adapter), policy engine, input router | Persistence/recovery across restarts |
| **Scout Layer** | NOT STARTED | — | Entire system: simulation engine, sandbox environment, strategy testing, learning extraction, learning application |
| **Reactive Seeding Network** | NOT STARTED | — | Entire system: network topology, gossip protocol, privacy preservation, trust scoring, learning aggregation, intelligent harvesting |
| **SDK Package** | NOT STARTED | Builder API exists but no standalone SDK package | REST API server, `ReactiveAgentsClient` class, hosted endpoints |
| **Testing Utilities** | PARTIAL | `TestLLMServiceLayer` exists in test files | Formal `@reactive-agents/testing` package with test helpers, mocks, assertions |

### The Two Missing Flagship Differentiators

These are what the vision calls "what makes us different" — the moat features that no other framework has:

#### 1. Scout Layer (`@reactive-agents/scouts` + `@reactive-agents/simulation`)

**What it does:** Safe pre-production testing. Before an agent runs a task in production, scouts explore the problem landscape in a sandbox — testing different strategies, measuring costs, cataloging failure modes, and learning the optimal approach.

**Why it matters:** The vision claims 90-97% cost savings ("$0.50 scout learning + $0.10 optimized execution vs. $5-20 trial-and-error"). This is the core value proposition differentiating us from LangChain, AutoGen, and CrewAI.

**What needs building:**
- `ScoutConfig` — task, strategies to test, iteration count, sandbox limits, success criteria
- `ScoutEnvironment` — isolated execution sandbox with mocked external services and safety limits
- `Scout` class — runs task with assigned strategy in sandbox, captures full metrics (time, cost, tokens, confidence)
- `ScoutSimulationEngine` — runs N scouts × M iterations, early-terminates on budget exceeded
- `LearningExtractor` — analyzes results to produce `ScoutLearnings` (optimal strategy, cost curves, failure modes, problem landscape, confidence calibration)
- `LearningApplicator` — configures production agent with learned optimal strategy, failure mitigations, context requirements, cost expectations
- Builder integration: `.withScouts({ enabled: true, iterations: 100, budget: 0.50 })`
- Integration with existing `StrategySelector` in adaptive strategy

**Dependencies:** Reasoning (strategies to test), Cost (budget tracking), Memory (store learnings), Verification (assess results)

#### 2. Reactive Seeding Network (`@reactive-agents/seeding`)

**What it does:** Distributed learning across all agents. Scout learnings and production experiences are shared (privacy-preserved) so every agent benefits from the network's collective intelligence.

**Why it matters:** Network effects create an exponential moat. The vision claims "10 users → 10x faster learning, 1000 users → impossible to replicate." This is the long-term strategic advantage.

**What needs building:**
- `SeedingNetwork` interface — seed (contribute), harvest (consume), query (intelligence)
- `SeedingMode` — community (public), private (org-only), hybrid, isolated (offline)
- `PrivacyPreserver` — differential privacy (noise injection), metadata stripping, threshold cryptography for share splitting
- `SeedingNetworkTopology` — peer discovery (DHT for public, org registry for private), gossip protocol (fanout=3)
- `LearningAggregator` — group by task similarity, weighted voting on optimal strategy, average cost curves, union failure modes
- `IntelligentHarvester` — embed task description, semantic search for similar learnings, filter by trust score and recency, aggregate and rank
- `TrustSystem` — source reputation (positive/negative feedback loop), verification count, production success rate, recency decay
- Builder integration: `.withReactiveSeeding({ mode: "community", contribute: true, consume: true })`

**Dependencies:** Scout Layer (produces learnings to share), Memory (semantic search), LLM Provider (embeddings), Identity (source attribution)

### Near-Term Gap Fixes (v0.5.6 — from feature-gap-analysis.md)

All gap fixes completed in Phase A Foundation Fixes:

| # | Gap | Status | Commit |
|---|-----|--------|--------|
| P1 | Wire `taskId` into ToT Phase 2 kernel call | ✅ DONE (pre-existing) | — |
| P2 | Wire `resultCompression` through Reflexion, Plan-Execute, ToT | ✅ DONE | `98bc93c` |
| P3 | Extend `StrategyFn` type to match full execute params | ✅ DONE | `5b9c18d` |
| P4 | `compressToolResult` dedup | ✅ DONE (pre-existing) | — |
| P5 | Add `kernelMaxIterations` config to Reflexion + Plan-Execute | ✅ DONE | `5b9c18d` + `98bc93c` |
| P6 | Thread real `agentId`/`sessionId` through kernel | ✅ DONE | `ec5aeb4` |
| P7 | Reflexion `priorCritiques` from episodic memory | ✅ DONE | `05d8e67` |

### Medium-Term Improvements (Pre-Scout Infrastructure)

| Improvement | Package | Status | Notes |
|---|---|---|---|
| **Memory consolidation pipeline** | `memory` | ✅ EXISTS | `MemoryConsolidator.consolidate()` with decay, promotion, cleanup |
| **Verification pipeline runner** | `verification` | ✅ EXISTS | Sequential layer execution with weighted scoring |
| **Strategy auto-selector** | `reasoning` | ⬚ OPEN | Complexity scoring → strategy dispatch (not just adaptive meta-strategy) |
| **Hallucination detection layer** | `verification` | ✅ DONE | `checkHallucination()` + `checkHallucinationLLM()` — commit `d81f747` |
| **Budget enforcement policies** | `cost` | ✅ EXISTS | 4-tier enforcer (perRequest/perSession/daily/monthly) in `budget-enforcer.ts` |
| **Testing utilities package** | `testing` | ✅ DONE | `@reactive-agents/testing` — mock LLM, tools, EventBus, assertions — commit `79816c6` |

### Strategic Build Order

```
Phase A: Foundation Fixes (v0.5.6) ← COMPLETE
  └─ P1–P7 gap fixes ✅
  └─ Hallucination detection layer ✅
  └─ @reactive-agents/testing package ✅
  └─ Memory consolidation, budget enforcement, verification pipeline — already existed

Phase B: Scout Layer (v0.6.0)
  └─ @reactive-agents/scouts — ScoutConfig, Scout, ScoutEnvironment
  └─ @reactive-agents/simulation — SimulationEngine, LearningExtractor
  └─ LearningApplicator + builder .withScouts()
  └─ Integration: strategies × scouts × verification × cost

Phase C: Seeding Network (v0.7.0)
  └─ @reactive-agents/seeding — SeedingNetwork, PrivacyPreserver
  └─ Trust system, gossip protocol, intelligent harvesting
  └─ Learning aggregation, weighted voting
  └─ Builder .withReactiveSeeding()

Phase D: Production Polish (v1.0)
  └─ @reactive-agents/sdk — REST API + client library
  └─ Tiered context manager (HOT/WARM/COLD/FROZEN)
  └─ mTLS inter-agent communication
  └─ Comprehensive documentation + examples
  └─ Performance benchmarks + optimization
```

### Builder API: Complete vs. Spec

What the builder has today (30+ methods):
```
.withName()  .withPersona()  .withSystemPrompt()  .withContextProfile()
.withProvider()  .withModel()  .withMemory()  .withMaxIterations()
.withReasoning()  .withTools()  .withMCP()  .withGuardrails()
.withVerification()  .withCostTracking()  .withAudit()  .withIdentity()
.withObservability()  .withInteraction()  .withPrompts()  .withOrchestration()
.withKillSwitch()  .withBehavioralContracts()  .withSelfImprovement()
.withEvents()  .withAgentTool()  .withRemoteAgent()  .withDynamicSubAgents()
.withA2A()  .withGateway()  .withTestScenario()  .withHook()  .withLayers()
```

What the spec additionally requires:
```
.withScouts({ enabled, iterations, budget })           — Phase B
.withReactiveSeeding({ mode, contribute, consume })    — Phase C
.withBudget({ perTask, daily, monthly })               — Phase A (enhancement)
.withScoutMode(enabled)                                — Phase B (alias)
```

### Package Dependency Graph for New Work

```
scouts ──────→ reasoning (strategies to test)
             → cost (budget enforcement)
             → memory (store learnings)
             → verification (assess results)
             → testing (simulation infrastructure)

seeding ─────→ scouts (produces learnings)
             → memory (semantic search)
             → llm-provider (embeddings)
             → identity (source attribution)
             → core (EventBus for network events)

testing ─────→ core (test helpers)
             → llm-provider (mock providers)
             → tools (mock tools)
```

### Key Design Decisions for Agents

1. **Scout sandbox isolation** — Use Effect-TS `Layer.provide` with mocked services (not process-level sandboxing). Scouts get a `ScoutEnvironment` layer that replaces real services with mocked versions (mock LLM for cost simulation, mock tools for safety).

2. **Learning storage format** — `ScoutLearnings` must be serializable to JSON and storable in episodic memory. Use `Schema.Struct` for validation. Learnings include: optimal strategy name, cost curves (strategy×cost×success), failure modes (mode×frequency×mitigation), problem landscape (complexity×ambiguity×requiredContext).

3. **Seeding network transport** — Start with HTTP REST (not P2P gossip) for simplicity. Community mode posts to a central API; private mode uses org-local storage. Gossip protocol is a v1.0+ optimization.

4. **Privacy** — Differential privacy via Laplacian noise on numerical fields (epsilon=0.1). Strip all metadata except task category and strategy outcomes. No raw task descriptions leave the local system.

5. **Trust scoring** — Start simple: success rate in production × recency decay. Reputation system (positive/negative feedback) is v1.0+ refinement.
