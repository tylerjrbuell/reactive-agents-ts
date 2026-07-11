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
├── @reactive-agents/reasoning     — 8 registered strategy implementations (core: reactive, direct; router: adaptive; promote-candidate: code-action; maintained: plan-execute-reflect, reflexion, tree-of-thought, blueprint; aliases react→reactive, rewoo→blueprint — labels per north-star spec §7, see docs reference/stability.md) + ThoughtKernel, KernelRunner, Structured Plan Engine
│   └── depends on: core, llm-provider, memory (PlanStoreService), tools (ToolService)
│
├── @reactive-agents/tools         — ToolService, ToolRegistry, 11 built-in tools, MCP client, sandbox
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
├── @reactive-agents/channels      — External channel layer: webhooks, bot transports, triggers, session bridging
│   └── depends on: core, gateway
│
├── @reactive-agents/testing       — Mock LLMService, mock ToolService, mock EventBus, assertion helpers
│   └── depends on: core, llm-provider (dev only)
│
├── @reactive-agents/runtime-shim  — Bun/Node.js unified primitives (Database, spawn, serve, glob, hash)
│   (no reactive-agents deps — consumed by memory, tools, health, judge-server)
│
├── @reactive-agents/ui-core       — Headless UI core: wire protocol, resumable stream client, run state machines, fixture testing
│   (no reactive-agents deps — consumed by react, svelte, vue bindings)
│
├── @reactive-agents/trace         — Structured execution traces: TraceEvent schema, recorders, span helpers
│   └── depends on: core
│
├── @reactive-agents/health        — Health-check primitives + readiness probes for production deploys
│   └── depends on: runtime-shim
│
├── @reactive-agents/reactive-intelligence — Entropy sensing, adaptive control, learning pipeline
│   └── depends on: core, llm-provider, runtime-shim, trace
│
├── @reactive-agents/judge-server  — LLM-as-judge HTTP server backing @reactive-agents/eval
│   └── depends on: core, eval, llm-provider, runtime-shim
│
├── @reactive-agents/compose       — Harness composition + 5 killswitches (maxIterations, budgetLimit, timeoutAfter, watchdog, requireApprovalFor)
│   └── depends on: core, runtime
│
├── @reactive-agents/replay        — Deterministic trace replay: loadRecordedRun, makeReplayController, makeReplayToolLayer, diffTraces
│   └── depends on: core, trace, runtime
│
├── @reactive-agents/diagnose      — Trace diagnostics + replay-driven root-cause analysis (rax-diagnose CLI)
│   └── depends on: replay, trace
│
├── @reactive-agents/scenarios     — Canonical scenario fixtures for the testing harness (gate scenarios, schema-drift, etc.)
│   └── depends on: testing, trace
│
├── @reactive-agents/benchmarks    — Benchmark task suites + tier-aware runners for cross-model evaluation
│   └── depends on: core, cost, judge-server, llm-provider, reasoning, runtime, runtime-shim
│
├── @reactive-agents/observe       — OpenTelemetry/OpenInference span exporter: OpenInferenceTracerLayer, setupOpenInferenceExporter
│   └── depends on: core
│
├── @reactive-agents/react         — React hooks + components for Reactive Agents: useRun, useAgentStream, useAgent, Interact/Inbox/Observe/Render/Devtools families
│   └── depends on: ui-core; peer-depends on `react`
│
├── @reactive-agents/svelte        — Svelte stores for Reactive Agents: createRun, agentStream, agentRun, Interact/Observe/Resume families
│   └── depends on: ui-core; peer-depends on `svelte`
│
├── @reactive-agents/vue           — Vue composables for Reactive Agents: useAgentStream, useAgent
│   └── depends on: ui-core; peer-depends on `vue`
│
└── Facade & Runtime
    ├── @reactive-agents/runtime   — ExecutionEngine, ReactiveAgentBuilder, createRuntime()
    │   └── depends on: all packages above (optional via Effect Layers)
    ├── reactive-agents            — Public API facade, re-exports builder + types
    │   └── depends on: runtime
    └── create-reactive-agent      — `npm create reactive-agent` scaffold CLI for new projects
        (no reactive-agents deps — bundles templates + post-install)
