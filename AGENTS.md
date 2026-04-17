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

| Symptom                       | Start reading                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Agent not calling tools       | `packages/reasoning/src/strategies/kernel/kernel-runner.ts` → `phases/think.ts` → `phases/act.ts`        |
| Context truncated / missing   | `phases/think.ts` (system prompt + guidance) → `phases/context-builder.ts` → `context/message-window.ts` |
| Tool results lost / recall    | `utils/tool-execution.ts` (compression) → `utils/tool-utils.ts` (compressToolResult) → `phases/think.ts` |
| EventBus events not firing    | `packages/core/src/services/event-bus.ts` → check `ManagedRuntime` is shared                             |
| LLM call fails silently       | `packages/llm-provider/src/runtime.ts` → provider-specific file in `src/providers/`                      |
| Memory not persisting         | `packages/memory/src/runtime.ts` → check `createMemoryLayer()` wiring                                    |
| Plan-execute loops forever    | `packages/reasoning/src/strategies/plan-execute.ts` → `isSatisfied()` + all-steps-completed guard        |
| Gateway not starting          | `packages/gateway/src/services/gateway-service.ts` → check `.withGateway()` in builder                   |
| Metrics dashboard missing     | `packages/observability/src/services/observability-service.ts` → `MetricsCollectorLive` layer            |
| Custom kernel not registering | `packages/reasoning/src/services/strategy-registry.ts` → `registerKernel()` call                         |

---

## Coding Standards

**Read `CODING_STANDARDS.md` before writing any code.** It covers Effect-TS patterns, type safety, service definitions, error handling, naming, testing, file structure, and anti-patterns. All agents and contributors must conform.

Key references:

-   `FRAMEWORK_INDEX.md` — comprehensive system map with file-level navigation, data flows, and architecture diagrams
-   `CODING_STANDARDS.md` — authoritative coding standards (types, services, errors, testing, naming, performance)
-   `.claude/skills/effect-ts-patterns/SKILL.md` — Effect-TS pattern reference (Schema.Struct, Context.Tag, Layer, Ref)
-   `.claude/skills/review-patterns/SKILL.md` — 9-category compliance checklist for code review

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

-   **Explicit over implicit**: No hidden magic or one-liner “createAgent” helpers. New behavior is configured via explicit builders/layers, not global state.
-   **Observable over opaque**: The behavior is visible in traces/events (EventBus, ThoughtTracer, tracing), without relying on `console.log`.
-   **Type-safe reliability**: Inputs are validated (e.g. Zod schemas), errors are part of explicit tagged unions, and all public APIs use precise, generic-friendly types (no `any`/`unknown` escape hatches).
-   **Composable and testable**: Logic is factored into small, Effect-TS services/middleware that can be wired together and tested independently.
-   **Efficient and local-first**: Code respects token/latency budgets, reuses existing caching/batching/context systems, and works well with local as well as cloud models.
-   **Secure and production-first**: Changes honor guardrails, avoid leaking secrets, and default to safe behavior suitable for production workloads.

---

## Development Workflow

### Before Starting Work

1. Read this `AGENTS.md` for project status, build commands, architecture overview, and workflow rules
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

-   [ ] All tests pass (`bun test`)
-   [ ] Build succeeds (`bun run build`)
-   [ ] Documentation updated (see below)
-   [ ] Changeset added (`bun run changeset`) — see Release Workflow below
-   [ ] No new `TODO`/`FIXME` without a tracking issue
-   [ ] Pattern compliance verified (`/review-patterns <changed-files>`)

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

-   `astro.config.mjs` — sidebar structure (autogenerated from directories)
-   `src/content/docs/` — all documentation pages
-   `src/content.config.ts` — content collections (Astro 6 Content Layer: `docsLoader()` + schemas; custom loaders live under `src/content/`)

### README.md

The README is the public face. Keep it accurate:

