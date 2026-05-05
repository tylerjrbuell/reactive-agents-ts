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
| Tools not called | `packages/reasoning/src/strategies/kernel/phases/think.ts` → `phases/act.ts` |
| Context missing | `phases/context-builder.ts` → `context/message-window.ts` |
| Tool results lost | `utils/tool-execution.ts` → `utils/tool-utils.ts:compressToolResult` |
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

**Required runtime: Bun ≥1.1.0** (W12 — `engines.bun` declared on the 8 published packages with direct `bun:sqlite` or `Bun.*` runtime usage, plus the umbrella). The framework uses `bun:sqlite`, `Bun.spawn`, and `Bun.serve` in core packages. Node.js support is planned — see `wiki/Planning/Implementation-Plans/Superpowers/2026-04-17-nodejs-support.md` for the migration plan.

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
| **Test count changed**         | `AGENTS.md` (build/test references), `README.md` (development section)                                                                 |
| **New reasoning strategy**     | `README.md` (strategies table), `apps/docs/src/content/docs/guides/reasoning.md`                                                       |
| **New LLM provider**           | `README.md` (providers table), `apps/docs/src/content/docs/features/llm-providers.md`, `AGENTS.md` (env vars/workflow notes if needed) |
| **New feature page needed**    | `apps/docs/src/content/docs/features/<name>.md` or `guides/<name>.md`                                                                  |
| **API signature change**       | Search all docs for old signature and update: `grep -r "oldMethod" apps/docs/`                                                         |
| **Version bump / release**     | Add a changeset (`bun run changeset`) — versions and CHANGELOG are managed automatically                                               |

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
- `src/content.config.ts` — content collections (Astro 6 Content Layer: `docsLoader()` + schemas; custom loaders live under `src/content/`)

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
- `obsidian-vault-query` — read the Obsidian vault (external project oracle) at session start
- `obsidian-vault-sync` — write durable artifacts (decisions, experiments, sessions) to the vault
- `obsidian-vault-hygiene` — orphan / bitrot / duplicate loops keeping the vault graph coherent

---

## Architecture Debt

> Last audited: 2026-04-18. Status column reflects current code reality.

| Area | File | Problem | Effort | Impact | Status |
|------|------|---------|--------|--------|--------|
| Dead code | `context-engine.ts` | `buildDynamicContext`, `scoreContextItem`, `allocateContextBudget` unused (~50% of file vestigial) | Medium | Medium | Fixed (Apr 13) |
| Dead config | `context-profile.ts` | `promptVerbosity`, `rulesComplexity`, `fewShotExampleCount`, `compactAfterSteps`, `fullDetailSteps` inert | Medium | Medium | Fixed (Apr 13) |
| Dead config | `kernel-state.ts` | `synthesisConfig` consumed by output synthesis in `kernel-runner.ts`, not by ICS — naming is misleading | Low | Low | Open |
| Dead API | `message-window.ts` | `applyMessageWindow` + `contextBudgetPercent` unused; only `applyMessageWindowWithCompact` is live | Low | Low | Fixed (Apr 13) |
| Parallel systems | `think.ts` / `tool-execution.ts` / `tool-formatting.ts` / `act.ts` | Two overlapping result presentations remain: FC tool_result compression and extractObservationFacts | High | High | Partially addressed (auto-forward fully removed Apr 13; `tool-utils.ts` split Apr 2026) |
| Config duplication | `kernel-runner.ts` / `context-profile.ts` | `toolResultMaxChars`/`toolResultPreviewItems` duplicate `resultCompression.budget`/`previewItems` as profile defaults | Low | Low | Open |
| Stale docs | `context-engine.ts` | File header says "unified scoring, budgeting, and rendering" | Low | Low | Fixed (Apr 13) |
| Stale docs | `context-builder.ts` | Header overstates scope — system prompt with guidance/ICS/progress is assembled in `think.ts` | Low | Low | Open |
| Parallel context | `context-manager.ts` / `context-builder.ts` | `ContextManager.build()` is now the sole live path — `think.ts:208` calls it; see note at `phases/think.ts:182` | Medium | High | Fixed (Apr 2026) — context-manager.ts is canonical |
| Type duplication | `kernel-state.ts` | `ReActKernelInput` duplicates ~25 fields from `KernelInput` — zero `as ReActKernelInput` casts remain in `packages/reasoning/src` | Medium | High | Fixed (Apr 2026) |
| Untyped meta | `kernel-state.ts` | `state.meta: Record<string, unknown>` accessed via `as any` casts — now only 4 occurrences in 2 files (`reactive-observer.ts`, `think.ts`) | Medium | High | Partially fixed (Apr 2026) |
| Layer violation | `service-utils.ts` | `reasoning` imported `@reactive-agents/prompts` — zero matches remain in `packages/reasoning/src` for `@reactive-agents/(runtime\|prompts\|reactive-agents)` imports | Medium | Medium | Fixed (Apr 2026) |
| Scope creep | `tool-utils.ts` | Originally 944 LOC, 5+ concerns — split into `tool-execution.ts` (752), `tool-formatting.ts` (448), `tool-gating.ts` (263), `tool-parsing.ts`, `tool-capabilities.ts` | Medium | Medium | Fixed (Apr 2026) — split into 5 files |
| Dead production code | `context-manager.ts` | Now actively used — `ContextManager.build()` called from `think.ts:208` | Medium | Medium | Fixed (Apr 2026) |
| Dead production code | `evidence-grounding.ts` | Moved to `packages/reasoning/src/strategies/kernel/utils/evidence-grounding.ts`, imported by `think-guards.ts:28` | Low | Low | Fixed (Apr 2026) |
| Dead production code | `context-utils.ts` | Now imported by `think.ts:20` AND `context-manager.ts:24` | Low | Medium | Fixed (Apr 2026) |
| Barrel leak | `kernel/index.ts` | `export *` from 13 modules leaks internal utils like `tool-execution.ts`, `tool-formatting.ts` as public API | Medium | Medium | Open |
| Loop vs switch | `loop-detector.ts`, `kernel-runner.ts` | Loop streak logic can mask duplicate-tool patterns so `strategySwitching` may never trigger (see `.agents/MEMORY.md` W8) | Medium | Medium | Open |