```

### Per-Layer Quick Reference

| Package         | First file to read                      | Key exports                                                 |
| --------------- | --------------------------------------- | ----------------------------------------------------------- |
| `core`          | `src/services/event-bus.ts`             | `EventBus`, `AgentEvent`, `AgentId`, `TaskId`               |
| `llm-provider`  | `src/runtime.ts`                        | `LLMService`, `createLLMProviderLayer()`                    |
| `memory`        | `src/runtime.ts`                        | `MemoryService`, `createMemoryLayer()`                      |
| `reasoning`     | `src/services/strategy-registry.ts`     | `ReasoningService`, `StrategyRegistry`, `ThoughtKernel`     |
| `tools`         | `src/services/tool-service.ts`          | `ToolService`, `ToolDefinition`, `defineTool()`             |
| `guardrails`    | `src/services/guardrail-service.ts`     | `GuardrailService`, `KillSwitchService`                     |
| `verification`  | `src/services/verification-service.ts`  | `VerificationService`                                       |
| `cost`          | `src/services/cost-service.ts`          | `CostService`                                               |
| `identity`      | `src/services/identity-service.ts`      | `IdentityService`                                           |
| `observability` | `src/services/observability-service.ts` | `ObservabilityService`, `ThoughtTracer`                     |
| `gateway`       | `src/services/gateway-service.ts`       | `GatewayService`, `PolicyEngine`, `WebhookService`          |
| `eval`          | `src/services/eval-service.ts`          | `EvalService`, `EvalStore`, `EvalSuite`                     |
| `runtime-shim`  | `src/index.ts`                          | `Database`, `spawn`, `serve`, `glob`, `hash`, `isMain`, `isBun`, `isNode` |
| `compose`       | `src/killswitches/index.ts`             | `maxIterations`, `budgetLimit`, `timeoutAfter`, `watchdog`, `requireApprovalFor`, `killswitches` |
| `replay`        | `src/index.ts`                          | `loadRecordedRun`, `replay`, `makeReplayController`, `makeReplayToolLayer`, `diffTraces` |
| `observe`       | `src/index.ts`                          | `OpenInferenceTracerLayer`, `setupOpenInferenceExporter`, `autoConfigureExporter` |
| `runtime`       | `src/builder.ts`                        | `ReactiveAgents`, `ReactiveAgentBuilder`, `createRuntime()` |

### Adaptive Calibration (Live Learning)

Three-tier calibration resolves per-model behavior at runtime:

1. **Shipped prior** — pre-baked probe results in `packages/llm-provider/src/calibrations/`
2. **Community prior** — fetched from `GET /v1/profiles/:modelId` (daily-aggregated from all opt-in users)
3. **Local posterior** — observations stored at `~/.reactive-agents/observations/<model>.json`

After 5+ runs, empirical observations override shipped priors for `parallelCallCapability` and `classifierReliability`. When classifier reliability is `"low"`, the LLM classifier call is skipped entirely (saves a round-trip).

**Env vars for self-hosted deployments:**

- `REACTIVE_AGENTS_TELEMETRY_BASE_URL` — configures both read (`/v1/profiles`) and write (`/v1/reports`) endpoints
- `REACTIVE_AGENTS_TELEMETRY_PROFILES_URL` / `REACTIVE_AGENTS_TELEMETRY_REPORTS_URL` — per-endpoint overrides

### Common Debugging Entry Points

Quick reference for tracing issues to specific kernel phases/services:

| Symptom | Start here |
| --- | --- |
| Tools not called | `packages/reasoning/src/kernel/capabilities/reason/think.ts` → `kernel/capabilities/act/act.ts` |
| Context missing | `packages/reasoning/src/context/context-manager.ts` (`ContextManager.build`) → `context/message-window.ts` |
| Tool results lost | `kernel/capabilities/act/tool-execution.ts` → `kernel/capabilities/attend/tool-formatting.ts:compressToolResult` |
| EventBus silent | `packages/core/src/services/event-bus.ts` (check shared ManagedRuntime) |
| LLM call fails | `packages/llm-provider/src/runtime.ts` → provider-specific in `src/providers/` |
| Memory not persisting | `packages/memory/src/runtime.ts:createMemoryLayer()` wiring |
| Plan loops forever | `packages/reasoning/src/strategies/plan-execute.ts:isSatisfied()` guard |
| Gateway won't start | `packages/gateway/src/services/gateway-service.ts` → check `.withGateway()` in builder |
| Chat history missing | `packages/runtime/src/gateway-chat.ts:GatewayChatManager` + SessionStoreService wiring |
| Metrics missing | `packages/observability/src/services/observability-service.ts:MetricsCollectorLive` |

---

## Canonical Documents & Read Order

**Every session: Read in this order** to understand current state and authority hierarchy.

| Order | Doc | Purpose |
|---|---|---|
| **1st** | `wiki/Architecture/Specs/04-PROJECT-STATE.md` | Current empirical state (test count, packages, shipped capabilities) |
| **2nd** | `wiki/Architecture/Specs/07-ROADMAP-v1.0.md` | Phase sequencing authority (v0.10.0 → v1.0, validation gates) + integrated architecture |
| **If v0.10.0 work** | `wiki/Architecture/Specs/06-AUDIT-v0.10.0.md` | Release quality gate (28 packages, 13 mechanisms, 44-item FIX backlog) |
| **Reference** | `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` | Architecture target for Phase 2+ conformance |
| **Reference** | `wiki/Architecture/Specs/01-RESEARCH-DISCIPLINE.md` | Methodology (12 rules for any harness change) |
| **Reference** | `wiki/Architecture/Specs/02-FAILURE-MODES.md` | Living failure-mode catalog (FM-A1, FM-B2, etc.) |

**Authority Hierarchy** (if docs conflict):

- `07-ROADMAP-v1.0.md` > `06-AUDIT-v0.10.0.md` > `04-PROJECT-STATE.md` > `01-RESEARCH-DISCIPLINE.md`
- Amend lower-authority doc, never silent drift

**All 6 canonical docs live in `wiki/Architecture/Specs/`** (uniform `NN-NAME.md` numbering). See `wiki/Architecture/Specs/DOCUMENT_INDEX.md` for full index.

---

## Coding Standards

**Read `CODING_STANDARDS.md` before writing any code.** It covers Effect-TS patterns, type safety, service definitions, error handling, naming, testing, file structure, and anti-patterns. All agents and contributors must conform.

Key references:

- `CODING_STANDARDS.md` — authoritative coding standards (types, services, errors, testing, naming, performance)
- `.claude/skills/effect-ts-patterns/SKILL.md` — Effect-TS pattern reference (Schema.Struct, Context.Tag, Layer, Ref)
- `.claude/skills/review-patterns/SKILL.md` — 9-category compliance checklist for code review

## Runtime Policy

**Recommended runtime: Bun ≥1.1.0** — optimal performance with `bun:sqlite`, `Bun.spawn`, `Bun.serve`. **Node.js 22.5+ is now supported** via `@reactive-agents/runtime-shim` which provides unified `Database`, `spawn`, `serve`, `glob`, and `hash` primitives that route to Bun fast-paths or `node:sqlite`/`node:child_process`/`node:fs` equivalents. FTS5 full-text search is unavailable on Node sqlite — falls back to `LIKE` search automatically.

**Do not introduce new Bun-specific APIs in new code.** When adding features, prefer `node:` built-ins (`node:crypto`, `node:fs/promises`, `node:child_process`) over Bun globals — Bun supports all `node:` modules natively, and using them keeps each file one import-swap away from Node compatibility. Reserve `bun:sqlite`, `Bun.serve`, and `Bun.spawn` only for files already using them.

## Golden Rules

1. **Read before writing.** Always read existing files before editing. Understand patterns before introducing new code.
2. **Follow Effect-TS patterns.** Load the `effect-ts-patterns` skill. No `throw`, no raw `await`, no plain interfaces.
3. **Type safety first (no `any`).** Treat TypeScript types as part of the public API. Do not use `any` (including `as any` casts) or leave arguments/returns untyped—prefer precise types, generics, and tagged unions so IDE IntelliSense stays rich, accurate, and powered by the latest TypeScript features.
4. **Control and observability over magic.** No black-box helpers or hidden globals. New code must expose explicit configuration, emit structured events/traces, and integrate with existing observability (EventBus, ThoughtTracer, tracing) so every decision is explainable and replayable.
5. **Deterministic over LLM-driven.** If a field can be computed from available data (tool stats from EventBus, outcome from terminatedBy, metrics from usage), compute it. Don't ask the LLM.
6. **Keep docs truthful.** Every code change that affects public API, test counts, or capabilities must update documentation (see Documentation Workflow below).
7. **Test everything.** New services need tests. New features need integration tests. Run `bun test` before declaring work complete.
8. **One concern per commit.** Don't mix unrelated changes.
9. **Write JSDoc comments.** Every public API needs a JSDoc comment.

## Terminal Execution Rules (TL;DR)

1. **No piping long-running commands** — pipes block on buffer overflow. Read raw output instead.
2. **Add timeouts to tests** — use `--timeout 15000` to prevent process hang from dangling event loop handles.
3. **Run scoped tests only** — avoid the full suite; run only modified file or directory.
4. **Kill dangling servers** — always call `.stop(true)` on `Bun.serve()` / Express in teardown to prevent hung processes.

## Vision Alignment (Before Writing Code)

- **Explicit over implicit** — explicit builders/layers, no hidden globals
- **Observable over opaque** — visible in EventBus/ThoughtTracer events, not console.log
- **Type-safe** — precise types, no `any` / `unknown` escape hatches
- **Composable** — small Effect-TS services, independently testable
- **Efficient** — respects token/latency budgets, works on local + cloud models
- **Secure** — honors guardrails, no secret leaks, production-safe defaults

---

## Development Workflow

### Before Starting Work

1. Read this `AGENTS.md` for project status, build commands, architecture overview, and workflow rules
2. Query the Obsidian oracle via `obsidian-vault-query` — check prior [[Decisions]], [[Experiments]], [[Running Issues Log]], and any concept notes touching your work
3. Read the relevant spec in `wiki/Architecture/Specs/` for the feature you're implementing
4. Check `wiki/Planning/Implementation-Plans/` for active plans relevant to your work
5. Load relevant skills (`effect-ts-patterns`, `architecture-reference`, `llm-api-contract`)

### Build & Test Cycle

Builds are orchestrated by **Turborepo** (`turbo.json` at repo root). Task order derives from each package's `dependencies`; no manual script chaining required. Outputs are cached in `.turbo/`; a no-op rebuild completes in under a second.

```bash
bun install                   # Install dependencies
bun test                      # Run full suite via turbo (respects cache)
bun test --watch              # Watch tests during development
bun run typecheck             # Workspace-wide TypeScript checks (no implicit any)
bun run build                 # Build all packages and apps via turbo (ESM + DTS)
bun run build:packages        # Build workspace packages only
bun run build:apps            # Build apps only (CLI, cortex UI)
bun run build:clean           # Force rebuild, bypassing cache
bun run clean                 # Remove dist outputs and turbo cache
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