-   Badge row at top
-   Architecture diagram reflects actual layers
-   Packages table lists all published packages
-   Test counts match reality
-   Code examples use actual API signatures (test them!)

### ROADMAP.md

Root `ROADMAP.md` is the authoritative forward-looking plan. Update when:

-   A milestone ships (move from "target" to "✅ Released")
-   Scope changes for a future version
-   New competitive intelligence changes priorities

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

-   Packages with no dependency relationship can be built in parallel
-   Always validate gate dependencies before starting dependent work:
    ```
    core → llm-provider → {memory, tools, reasoning} → runtime
    ```
-   Run workspace-wide `bun run build` after each package completes
-   Use `/validate-build <pkg>` before moving to dependent packages

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
14. [ ] Update `AGENTS.md` package map / status snapshot
15. [ ] Update `README.md` packages table
16. [ ] Update architecture-reference skill dependency graph
17. [ ] Add spec file reference to `AGENTS.md` spec index section (if applicable)

---

## Quality Gates

### Before Any PR

| Check              | Command                    | Must              |
| ------------------ | -------------------------- | ----------------- |
| Tests pass         | `bun test`                 | 100% green        |
| Build clean        | `bun run build`            | No errors         |
| Pattern compliance | `/review-patterns <files>` | 9/9 pass          |
| Docs accurate      | Manual review              | No stale examples |

### Before Any Release

| Check            | Details                                                 |
| ---------------- | ------------------------------------------------------- |
| All above        | Plus full integration test                              |
| Changeset added  | `bun run changeset` with a clear summary of all changes |
| Docs site builds | `bun run docs:build`                                    |
| README current   | Stats, packages, examples all accurate                  |
| ROADMAP updated  | Shipped items marked, new targets set                   |

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

| Type    | When to use                                      | Example         |
| ------- | ------------------------------------------------ | --------------- |
| `patch` | Bug fixes, test fixes, docs                      | `0.7.6 → 0.7.7` |
| `minor` | New features, backwards-compatible API additions | `0.7.6 → 0.8.0` |
| `major` | Breaking API changes                             | `0.7.6 → 1.0.0` |

All 22 publishable packages move together (fixed group) — bumping any one package bumps all.

### Private packages (never published)

`@reactive-agents/benchmarks` has `"private": true` and is excluded from publishing. Do not remove this flag.

### Key files

| File                            | Purpose                                          |
| ------------------------------- | ------------------------------------------------ |
| `.changeset/config.json`        | Fixed group of all packages, public access       |
| `.github/workflows/publish.yml` | Runs `changesets/action` on every push to `main` |
| `package.json` `release` script | `bun run build && changeset publish`             |

---

## Key File Paths

| Category             | Path                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Memory**           | `.agents/MEMORY.md` — **read first** for project context, status, patterns, and roadmap                                                  |
| **Cortex app**       | `apps/cortex/AGENTS.md` — Bun/Elysia desk server + SvelteKit UI (Stage/Run), WS ingest/live, SQLite; read before changing `apps/cortex/` |
| Specs                | `spec/docs/`, `docs/superpowers/specs/`                                                                                                  |
| Plans                | `docs/superpowers/plans/`                                                                                                                |
| Skills               | `.claude/skills/`, `.agents/skills/`                                                                                                     |
| Legacy compatibility | `CLAUDE.md` — compatibility pointer to `AGENTS.md` only                                                                                  |
| Packages             | `packages/{core,llm-provider,memory,...}/`                                                                                               |
| CLI                  | `apps/cli/`                                                                                                                              |
| Docs                 | `apps/docs/src/content/docs/`                                                                                                            |
| Examples             | `apps/examples/`                                                                                                                         |
| CI                   | `.github/workflows/`                                                                                                                     |
| v0.5 Plan            | `spec/docs/14-v0.5-comprehensive-plan.md`                                                                                                |

> **Note:** `.agents/MEMORY.md` contains cross-agent project memory — current status, build patterns, architecture decisions, known issues, and roadmap. All agents should read it before starting work and update it after completing significant features.