---

## Common Pitfalls

1. **`serviceOption` returns `Option`** — use `Option.isSome()` + `.value`, not direct access
2. **`ContextWindowManager.truncate()`** not `buildContext()` — for kernel FC context, use `message-window.ts` (`applyMessageWindowWithCompact`) + `context-builder.ts`
3. **Gemini SDK is `@google/genai`** not `@google/generative-ai`
4. **`mock.module()` in Bun** only intercepts ES `import()`, not CJS `require()`
5. **ReasoningService.execute** takes single params object, not positional args
6. **Starlight / Astro 6 content config** must be `src/content.config.ts` (Content Layer API); `src/content/config.ts` is legacy and fails the build
7. **`workspace:*` is fine for internal deps** — `changeset publish` resolves these correctly. Do not manually replace them with pinned versions.
8. **Never manually bump versions** — `bun run changeset` + the "chore: version packages" PR handles all version bumps and CHANGELOG entries. Manual edits will conflict with changesets.
9. **`PendingGuidance` replaces `steeringNudge`** — harness signals (required tools pending, loop detected, ICS/oracle guidance) are now accumulated in `state.pendingGuidance` and rendered by `think.ts` into the system prompt's `Guidance:` section each turn. Do NOT inject stray `USER` messages for mid-loop guidance; set `pendingGuidance` fields instead.

---

## Current Framework Snapshot (v0.10.0)

- Monorepo scale: **28 packages + 5 apps** (cli, cortex, docs, examples, meta-agent)
- Verified quality: **4,731 tests across 536 test files** (last workspace run) — run `bun test` for the authoritative count before release
- Public facade: `reactive-agents` built on Effect-TS layered runtime
- Built-in tools: **9 capability tools** (web-search, crypto-price, http-get, file-read, file-write, code-execute, git-cli, gh-cli, gws-cli) + **8 meta-tools** (context-status, task-complete, final-answer, brief, find, pulse, recall, checkpoint)

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

### In flight (merge pending — not on `main` yet)

Branch **`feat/channels-package`** (see worktree `.worktrees/channels` if used locally) implements **phase 1 external channels**: new package **`@reactive-agents/channels`** (trigger registry, FIFO session bridge, `ChannelService`, optional HMAC webhook adapter), runtime **`.withChannels()`**, and a **breaking rename** of gateway config **`channels` → `accessControl`** (chat/task mode stays nested under the new shape). Authoritative write-up: [`wiki/Research/Debriefs/2026-05-03-channels-phase1-development-debrief.md`](wiki/Research/Debriefs/2026-05-03-channels-phase1-development-debrief.md). Until merged, Starlight and builder examples on `main` still describe the current `GatewayConfig.channels` field.

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