## Team-Ownership Dev Contract (STANDING CONVENTION — canonicalized 2026-06-15)

> **Status:** canonical. The 2026-05-23 → 2026-06-15 ablation pilot ([`wiki/Planning/Implementation-Plans/2026-05-23-team-ownership-dev-contract-pilot.md`](wiki/Planning/Implementation-Plans/2026-05-23-team-ownership-dev-contract-pilot.md)) **concluded with a CANONICALIZE verdict (2026-06-15)** — domain-scoped wardens proved useful and are **kept, not reverted**. Warden routing is now the standing convention for domain-scoped edits.

### Forcing function (standing convention)

Any edit whose primary scope falls in the table below is routed through the listed warden via `Agent` dispatch with a valid MissionBrief (MissionBrief-in → UpwardReport-out). The warden owns its domain; the main thread dispatches, verifies, and integrates.

| Primary scope | Warden |
|---|---|
| `packages/reasoning/src/kernel/**` | `kernel-warden` |
| `packages/llm-provider/**` | `provider-warden` |
| `packages/tools/**` | `tools-warden` |
| `packages/memory/**` | `memory-warden` |
| `packages/runtime/**` | `runtime-warden` |
| `packages/compose/**` | `compose-warden` |
| Framework probes, `wiki/Research/Harness-Reports/**` | `harness-warden` |
| Default-on toggles, new mechanisms, ablation matrices | `ablation-warden` |
| Pre-tag audit, version-drift check, release pipeline | `release-warden` |
| Post-merge AAR, debrief file in `wiki/Research/Debriefs/**` | `debrief-scribe` |

**Single exception:** hot-fix to red CI on `main`, logged with `bypass-reason` in `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md`.

### Required schemas

- `MissionBrief` — input contract, see `.agents/skills/mission-brief/SKILL.md`
- `UpwardReport` — output contract, see `.agents/skills/upward-report/SKILL.md`

### Dispatcher FSM (main-thread behavior on warden output)

| Report state | Parent action |
|---|---|
| `completed`, confidence ≥ 0.7 | Run verifier (typecheck + targeted tests). Pass → accept. |
| `completed`, confidence < 0.7 | Run verifier + ablation-warden if change is a new mechanism. **Never** re-prompt warden for self-review (M3 REWORK precedent). |
| `failed`, blockers present, retries remain | Re-dispatch with blockers injected into next MissionBrief.key-tasks. |
| `failed`, retries exhausted OR escalation-required | Escalate via `AskUserQuestion`. |
| `denied-by-authority` | Escalate. Authority widening = user decision. |
| `blocked` | Surface blocker to user; do not re-dispatch. |

### Anti-patterns (refuse these — load-bearing)

- ❌ Parent re-prompts warden to "review your own work" — recreates `verifier.ts:217-222` failure mode and M3 verify-retry loop.
- ❌ Silent retry past `retries-allowed` in MissionBrief.
- ❌ Warden widens its own authority without parent gate.
- ❌ New warden role added to the warden set without `ablation-warden` PASS verdict (≥2 tiers, ≥3pp lift, ≤15% token overhead).
- ❌ Domain warden patches code outside its authority manifest — must escalate via `denied-by-authority` and let parent dispatch the correct warden.
- ❌ Harness / ablation / debrief-scribe / release wardens editing `packages/**/src/**` directly. They surface findings; domain wardens fix.

### Logging requirement

Every task routed through any warden: append one YAML block to `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md` per the format documented there. Include `warden: <name>` field.

### Canonicalize verdict (2026-06-15)

The team-ownership contract graduated from pilot to standing convention on **2026-06-15**. **Owner:** Tyler. **Evaluator:** `ablation-warden`, applying its own lift rule to the aggregate. **Decision: canonicalize** — domain-scoped warden routing (MissionBrief-in → UpwardReport-out, dispatcher FSM, anti-patterns) is kept, not reverted. The old pilot / expiry / default-revert framing is retired; the convention above is now standing.

---

## Plans, Specs & Knowledge Storage (Agent-Agnostic)

**The `wiki/` directory is the single source of truth for all project knowledge.** This applies to every AI agent working on this repo (Claude Code, Cursor, Codex, Aider, GitHub Copilot, etc.) and human contributors alike.

### Storage Convention

| Content Type | Location | Naming |
|--------------|----------|--------|
| **Implementation plans** | `wiki/Planning/Implementation-Plans/` | `YYYY-MM-DD-<feature-name>.md` |
| **Architecture specs** | `wiki/Architecture/Design-Specs/` | `YYYY-MM-DD-<spec-name>.md` |
| **Canonical project specs** | `wiki/Architecture/Specs/` | `NN-NAME.md` (numbered, authoritative) |
| **Decisions/RFCs** | `wiki/Decisions/` | `YYYY-MM-DD-<decision-name>.md` |
| **Post-feature debriefs** | `wiki/Research/Debriefs/` | `YYYY-MM-DD-<feature>-debrief.md` |
| **Audit reports** | `wiki/Research/Audit-Reports-YYYY-MM-DD/` | descriptive names |
| **Failure modes** | `wiki/Failure-Modes/` | `FM-<X>-<name>.md` |
| **Experiments** | `wiki/Experiments/` | `YYYY-MM-DD-<name>.md` |

### Hard Rules

1. **NO new files in `docs/`** — that directory was eliminated in May 2026 consolidation. Plans, specs, debriefs all go to `wiki/`.
2. **`docs/superpowers/plans/` is DEPRECATED** — superpowers `writing-plans` skill should target `wiki/Planning/Implementation-Plans/`. If a plan lands in the deprecated location, move it.
3. **All agents follow the same convention** — Claude Code, Cursor, Codex, Aider, etc. write to wiki. There is no agent-specific plan directory.
4. **Update the index after writing** — after creating any plan/spec/decision, append to the relevant index page (`wiki/Planning/Planning-Index.md`, `wiki/Decisions/Decision-Index.md`, etc.).
5. **Use frontmatter** — every wiki file gets `---` YAML frontmatter with `type`, `status`, `created`, `tags`.

### For superpowers `writing-plans` Skill Users

Despite the skill's default suggestion of `docs/superpowers/plans/`, **always override to `wiki/Planning/Implementation-Plans/YYYY-MM-DD-<feature>.md`** in this repo. The override is the project convention, not a per-session choice.

### Why This Matters

- **Token optimization**: One vault, one index, one query — agents don't waste context searching multiple directories
- **Cross-agent continuity**: Cursor finds Claude's plan, Codex finds Aider's debrief — no agent-specific silos
- **Obsidian graph**: Wikilinks and MOCs make knowledge navigable; scattered files break the graph
- **Reduced clutter**: Root has 6 .md files (conventions + entry points), all knowledge lives in `wiki/`
- **Single source of truth**: No "is the spec in docs/ or wiki/?" confusion

### Canonical Wiki Workflow (for All Agents)