## Project Skills Index

Canonical project skills live in `.agents/skills/`:

-   `architecture-reference` — dependency graph, build order, kernel/MCP navigation
-   `build-coordinator` — multi-agent coordination workflow
-   `build-package` — add a net-new `@reactive-agents/*` package to the monorepo
-   `agent-tdd` — Effect-TS TDD: timeouts, Effect.flip, server teardown
-   `kernel-extension` — composable kernel phases, guards, meta-tools
-   `kernel-debug` — symptom-to-phase debugging map
-   `provider-streaming` — provider streaming quirks and adapter hooks
-   `mcp-integration` — MCP client, Docker lifecycle, transport inference
-   `reactive-feature-dev` — end-to-end feature workflow routing
-   `prepare-release` — pre-flight checks, changeset, release doc template
-   `effect-ts-patterns` — mandatory Effect-TS patterns and anti-patterns
-   `implement-service` — service creation workflow
-   `implement-test` — test creation workflow
-   `llm-api-contract` — LLM API signatures and tool-calling contracts
-   `memory-patterns` — memory/SQLite/FTS/vec patterns
-   `review-patterns` — 9-category compliance review (incl. kernel extension)
-   `update-docs` — documentation + skills + memory synchronization workflow
-   `validate-build` — quality gate checklist for build/test/review
-   `effect-abstraction-audit` — architectural analysis for abstraction opportunities, composability gaps, and Effect-TS engineering quality
-   `architecture-audit` — system-level architecture health check: dead code, layer violations, over-abstraction, documentation drift, and simplification opportunities

---

## Architecture Debt

| Area | File | Problem | Effort | Impact | Status |
|------|------|---------|--------|--------|--------|
| Dead code | `context-engine.ts` | `buildDynamicContext`, `scoreContextItem`, `allocateContextBudget` unused (~50% of file vestigial) | Medium | Medium | Fixed (Apr 13) |
| Dead config | `context-profile.ts` | `promptVerbosity`, `rulesComplexity`, `fewShotExampleCount`, `compactAfterSteps`, `fullDetailSteps` inert | Medium | Medium | Fixed (Apr 13) |
| Dead config | `kernel-state.ts` | `synthesisConfig` consumed by output synthesis in `kernel-runner.ts`, not by ICS — naming is misleading | Low | Low | Open |
| Dead API | `message-window.ts` | `applyMessageWindow` + `contextBudgetPercent` unused; only `applyMessageWindowWithCompact` is live | Low | Low | Fixed (Apr 13) |
| Parallel systems | `think.ts` / `tool-utils.ts` / `act.ts` | Two overlapping result presentations remain: FC tool_result compression and extractObservationFacts | High | High | Partially addressed (auto-forward fully removed Apr 13) |
| Config duplication | `kernel-runner.ts` / `context-profile.ts` | `toolResultMaxChars`/`toolResultPreviewItems` duplicate `resultCompression.budget`/`previewItems` as profile defaults | Low | Low | Open |
| Stale docs | `context-engine.ts` | File header says "unified scoring, budgeting, and rendering" | Low | Low | Fixed (Apr 13) |
| Stale docs | `context-builder.ts` | Header overstates scope — system prompt with guidance/ICS/progress is assembled in `think.ts` | Low | Low | Open |
| Parallel context | `context-manager.ts` / `context-builder.ts` | Two context assembly paths: `ContextManager.build()` (dead in production) duplicates `context-builder.ts` functions used by `think.ts` | Medium | High | Open |
| Type duplication | `kernel-state.ts` | `ReActKernelInput` duplicates ~25 fields from `KernelInput`; phases use `as ReActKernelInput` casts to access extra fields | Medium | High | Open |
| Untyped meta | `kernel-state.ts` | `state.meta: Record<string, unknown>` accessed via `as any` casts in 34+ locations across kernel phases | Medium | High | Open |
| Layer violation | `service-utils.ts` | `reasoning` imports `@reactive-agents/prompts` — outside its declared dependency boundary (core, llm-provider, memory, tools) | Medium | Medium | Open |
| Scope creep | `tool-utils.ts` | 944 LOC, 5+ concerns (formatting, parsing, gating, injection, planning) — imported by 16 files | Medium | Medium | Open |
| Dead production code | `context-manager.ts` | `ContextManager.build()`, `kernelMessageToLLM()`, `buildIdentity()`, `CURATED_TURNS_BY_TIER` never called in production | Medium | Medium | Open |
| Dead production code | `evidence-grounding.ts` | Zero production callers; only imported by test file | Low | Low | Open |
| Dead production code | `context-utils.ts` | Zero `src/` imports — only re-exported from barrel and used in tests | Low | Medium | Open |
| Barrel leak | `kernel/index.ts` | `export *` from 13 modules leaks internal utils (944 LOC tool-utils, etc.) as public API | Medium | Medium | Open |
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