The wiki is interactive infrastructure, not a passive folder. **Read [[wiki/Development/Wiki-Workflow|wiki/Development/Wiki-Workflow.md]] before any session that touches `wiki/`.** It defines the standard 4-step pattern:

```
1. ORIENT  — claude-obsidian:wiki-query before forming hypotheses
2. CAPTURE — claude-obsidian:obsidian-markdown for any wiki write
3. PERSIST — claude-obsidian:save / wiki-ingest for durable artifacts
4. MAINTAIN — claude-obsidian:wiki-lint + wiki-fold periodically
```

**claude-obsidian skill family** (use these instead of raw `grep`/`find`/`Write` when working with the wiki):

| Skill | One-liner |
|-------|-----------|
| `wiki-query` | Smart query (hot cache + index + drill-down). Beats grep. |
| `wiki-ingest` | Ingest URL/file/transcript → structured wiki page with entities + concepts |
| `wiki-lint` | Health check: orphans, dead links, stale frontmatter |
| `wiki-fold` | Roll up high-volume logs into compact meta-pages |
| `save` | Save current conversation/insight as wiki page with frontmatter |
| `obsidian-markdown` | Validate OFM correctness (wikilinks, callouts, properties) |
| `obsidian-bases` | Create `.base` files for dynamic database views |
| `canvas` | Visual canvas for spatial layouts |
| `autoresearch` | Autonomous web research → wiki ingest synthesis |
| `defuddle` | Strip web clutter before wiki-ingest |
| `wiki` | Bootstrap/check vault structure |

**Existing dynamic Bases** (`.base` files for filtered views — beat manual indexes):
- `wiki/Planning/active-plans.base` — all plans with `status: active`
- `wiki/Experiments/by-verdict.base` — M-series grouped by KEEP/IMPROVE/REMOVE
- `wiki/Failure-Modes/by-severity.base` — FMs sorted by impact
- `wiki/Research/Harness-Reports/recent.base` — reports from last 30 days

Skills that integrate with this workflow: `harness-improvement-loop`, `update-docs`, `architecture-audit`, `architecture-reference`, `effect-abstraction-audit`, `prepare-release`. New skills should follow the same pattern.

---

## Documentation Workflow

### When to Update What

| Trigger                        | Files to Update                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **New package created**        | `AGENTS.md` (package map/status), `README.md` (packages table), `CHANGELOG.md`, architecture-reference skill, docs site sidebar        |
| **New/changed builder method** | `README.md` (quick start + capabilities), `apps/docs/src/content/docs/reference/builder-api.md`, `AGENTS.md` (architecture/workflow)   |
| **New CLI command**            | `README.md` (CLI section), `apps/docs/src/content/docs/reference/cli.md`, `AGENTS.md` (CLI/build workflow)                             |
| **Test count changed**         | Bump `tests` in `apps/docs/src/data/metrics-cache.json`, then `bun run --cwd apps/docs metrics:sync-readme` — home page picks it up automatically |
| **New reasoning strategy**     | `README.md` (strategies table), `apps/docs/src/content/docs/guides/reasoning.md`                                                       |
| **New LLM provider**           | `README.md` (providers table), `apps/docs/src/content/docs/features/llm-providers.md`, `AGENTS.md` (env vars/workflow notes if needed) |
| **New feature page needed**    | `apps/docs/src/content/docs/features/<name>.md` or `guides/<name>.md`                                                                  |
| **API signature change**       | Search all docs for old signature and update: `grep -r "oldMethod" apps/docs/`                                                         |
| **Version bump / release**     | Add a changeset (`bun run changeset`) — versions and CHANGELOG are managed automatically                                               |

### Docs Site (Starlight/Astro)

Location: `apps/docs/`

```bash
bun run docs:dev              # Preview locally (auto-runs metrics generator)
bun run docs:build            # Build for production (auto-runs metrics generator)
bun run docs:preview          # Preview built docs
```

Key files:

- `astro.config.mjs` — sidebar structure (autogenerated from directories)
- `src/content/docs/` — all documentation pages
- `src/content.config.ts` — content collections (Astro 6 Content Layer: `docsLoader()` + schemas; custom loaders live under `src/content/`)
- `src/data/metrics.json` — **build-time generated**, single source of truth for stat numbers (gitignored — always regenerated)
- `src/data/metrics-cache.json` — committed snapshot of the latest `bun test` pass count (manually editable)
- `scripts/generate-metrics.ts` — derives counts from filesystem + canonical source

### Drift-Prone Stats Are Now Dynamic

**Stop hand-editing "5,028 tests" / "30 packages" / "12 phases" / "5 strategies" / "6 providers" anywhere in the docs.** They're derived at build time from filesystem + `packages/runtime/src/types.ts`. The home page reads them via:

```mdx
import metrics from '../../data/metrics.json'
{metrics.grandTotal} {metrics.tests.toLocaleString()} {metrics.providers}
```

When to refresh:

| You did this                                               | Refresh by running                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| Added / removed / privatized a package                     | `bun run --cwd apps/docs metrics` (auto on next docs build)         |
| Added / removed an app                                     | same                                                                |
| Added a reasoning strategy or LLM provider                 | same                                                                |
| Added a new lifecycle phase                                | same                                                                |
| Ran `bun test` locally and the pass count changed          | edit `apps/docs/src/data/metrics-cache.json` → bump `tests`, then run the metrics command above |
| Want to keep README in sync with the generated `metrics.json` | `bun run --cwd apps/docs metrics:sync-readme` (or `metrics:check` for CI dry-run) |

Adding a new dynamic stat: edit `apps/docs/scripts/generate-metrics.ts`, add the new field to the JSON output, then reference it in any `.mdx` page via `{metrics.yourField}`. See `apps/docs/scripts/README.md` for the full contract.

### README.md

The README is the public face. Keep it accurate:

- Badge row at top
- Architecture diagram reflects actual layers
- Packages table lists all published packages
- Test counts match reality — but **don't hand-edit them; run `bun run --cwd apps/docs metrics:sync-readme`** to apply the latest generated values
- Code examples use actual API signatures (test them!)

### ROADMAP.md

Root `ROADMAP.md` is the authoritative forward-looking plan. Update when:

- A milestone ships (move from "target" to "✅ Released")
- Scope changes for a future version
- New competitive intelligence changes priorities

---

## Multi-Agent Coordination (Large Features)

**Build order:**
`core` → `llm-provider` → `{memory, tools, reasoning}` → `runtime`

**Handoff protocol:**

1. What completed (files created/modified)
2. What verified (tests passed, build clean)
3. What's next (unblocked dependent work)
4. Blockers/deviations

---

## New Package Checklist

1. [ ] `packages/<name>/{package.json, tsconfig.json, tsup.config.ts}`
2. [ ] `src/{types.ts, errors.ts, services/*, runtime.ts, index.ts}`
3. [ ] Tests in `tests/`; ensure all pass
4. [ ] Declare deps in `package.json` (turbo derives build order)
5. [ ] `bun test packages/<name>` + `bun run build` pass
6. [ ] Update `AGENTS.md` package map, `README.md` table, architecture-reference skill

---

## Quality Gates

**Before PR:** tests pass, build clean, patterns pass (`/review-patterns`), docs accurate

**Before release:** all above + changeset added, docs site builds, README/ROADMAP updated

> Never manually bump versions or edit CHANGELOG — changesets automation handles it.

---

## Stackblitz Examples Guard

`apps/stackblitz/` contains standalone npm projects for browser demos. Never add `workspace:*` deps to any `package.json` under `apps/stackblitz/` — these projects must resolve from the npm registry. Verify:

```bash
grep -r "workspace:" apps/stackblitz/ && echo FAIL || echo PASS
```

---

## Release Workflow (Changesets)

**Every PR touching user-facing behavior:** `bun run changeset` → creates `.changeset/<name>.md` → commit with code

**Release cycle:** changesets/action auto-creates "chore: version packages" PR → merge → publishes to npm

**Bump types:** `patch` (fixes), `minor` (features), `major` (breaking)

**All 22 packages move together** (fixed group in `.changeset/config.json`). `@reactive-agents/benchmarks` is private (never published).

---

## Key File Paths

| Category             | Path                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent onboarding** | **START HERE:** `QUICK_START.md` (5 min) + `NAVIGATION.md` (repo structure)                                                             |
| **Memory**           | `.agents/MEMORY.md` — cross-session project context, status, patterns, known issues                                                      |
| **Knowledge vault**  | `wiki/` — single source of truth: Architecture, Concepts, Planning, Reference, Research, Development. Query via `obsidian-vault-query`. |
| **Canonical specs**  | `wiki/Architecture/Specs/` — uniform NN-NAME.md numbering; see `DOCUMENT_INDEX.md` for authority hierarchy                              |
| **Implementation plans** | `wiki/Planning/Implementation-Plans/` — ALL plans go here, regardless of agent (Claude/Cursor/Codex/etc.)                          |
| **Design specs**     | `wiki/Architecture/Design-Specs/` — feature design documents                                                                             |
| **Debriefs**         | `wiki/Research/Debriefs/` — post-feature engineering notes                                                                               |
| **Audit reports**    | `wiki/Research/Audit-Reports-*/` — periodic audits and reviews                                                                          |
| **Harness reports**  | `wiki/Research/Harness-Reports/` — phase validations, baselines, regressions, improvement loop artifacts (REPORTS_DIR in gate runner)   |
| **Spike prototypes** | `wiki/Research/Prototypes/` — pNN spike scripts + RESULTS-pNN.md + RESEARCH_LOG.md (Research Discipline Rule 5)                          |
| **Cortex app**       | `apps/cortex/AGENTS.md` — Bun/Elysia server + SvelteKit UI; read before changing                                                        |
| Skills               | `.agents/skills/` (24 contributor skills), `.claude/skills/` (optional), `apps/docs/skills/` (consumer-facing)                          |
| Packages             | `packages/{core,llm-provider,memory,...}/` — see NAVIGATION.md §Package Map                                                             |
| CLI                  | `apps/cli/`                                                                                                                              |
| Public docs          | `apps/docs/src/content/docs/` — Astro/Starlight site (docs.reactiveagents.dev)                                                          |
| Examples             | `apps/examples/` (34 usage patterns)                                                                                                     |

> **Note:** `.agents/MEMORY.md` contains cross-agent project memory — current status, build patterns, architecture decisions, known issues, and roadmap. All agents should read it before starting work and update it after completing significant features.
>
> **Oracle vault:** lives in the repo at `wiki/`. Typed-frontmatter notes for every package, concept, decision, experiment, failure mode, and release. **Read `wiki/Hot.md` first** (≤500-word recent-context cache), then `wiki/Home.md` for the index, then drill into the relevant MOC. At session close, regenerate `wiki/Hot.md` and append to `wiki/Log.md`. Use `obsidian-vault-query` to query, `obsidian-vault-sync` to write durable artifacts (Decisions, Experiments, Sessions, Concept updates), and `obsidian-vault-hygiene` for periodic graph health (orphan / bitrot / duplicate / broken-link loops). The vault's own `wiki/CLAUDE.md` and `wiki/Playbooks/Vault Operations.md` are the canonical protocols.

## Project Skills Index

Canonical project skills live in `.agents/skills/`:

- `architecture-reference` — dependency graph, build order, kernel/MCP navigation
- `build-coordinator` — multi-agent coordination workflow
- `build-package` — add a net-new `@reactive-agents/*` package to the monorepo
- `agent-tdd` — Effect-TS TDD: timeouts, Effect.flip, server teardown
- `kernel-extension` — composable kernel phases, guards, meta-tools
- `kernel-debug` — symptom-to-phase debugging map
- `provider-streaming` — provider streaming quirks and adapter hooks
- `mcp-integration` — MCP client, Docker lifecycle, transport inference
- `reactive-feature-dev` — end-to-end feature workflow routing
- `prepare-release` — pre-flight checks, changeset, release doc template
- `effect-ts-patterns` — mandatory Effect-TS patterns and anti-patterns
- `implement-service` — service creation workflow
- `implement-test` — test creation workflow
- `llm-api-contract` — LLM API signatures and tool-calling contracts
- `memory-patterns` — memory/SQLite/FTS/vec patterns
- `review-patterns` — 9-category compliance review (incl. kernel extension)
- `update-docs` — documentation + skills + memory synchronization workflow
- `validate-build` — quality gate checklist for build/test/review
- `effect-abstraction-audit` — architectural analysis for abstraction opportunities, composability gaps, and Effect-TS engineering quality
- `architecture-audit` — system-level architecture health check: dead code, layer violations, over-abstraction, documentation drift, and simplification opportunities
- `execute-backlog` — SCAN → BUNDLE → PLAN → EXECUTE → VERIFY → UPDATE → RETRO loop over GitHub issue backlog. Self-improving: every retro must amend this skill. Supports parallel agent teams via label-scoped bundles.
- `obsidian-vault-query` — read the Obsidian vault (external project oracle) at session start
- `obsidian-vault-sync` — write durable artifacts (decisions, experiments, sessions) to the vault
- `obsidian-vault-hygiene` — orphan / bitrot / duplicate loops keeping the vault graph coherent

---

## Architecture Debt

> **▶ Latest audit: 2026-06-02 — `wiki/Research/Audit-Reports-2026-06-02/architecture-health-audit.md`.** Verdict: foundation strong (clean layers, acyclic kernel/0 cycles, single arbitrator, canonical `project()` data-flow); typed-guarantee layer mid-migration ON-PLAN (3/5 contracts as types); ONE earned enforcement gap = **I4 single capability resolver** (5 entry points, caused the qwen3.5→fallback bug); real vision-gap = **Pillar 8 capability axis parked** (convergence Phase 2 recitation + experience-reuse = 0 matches). Structural hygiene near-done; don't polish cleanliness (A−) while capability axis (D) is where the vision lives.

> Last audited: 2026-06-01 (agentic-core scope: `packages/reasoning`). Status column reflects current code reality.
>
> **2026-06-01 note (branch `overhaul/agentic-core-2026-05-31`):** most structural
> duplication an audit would flag here — the `messages[]`/`steps[]` two-record split,
> parallel context builders (`curate()` vs `project()`), ~10 termination decision sites,
> and dual context substrates (thread `project()` vs single-shot planner prompts) — is
> **intended transitional state** the overhaul is actively collapsing. It is tracked by
> the 2026-05-31 design specs (agentic-core-overhaul, canonical-context-assembly,
> termination-decider-collapse, cutover-leg-b-substrate-unification) and is NOT logged
> below as fresh debt. Rows added below are items NOT covered by those specs.