## Current Framework Snapshot (v0.9.0)

-   Monorepo scale: **25 packages + 2 apps**
-   Verified quality: **3,879 tests across 430 files**
-   Public facade: `reactive-agents` built on Effect-TS layered runtime

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

-   **Discover:** `https://docs.reactiveagents.dev/.well-known/skills/index.json`
-   **Fetch:** `https://docs.reactiveagents.dev/.well-known/skills/{skill-name}/`

> **Directory distinction:** `.agents/skills/` = contributor skills (build the framework). `apps/docs/skills/` = consumer skills (use the framework, publicly fetchable).

### Tier 1 — Discovery

-   `reactive-agents` — start here: framework orientation, builder API shape, skill routing decision tree

### Tier 2 — Capabilities

-   `builder-api-reference` — complete ReactiveAgentBuilder API, layer composition, Effect layers
-   `reasoning-strategy-selection` — strategy selection, native FC harness, output quality pipeline
-   `context-and-continuity` — context pressure, windowing, checkpoint tool, auto-checkpoint
-   `tool-creation` — defineTool(), ToolRegistry, required-tools gate, maxCallsPerTool
-   `shell-execution-sandbox` — sandboxed shell tool, Docker sandbox, allowlist config
-   `mcp-tool-integration` — Docker lifecycle, two-phase containers, transport inference
-   `memory-patterns` — 4-layer memory, SQLite/FTS5/vec, working/episodic/semantic/procedural
-   `multi-agent-orchestration` — sequential, parallel, pipeline, map-reduce workflows
-   `gateway-persistent-agents` — heartbeats, crons, webhooks, policy engine
-   `identity-and-guardrails` — Ed25519 RBAC, injection/PII/toxicity detection, KillSwitch
-   `observability-instrumentation` — ThoughtTracer, logModelIO, EventBus tracing, MetricsCollector
-   `cost-budget-enforcement` — complexity router, budget enforcer, semantic cache
-   `quality-assurance` — runtime verification, LLM-as-judge eval, EvalStore regression
-   `ui-integration` — React/Vue/Svelte hooks, SSE streaming, real-time UI patterns
-   `interaction-autonomy` — 5 autonomy modes, approval gates, preference learning
-   `a2a-agent-networking` — Agent Cards, JSON-RPC 2.0, SSE streaming, A2A server/client
-   `provider-patterns` — 7 adapter hooks, native FC patterns, per-provider streaming quirks

### Tier 3 — Recipes

-   `recipe-research-agent` — research/analysis agent with memory + verification
-   `recipe-code-assistant` — code generation + sandboxed execution agent
-   `recipe-persistent-monitor` — always-on monitoring agent via gateway
-   `recipe-orchestrated-workflow` — multi-agent pipeline with lead/builder/tester pattern
-   `recipe-saas-agent` — multi-tenant production agent with identity + cost controls
-   `recipe-embedded-app-agent` — agent embedded in React/Vue/Svelte with streaming UI