| Area | File | Problem | Effort | Impact | Status |
|------|------|---------|--------|--------|--------|
| Dead code | `context-engine.ts` | `buildDynamicContext`, `scoreContextItem`, `allocateContextBudget` unused (~50% of file vestigial) | Medium | Medium | Fixed (Apr 13) |
| Dead config | `context-profile.ts` | `promptVerbosity`, `rulesComplexity`, `fewShotExampleCount`, `compactAfterSteps`, `fullDetailSteps` inert | Medium | Medium | Fixed (Apr 13) |
| Dead config | `kernel-state.ts` | `synthesisConfig` consumed by output synthesis in `kernel-runner.ts`, not by ICS — naming is misleading | Low | Low | Fixed (May 2026) — docstring clarified at field declaration; rename declined to avoid >10-site ripple. |
| Dead API | `message-window.ts` | `applyMessageWindow` + `contextBudgetPercent` unused; only `applyMessageWindowWithCompact` is live | Low | Low | Fixed (Apr 13) |
| Parallel systems | `think.ts` / `tool-execution.ts` / `tool-formatting.ts` / `act.ts` | Two overlapping result presentations remain: FC tool_result compression and extractObservationFacts | High | High | Partially addressed (auto-forward fully removed Apr 13; `tool-utils.ts` split Apr 2026) |
| Config duplication | `kernel-runner.ts` / `context-profile.ts` | `toolResultMaxChars`/`toolResultPreviewItems` duplicate `resultCompression.budget`/`previewItems` as profile defaults | Low | Low | Fixed (May 2026) — `context-profile.ts` now documents resolution order and fallback chain so both names remain readable with explicit intent. |
| Stale docs | `context-engine.ts` | File header says "unified scoring, budgeting, and rendering" | Low | Low | Fixed (Apr 13) |
| Stale docs | `context-builder.ts` | File deleted in Apr 2026 — `context-manager.ts` (`ContextManager.build`) is the canonical assembler invoked from `think.ts:391`. Header in context-manager.ts now accurately reflects scope. | Low | Low | Fixed (May 2026) |
| Parallel context | `context-manager.ts` / `context-builder.ts` | `ContextManager.build()` is now the sole live path — `think.ts:208` calls it; see note at `phases/think.ts:182` | Medium | High | Fixed (Apr 2026) — context-manager.ts is canonical |
| Type duplication | `kernel-state.ts` | `ReActKernelInput` duplicates ~25 fields from `KernelInput` — zero `as ReActKernelInput` casts remain in `packages/reasoning/src` | Medium | High | Fixed (Apr 2026) |
| Untyped meta | `kernel-state.ts` | `state.meta: Record<string, unknown>` accessed via `as any` casts — now only 4 occurrences in 2 files (`reactive-observer.ts`, `think.ts`) | Medium | High | Partially fixed (Apr 2026) |
| Layer violation | `service-utils.ts` | `reasoning` imported `@reactive-agents/prompts` — zero matches remain in `packages/reasoning/src` for `@reactive-agents/(runtime\|prompts\|reactive-agents)` imports | Medium | Medium | Fixed (Apr 2026) |
| Scope creep | `tool-utils.ts` | Originally 944 LOC, 5+ concerns — split into `tool-execution.ts` (752), `tool-formatting.ts` (448), `tool-gating.ts` (263), `tool-parsing.ts`, `tool-capabilities.ts` | Medium | Medium | Fixed (Apr 2026) — split into 5 files |
| Dead production code | `context-manager.ts` | Now actively used — `ContextManager.build()` called from `think.ts:208` | Medium | Medium | Fixed (Apr 2026) |
| Dead production code | `evidence-grounding.ts` | Located at `packages/reasoning/src/kernel/capabilities/verify/evidence-grounding.ts` (kernel reorganized to capabilities/ in Stage 5; previous `kernel/utils/` path stale), imported by `think-guards.ts:28` | Low | Low | Fixed (May 2026, path corrected 2026-05-21) |
| Dead production code | `context-utils.ts` | Now imported by `think.ts:20` AND `context-manager.ts:24` | Low | Medium | Fixed (Apr 2026) |
| Barrel leak | `kernel/index.ts` | `export *` from 13 modules leaks internal utils like `tool-execution.ts`, `tool-formatting.ts` as public API | Medium | Medium | Fixed (May 2026) — stale audit finding; `kernel/index.ts` does not exist. The package's curated re-export barrel is `packages/reasoning/src/index.ts` (lines 148-210), already named-exports-only. |
| Loop vs switch | `loop-detector.ts`, `kernel-runner.ts` | Loop streak logic can mask duplicate-tool patterns so `strategySwitching` may never trigger (see `.agents/MEMORY.md` W8) | Medium | Medium | Open |
| Orchestration monoliths | `runtime/src/builder.ts`, `runtime/src/execution-engine.ts` | Both decomposed in W23/W24/W25: builder.ts 6,232 → 2,407 LOC (-61%); execution-engine.ts 4,499 → 1,539 LOC (-66%). 39 submodules now under `engine/`, `builder/`, `agent/` subdirs. `reactive-agent.ts` extracted as separate file. | High | High | Fixed (May 2026) |
| Layer typing | `builder.ts` `buildEffect()` | 6× `Layer.Layer<any, any>` casts at every layer-merge reassignment. Root cause: structural `BuilderRuntimeStateView` interface needs casts to satisfy Effect's Layer typing. Fixing requires narrowing the view to actually-consumed fields then dropping casts. Found by W25 audit (May 2026). | Medium | Medium | Fixed (May 2026) — 6 → 1 cast: `BuildBaseRuntimeResult` tightened from `<any,any,any>` to `<unknown,unknown,unknown>`; helper signatures widened to `Layer<unknown,unknown,unknown>`. Remaining 1× boundary cast at `ManagedRuntime.make()` is documented inline (15+ conditional sub-layers materialize an opaque service union). |
| Service typing | `agent/{gateway-bootstrap,gateway-tick,gateway-driver}.ts`, `builder/build-effect/tool-init-layer.ts` | 6× `(svc as any).method()` and `yield* Service as any` patterns. Gateway/Scheduler/EventBus/ToolService typed `unknown` in deps interfaces. A shared `yieldService<T>(tag): T` helper would eliminate boilerplate. | Medium | Medium | Fixed (May 2026) — `yieldService<I,S>(tag)` helper added to `builder/helpers.ts`; all 6+ cast patterns removed; Deps interfaces now use `Context.Tag.Service<typeof ...>`. |
| Persona composition | `builder.ts:2042`, `builder/build-effect/local-agent-tools.ts:116`, `builder/build-effect/sub-agent-executor.ts:167` | 3 sites duplicate `composePersonaToSystemPrompt(persona, systemPrompt)` then `${personaPrompt}\n\n${composedSystemPrompt}` concat. A `buildSubAgentSystemPrompt()` wrapper in `builder/helpers.ts` would centralize. | Low | Low | Fixed (May 2026) — `buildSubAgentSystemPrompt(persona, systemPrompt, agentName)` added to `builder/helpers.ts`; all 3 call sites collapsed. |
| Sub-agent path duplication | `builder/build-effect/local-agent-tools.ts`, `builder/build-effect/spawn-handlers.ts` | `.withAgentTool(name, agent)` (fixed-config) and `.withDynamicSubAgents()` (dynamic spawn) create overlapping registrations. Dynamic path is a strict superset of fixed; fixed could become a `singletonAgentMode` of dynamic with ~60 LOC saved. | Medium | Medium | Open |
| Strategy duplication | `packages/reasoning/src/strategies/direct.ts`, `reactive.ts` | Both delegate to `runKernel(reactKernel, ...)`; only difference is `maxIterations` (1-3 vs unbounded). Could merge as `coreReactive(maxIterations?)` with backward-compat aliases. ~494 LOC affected. | Medium | Medium | Open |
| Config view bloat | `builder/build-effect/runtime-construction.ts` | `BuilderRuntimeStateView` declares ~155 fields mirroring builder 1:1, but only ~98 are actively read in this module. Narrowing to `Pick<ReactiveAgentBuilder, '_provider' \| '_model' \| ...>` (or a manual `KernelInputBuildDeps` of ~40 fields) would clarify intent and unblock the Layer-cast fix. | Low | High | Fixed (May 2026) — stale audit finding; W25-B step 7 had already narrowed the view to 67=67 fields. Layer-cast fix was actually unblocked by tightening `BuildBaseRuntimeResult` (see Layer typing row). |
| RiHooks duplication | `builder.ts` (private `_riHooks` field at ~L378, `withReactiveIntelligence` overload at ~L1670), `builder/ri-wiring.ts` (exported `RiHooks`) | 3 declarations of the same 6-hook shape, all with `any` payloads. Unifying via a single import from `ri-wiring.ts` would remove ~25 LOC. | Low | Low | Fixed (May 2026) — `builder.ts` now imports canonical `RiHooks` type from `./builder/ri-wiring.js`; the `withReactiveIntelligence` overload uses `RiHooks & { constraints?: …; autonomy?: … }` for the orthogonal fields. |
| Naming clarity | `runtime/src/gateway-chat.ts` | Module is *utility formatting* for gateway-specific history/episodic context, not parallel chat handling. Rename to `gateway-context-formatting.ts` would clarify scope. Public re-exports preserve API. | Low | Low | Fixed (May 2026) — renamed to `gateway-context-formatting.ts`; importers updated; the `gateway-chat-${agentId}-${senderId}` session-key prefix preserved (persistence identifier, not import path). |
| Coupling hotspot | `runtime/src/types.ts`, `runtime/src/builder/types.ts` | God-modules with 360+ inbound imports across 17+ packages. Acceptable centrality for core config + event types, but `ProviderName` and `OutputFormat` could move to `@reactive-agents/core` to reduce builder/types as a hub. Document or refactor in next sprint. | Low | Medium | Open |
| Orphan prototype | `reasoning/src/overhaul/result-store.ts` (+ test) | `ResultStore` class (put/get/summarize/materialize) had **zero non-test callers** repo-wide — superseded by the wired `assembly/result-store.ts` (content-hash + `preview()`). (Sibling `overhaul/context-projection.ts` is NOT orphaned — it's wired under the `RA_OVERHAUL` gate at `attend/context-utils.ts:16,241`, transitional.) | Low | Med | Fixed (deleted 2026-06-01) — remaining overhaul tests green |
| Dead config | `reasoning/src/types/config.ts` | `PlanExecuteConfigSchema.patchStrategy` declared + asserted only in `tests/types/plan-config.test.ts`, never read by any source path (siblings `stepRetries`/`planMode`/`reflectionDepth` are all consumed). YAGNI field. | Low | Low | Open |
| as any | `reasoning/src/kernel/capabilities/reflect/reactive-observer.ts` | 2 of the only 3 `as any` casts in all of reasoning `src` live here (violates project clean-types rule). `KernelState.meta` is otherwise properly typed `KernelMeta` — NOT an open bag. | Low | Low | Open |
| Stale path banner | `reasoning/src/kernel/capabilities/verify/quality-utils.ts` | File header `// File: src/strategies/kernel/quality-utils.ts` points at the pre-Stage-5 location. | Low | Low | Fixed (verified 2026-07-01 audit) |
| DX crash | `tools/src/define-tool.ts:133` | No options validation — wrong field names (`parameters`/`execute` vs `input`/`handler`) crash with `TypeError: schema.ast` instead of an actionable error; found live 2026-07-01. | Low | High | Open |
| Tool authoring gap | `tools/src/define-tool.ts` / `define-tool-simple.ts` | No schema + plain-async + inferred-args shape (AI-SDK style); `tool()` args untyped, `defineTool()` requires Effect; own example casts `as never` (`apps/examples/src/tools/healing-malformed-tool-call.ts:171`). | Medium | High | Open |
| Hardcoded timeout | `llm-provider/src/providers/local.ts` | `Effect.timeout('120 seconds')` not threaded from `.withTimeout()`; bare timeout error (no model/elapsed/hint); server-side request keeps burning GPU after client abandons. Live-reproduced 2026-07-01 under GPU contention. | Low | High | Open |
| Lazy key failure | `runtime/src/build-validation.ts` + provider config | Missing API key warns but `build()` succeeds → late raw 401; env captured at module-import vs build-time read (split-brain). Fail-fast typed build error needed (opt-out flag). | Medium | High | Open |
| Provider duplication | `llm-provider/src/providers/*.ts` | 5 adapters × ~800 LOC similar streaming/retry/format logic; shared base would remove ~200 LOC and centralize quirks. (2026-07-01 audit) | Medium | Medium | Open |

---

## Common Pitfalls

1. **`serviceOption` returns `Option`** — use `Option.isSome()` + `.value`, not direct access
2. **`ContextWindowManager.truncate()`** not `buildContext()` — for kernel FC context, use `message-window.ts` (`applyMessageWindowWithCompact`) + `context-manager.ts` (`ContextManager.build`)
3. **Gemini SDK is `@google/genai`** not `@google/generative-ai`
4. **`mock.module()` in Bun** only intercepts ES `import()`, not CJS `require()`
5. **ReasoningService.execute** takes single params object, not positional args
6. **Starlight / Astro 6 content config** must be `src/content.config.ts` (Content Layer API); `src/content/config.ts` is legacy and fails the build
7. **`workspace:*` is fine for internal deps** — `changeset publish` resolves these correctly. Do not manually replace them with pinned versions.
8. **Never manually bump versions** — `bun run changeset` + the "chore: version packages" PR handles all version bumps and CHANGELOG entries. Manual edits will conflict with changesets.
9. **`PendingGuidance` replaces `steeringNudge`** — harness signals (required tools pending, loop detected, ICS/oracle guidance) are now accumulated in `state.pendingGuidance` and rendered by `think.ts` into the system prompt's `Guidance:` section each turn. Do NOT inject stray `USER` messages for mid-loop guidance; set `pendingGuidance` fields instead.

---

## Current Framework Snapshot (v0.12.0)

- Monorepo scale: **36 packages + 6 apps** (cli, cortex, docs, examples, advocate, stackblitz)
- Verified quality: **7,671 pass / 7,698 tests across 974 files** (2026-07-09) — run `bun test` for the authoritative count before release

> **Meta-loop overhaul on `main` (UNRELEASED — `main` is ahead of the v0.13.5 tag).** The reasoning harness was rebuilt as a one-directional loop (Contract → Ledger → Assessment → Control → Actuators → Projector). Split into two truth-classes when documenting or releasing:
>
> - **Default-on + verified** (in every reasoning run now): append-only evidence ledger (rides crash-resume), deliverable-truth (typed contract + contract-driven terminal gate + `result.receipt.deliverables[]`), honest compaction (dropped refs enumerated), recall round-trip (one reference grammar), per-iteration run `assessment` trace event, and the Phase 3.6 reliability fixes (prior context renders across strategy switches, generous final-synthesis budget, structured-output retry-once, verifier-aware stall guard, non-amputating early-stop).
> - **Opt-in + experimental** (NOT default, NOT "better"): `.withLongHorizon()` (scales guards to `maxIterations`; verified to finish long runs but not lift-gated for default-on) and `.withAdaptiveHarness()` (run-start policy compiler + mid-run recompile; cross-tier ablation **INCONCLUSIVE** — n=1 dev-box noise — so it stays opt-in under the lift-gate veto). `.withContract()` pre-existed but is now load-bearing.
>
> Do not describe the opt-in pair as recommended/default, and do not claim the adaptive harness improves results. CHANGELOG / ROADMAP / version bump belong to the v0.14 release step, not this snapshot.
- Public facade: `reactive-agents` built on Effect-TS layered runtime
- Built-in tools: **9 capability tools** (web-search, crypto-price, http-get, file-read, file-write, code-execute, git-cli, gh-cli, gws-cli) + **9 meta-tools** (context-status, task-complete, final-answer, brief, find, pulse, recall, checkpoint, discover-tools) — *shell-execute is gated via `.withTerminalTools()`, not auto-registered*

### Recently Shipped Highlights (cross-checked with `CHANGELOG.md`)

1. Native function-calling harness with robust fallback behavior, including text JSON tool-call parsing when providers omit native calls
2. Required-tools gate hardening with relevant-tool pass-through, satisfied-required re-calls, and per-tool call budgets (`maxCallsPerTool`)
3. Dynamic stopping improvements (novelty signal + synthesis transition) to reduce research loops
4. Provider adapter completion (7 hooks): `systemPromptPatch`, `toolGuidance`, `taskFraming`, `continuationHint`, `errorRecovery`, `synthesisPrompt`, `qualityCheck`
5. Full model I/O observability with `logModelIO` and raw response capture for FC threads
6. Adaptive strategy reporting now surfaces selected sub-strategy in result metadata (`strategyUsed`, `selectedStrategy`)
7. Web integration hooks packages: `@reactive-agents/react`, `@reactive-agents/vue`, `@reactive-agents/svelte`
8. **Terminal execution tool** — safe shell-execute with allowlist (git, ls, cat, grep, find, node, bun, npm, python, curl, echo, mkdir, cp, mv, wc, head, tail, sort, jq); integrated via `.withTerminalTools()` builder method
9. **Calibration drift detection** — automatic entropy distribution analysis, drift event emission on significant model behavior changes
10. **Adaptive Tool Calling System** — FC probe → `toolCallDialect` profile → `NativeFCDriver`/`TextParseDriver` routing; `HealingPipeline` (ToolNameHealer, ParamNameHealer, PathResolver, TypeCoercer); `ExperienceSummary` closes ExperienceStore dead loop; StallDetector + HarnessHarmDetector RI handlers; default driver inverted to NativeFCDriver for uncalibrated models
11. **Gateway chat mode** — per-sender conversation history with SQLite session persistence, history windowing (40 turns / 8 k chars), episodic context injection, and daily compaction; enable with `channels.mode: 'chat'` (default). Two memory bug fixes also landed: `priorContext` now renders in the system prompt; episodic injection no longer gated behind `enableSelfImprovement`. New `pruneEpisodicLog` on `CompactionService`; `chat-turn` event type added to `DailyLogEntry`. Key file: `packages/runtime/src/gateway-chat.ts`.

### External channels (shipped — merged to `main`)

The **`@reactive-agents/channels`** package is **merged to `main`** (`packages/channels`). It implements **phase 1 external channels**: trigger registry, FIFO session bridge, `ChannelService`, and an optional HMAC webhook adapter, wired to the runtime via **`.withChannels()`**. It also carried a **breaking rename** of gateway config **`channels` → `accessControl`** (chat/task mode stays nested under the new shape). Authoritative write-up: [`wiki/Research/Debriefs/2026-05-03-channels-phase1-development-debrief.md`](wiki/Research/Debriefs/2026-05-03-channels-phase1-development-debrief.md). Starlight and builder examples now describe `.withChannels()` and the `GatewayConfig.accessControl` field.

### Documentation Cross-Reference Rules

When any capability changes, update all three:

1. `CHANGELOG.md` for release history
2. `README.md` for user-facing overview and quickstart
3. `apps/docs/src/content/docs/` for API and behavior details

Do not maintain feature truth in multiple internal guides. Keep this file operational and workflow-focused; keep API truth in Starlight docs.

---

## Consumer Skills (Public — for agents building with the framework)

For AI agents using reactive-agents-ts to build agents on behalf of users.
Served from `apps/docs/skills/`, publicly fetchable at:

- **Discover:** `https://docs.reactiveagents.dev/.well-known/skills/index.json`
- **Fetch:** `https://docs.reactiveagents.dev/.well-known/skills/{skill-name}/`

> **Directory distinction:** `.agents/skills/` = contributor skills (build the framework). `apps/docs/skills/` = consumer skills (use the framework, publicly fetchable).

### Tier 1 — Discovery

- `reactive-agents` — start here: framework orientation, builder API shape, skill routing decision tree

### Tier 2 — Capabilities

- `builder-api-reference` — complete ReactiveAgentBuilder API, layer composition, Effect layers
- `reasoning-strategy-selection` — strategy selection, native FC harness, output quality pipeline
- `context-and-continuity` — context pressure, windowing, checkpoint tool, auto-checkpoint
- `tool-creation` — defineTool(), ToolRegistry, required-tools gate, maxCallsPerTool
- `shell-execution-sandbox` — sandboxed shell tool, Docker sandbox, allowlist config
- `mcp-tool-integration` — Docker lifecycle, two-phase containers, transport inference
- `memory-patterns` — 4-layer memory, SQLite/FTS5/vec, working/episodic/semantic/procedural
- `multi-agent-orchestration` — sequential, parallel, pipeline, map-reduce workflows
- `gateway-persistent-agents` — heartbeats, crons, webhooks, policy engine
- `identity-and-guardrails` — Ed25519 RBAC, injection/PII/toxicity detection, KillSwitch
- `observability-instrumentation` — ThoughtTracer, logModelIO, EventBus tracing, MetricsCollector
- `cost-budget-enforcement` — complexity router, budget enforcer, semantic cache
- `quality-assurance` — runtime verification, LLM-as-judge eval, EvalStore regression
- `ui-integration` — React/Vue/Svelte hooks, SSE streaming, real-time UI patterns
- `interaction-autonomy` — 5 autonomy modes, approval gates, preference learning
- `a2a-agent-networking` — Agent Cards, JSON-RPC 2.0, SSE streaming, A2A server/client
- `provider-patterns` — 7 adapter hooks, native FC patterns, per-provider streaming quirks

### Tier 3 — Recipes

- `recipe-research-agent` — research/analysis agent with memory + verification
- `recipe-code-assistant` — code generation + sandboxed execution agent
- `recipe-persistent-monitor` — always-on monitoring agent via gateway
- `recipe-orchestrated-workflow` — multi-agent pipeline with lead/builder/tester pattern
- `recipe-saas-agent` — multi-tenant production agent with identity + cost controls
- `recipe-embedded-app-agent` — agent embedded in React/Vue/Svelte with streaming UI
