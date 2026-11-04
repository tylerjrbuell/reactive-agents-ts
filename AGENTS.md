# Reactive Agents — Agent Contract

> Rules every AI agent (Claude Code, Cursor, Codex, Aider, Copilot) follows here. Routing, ownership and gates live in the `bun run repo` CLI (`.agents/skills/repo-tool/SKILL.md`). Background detail: `wiki/Development/Agents-Extended-Reference.md` (read it when touching docs/stats, the wiki, a new package, calibration or warden history).

## Start Here

1. `bun run repo status` — branch, active plans, debt, authority-doc pointers.
2. `bun run repo scope <files>` — owner/warden, checks and docs a change touches (no args = your diff).
3. `bun run repo find "<q>" [--wiki|--code|--scripts]`, then `bun run repo outline <file>` and Read a range. `bun run repo place <path>` before creating a file.
4. Edit with Edit/Write; then `bun run repo test <paths>` and `bun run repo verify <pkg-dir>`.
5. `bun run repo check --all` before commit/handoff.

Required: steps 4–5 before claiming done. Optional: 1–3 (use instead of ad-hoc greps). Hooks enforce the shell rules; when one denies, take the printed alternative.

**Which CLI:** `bun run repo` works on this repo · `rax` uses the framework (user CLI, never for repo checks) · `rax-diagnose` explains a recorded run (`rax-diagnose cause <runId|path>`).

## Agent Efficiency Rules

1. **Subagents only for broad fan-out.** Locate with `bun run repo find` or a direct Read; never spawn one to read a known file.
2. **Browser: text first** (`browser_snapshot`, `get_page_text`); screenshots only when asked.
3. **Browser failures: stop at 2–3**, then report and ask. Do not retry the same navigate/click.
4. **No `cd <abs path> && …`.** Use absolute paths; cwd resets (hook warns).
5. **Wiki: `bun run repo find "<q>" --wiki`** or the Canonical Wiki Index in `wiki/Development/Repo-Navigation.md`. Start with `wiki/Hot.md`. Do not browse `wiki/Home.md` or `wiki/MOCs/*` (stale).
6. **Keep always-loaded files small.** `wiki/Hot.md` ≤500 words; `.agents/MEMORY.md` is an index; this file ≤22 KB (tested). The placement guard checks new files.
7. **Shell `grep` can silently miss files** (ugrep `-I --ignore-files`); recursive shell grep is hook-denied. Use `bun run repo find` or `/usr/bin/grep -a`.
8. **`packages/reasoning` exports `dist`.** Its `src` edits are invisible downstream until `bunx turbo run build --filter=@reactive-agents/reasoning`. Other packages resolve `src` under Bun.

## Architecture Quick Reference

### Package Dependency Tree (`<-` = deps, drives build order; top to bottom)

```
no deps: core, llm-provider, memory, runtime-shim, ui-core, create-reactive-agent
judgment, prompts, verification <- core, llm-provider
tools, guardrails <- core, judgment, llm-provider
reasoning <- core, judgment, llm-provider, memory, tools
cost <- core, judgment, llm-provider, memory
identity, observability, a2a, trace, observe <- core
interaction <- core, judgment, observability, reasoning
eval <- core, llm-provider, judgment
gateway <- core, llm-provider, tools
channels <- core, gateway
testing (dev only) <- core, llm-provider
health <- runtime-shim
reactive-intelligence <- core, llm-provider, runtime-shim, trace
judge-server (private) <- core, eval, llm-provider, runtime-shim
react, svelte, vue (UI bindings) <- ui-core
runtime (engine, builder) <- all above, optional via Layers
compose (killswitches) <- core, runtime
replay <- core, trace, runtime
diagnose (rax-diagnose) <- replay, trace
benchmarks (private) <- core, cost, judge-server, llm-provider, reasoning, runtime, runtime-shim
reactive-agents (public facade) <- runtime
```

Strategies and stability labels: `apps/docs/src/content/docs/reference/stability.md`. Built-ins: 9 capability + 9 meta tools; `shell-execute` only via `.withTools({ terminal: true })`.

### Per-Layer Quick Reference (paths under `packages/<pkg>/`)

| Package | First file | Key exports |
| --- | --- | --- |
| core | `src/services/event-bus.ts` | EventBus, AgentEvent, AgentId, TaskId |
| llm-provider | `src/runtime.ts` | LLMService, createLLMProviderLayer() |
| memory | `src/runtime.ts` | MemoryService, createMemoryLayer() |
| reasoning | `src/services/strategy-registry.ts` | ReasoningService, StrategyRegistry, ThoughtKernel |
| tools | `src/services/tool-service.ts` | ToolService, ToolDefinition, defineTool() |
| guardrails | `src/services/guardrail-service.ts` | GuardrailService, KillSwitchService |
| verification | `src/services/verification-service.ts` | VerificationService |
| cost | `src/services/cost-service.ts` | CostService |
| identity | `src/services/identity-service.ts` | IdentityService |
| judgment | `src/services/judgment-service.ts` | JudgmentService, make{Jev,Llm,Ollama}Backend, capabilitiesOf |
| observability | `src/observability-service.ts` | ObservabilityService, ThoughtTracer |
| gateway | `src/services/gateway-service.ts` | GatewayService, PolicyEngine, WebhookService |
| eval | `src/services/eval-service.ts` | EvalService, EvalStore, EvalSuite |
| runtime-shim | `src/index.ts` | Database, spawn, serve, glob, hash, isMain, isBun, isNode |
| compose | `src/killswitches/index.ts` | killswitches, maxIterations, budgetLimit, timeoutAfter, watchdog, requireApprovalFor |
| replay | `src/index.ts` | loadRecordedRun, replay, makeReplayController, makeReplayToolLayer, diffTraces |
| observe | `src/index.ts` | OpenInferenceTracerLayer, setupOpenInferenceExporter |
| runtime | `src/builder.ts` | ReactiveAgents, ReactiveAgentBuilder, createRuntime() |

### Common Debugging Entry Points (`R` = `packages/reasoning/src`)

| Symptom | Start here |
| --- | --- |
| Tools not called | R/`kernel/capabilities/reason/think.ts` → `kernel/capabilities/act/act.ts` |
| Context missing | R/`assembly/project.ts` (`project()`, sole live assembler) → `assembly/from-kernel-state.ts` |
| Tool results lost | R/`kernel/capabilities/act/tool-execution.ts` → `kernel/capabilities/attend/tool-formatting.ts:compressToolResult` |
| EventBus silent | `packages/core/src/services/event-bus.ts` (shared ManagedRuntime?) |
| LLM call fails | `packages/llm-provider/src/runtime.ts` → `src/providers/` |
| Memory not persisting | `packages/memory/src/runtime.ts:createMemoryLayer()` wiring |
| Plan loops forever | R/`strategies/plan-execute.ts:isSatisfied()` guard |
| Gateway won't start | `packages/gateway/src/services/gateway-service.ts` |
| Chat history missing | `packages/runtime/src/gateway-context-formatting.ts:GatewayChatManager` |
| Metrics missing | `packages/observability/src/observability-service.ts:MetricsCollectorLive` |
| A recorded run failed | `rax-diagnose cause <runId|path>` |

## Canonical Documents & Authority

Live state: `bun run repo status`, `wiki/Hot.md`. Which doc answers what: the Canonical Wiki Index in `wiki/Development/Repo-Navigation.md`.

On conflict: `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md` (sequencing) > `wiki/Architecture/Specs/08-AGENTIC-OS-NORTH-STAR.md` (product arc, honest-claims law) > `wiki/Architecture/Design-Specs/2026-07-11-harness-north-star-architecture.md` (kernel) > active plans > evidence. Amend the lower doc, never drift silently; changing a higher doc is a ratification event; amend 09, never write another north star. Method: `wiki/Architecture/Specs/01-RESEARCH-DISCIPLINE.md`. Failure modes: `wiki/Architecture/Specs/02-FAILURE-MODES.md`. Specs 04, 06, 07 are historical.

## Coding Standards

Read `CODING_STANDARDS.md` before writing code. Skills: `effect-ts-patterns` (Schema.Struct, Context.Tag, Layer, Ref), `review-patterns` (9-category checklist).

## Runtime Policy

Bun ≥1.1.0 recommended; Node.js 22.5+ supported via `@reactive-agents/runtime-shim` (FTS5 absent on Node sqlite, falls back to `LIKE`). **No new Bun-specific APIs:** prefer `node:` built-ins; keep `bun:sqlite`, `Bun.serve`, `Bun.spawn` to files already using them.

## Golden Rules

1. **Read before writing.** Learn the pattern before adding code.
2. **Effect-TS patterns** (`effect-ts-patterns`): no `throw`, no raw `await`, no plain interfaces.
3. **No `any`** (incl. `as any`), no untyped args/returns; precise types, generics, tagged unions.
4. **Control and observability over magic.** No hidden globals; explicit config; structured events/traces so decisions replay.
5. **Deterministic over LLM-driven.** If a field can be computed from data, compute it.
6. **Keep docs truthful.** API/capability changes update docs (`bun run repo scope` lists them).
7. **Test everything.** New services get tests; features get integration tests.
8. **One concern per commit.**
9. **JSDoc every public API.**

## Terminal Execution Rules

Hooks deny piped `bun test`, scripted edits (`sed -i`, scripted replace) and recursive shell grep. Use `bun run repo test <paths>` (summary printed, log saved). Raw unpiped `bun test` needs `--timeout 15000`; `.stop(true)` servers in teardown.

## Vision Alignment

Explicit · observable (EventBus/ThoughtTracer, not console.log) · type-safe · composable Effect services · efficient on local + cloud models · secure defaults.

## Build & Test Cycle

Turborepo orders builds from each package's `dependencies`; cache in `.turbo/`.

```bash
bun install
bun run repo test <paths>     # scoped tests
bun run repo verify <pkg-dir> # tests + typecheck + gates, one package
bun run repo check --all      # all registered gates
bun run typecheck             # workspace TypeScript
bun run build                 # all packages + apps (build:packages, build:apps, build:clean, clean)
bun run docs:dev              # docs site (docs:build, docs:preview)
```

`bun run rax -- <args>` runs the local `rax` (user CLI, not for repo checks).

### After Completing a Feature

- [ ] `bun run repo verify <pkg-dir>` per touched package; `bun run build` succeeds
- [ ] `bun run repo check --all` passes
- [ ] Docs updated; changeset (`bun run changeset`) for user-facing behavior
- [ ] No new `TODO`/`FIXME` without a tracking issue; `/review-patterns <changed-files>`

## Team-Ownership Dev Contract (standing since 2026-06-15)

Domain-scoped edits go to their warden via `Agent` dispatch (MissionBrief in, UpwardReport out); the main thread dispatches, verifies, integrates. **Owner of a path:** `bun run repo scope <files>` (source `tools/repo/ownership.json`). Cross-cutting: `harness-warden` (probes), `ablation-warden` (default-on, new mechanisms), `release-warden`, `debrief-scribe` (AAR). **Only exception:** hot-fix to red CI on `main`, logged with `bypass-reason` in `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md` (each warden task also logs a YAML block there).

Schemas: `.agents/skills/mission-brief/SKILL.md`, `.agents/skills/upward-report/SKILL.md`. Validate a report and get the next action: `bun run repo warden-report <file>`.

### Dispatcher FSM (main thread on warden output)

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
- ❌ New warden role without `ablation-warden` PASS (≥2 tiers, ≥3pp lift, ≤15% token overhead).
- ❌ Domain warden patches code outside its authority manifest — escalate via `denied-by-authority`; parent dispatches the correct warden.
- ❌ Harness / ablation / debrief-scribe / release wardens editing `packages/**/src/**`. They surface findings; domain wardens fix.

## Plans, Specs & Knowledge Storage

`wiki/` is the single source of truth for every agent and human. `bun run repo place <path>` checks a location; `bun run repo place --kind plan` (spec, decision, debrief, experiment, failure-mode) prints where a kind goes.

| Content | Location (`D` = `YYYY-MM-DD`) |
|---|---|
| Plans | `wiki/Planning/Implementation-Plans/` D-feature.md |
| Design specs | `wiki/Architecture/Design-Specs/` D-spec.md |
| Canonical specs | `wiki/Architecture/Specs/` NN-NAME.md |
| Decisions/RFCs | `wiki/Decisions/` D-decision.md |
| Debriefs | `wiki/Research/Debriefs/` D-feature-debrief.md |
| Audits | wiki/Research/Audit-Reports-D/ |
| Failure modes | `wiki/Failure-Modes/` FM-X-name.md |
| Experiments | `wiki/Experiments/` D-name.md |

**Hard rules:** (1) no new files in docs/ (eliminated May 2026); (2) superpowers `writing-plans` targets `wiki/Planning/Implementation-Plans/`, never its deprecated docs/superpowers/plans default; (3) every agent follows this; (4) append new plans/specs/decisions to their index (`wiki/Planning/Planning-Index.md`, Decision Index); (5) wiki files carry frontmatter `type`, `status`, `created`, `tags`. Wiki workflow: `wiki/Development/Wiki-Workflow.md`.

## Release Workflow (Tag-Driven)

**`dev` is the staging branch (since 2026-09-19).** Land work on `dev`, not `main`; feature branches merge into `dev`. `main` moves only by merging `dev` at release time, immediately followed by the tag.

**Every PR touching user-facing behavior:** `bun run changeset` → `.changeset/<name>.md`, committed with the code (feeds release notes via `scripts/release.ts`).

**Release:** merge `dev` → `main` → push `main` → `bun run release:dry <version>` (sole drift gate) → `git tag vX.Y.Z` → push tag → `publish.yml` publishes. **Never `npm publish` manually** (`prepare-release` skill). Public packages move in lockstep (release.ts stamps versions; see pitfall 8); `benchmarks`, `judge-server` are private.

## Git Hooks

`bun install` runs `scripts/setup-git-hooks.sh` (re-run if hooks don't fire). `.githooks/commit-msg` rejects Claude/Anthropic `Co-Authored-By:` trailers; `.githooks/pre-commit` blocks the real `.env` and API-key prefixes and runs fast `repo check --changed` (`git commit --no-verify` escapes). Keep hooks sub-second; repo-wide checks go in CI / `bun run repo check --all`.

**Stackblitz:** never add `workspace:*` deps under `apps/stackblitz/`.

## Architecture Debt

Live list: `wiki/Architecture/DEBT-REGISTER.md` (query it; do not read it whole). Latest audit: `wiki/Research/Audit-Reports-2026-07-12/00-STATE-OF-THE-FRAMEWORK.md`.

## Common Pitfalls

1. **`serviceOption` returns `Option`** — use `Option.isSome()` + `.value`, not direct access
2. **`ContextWindowManager.truncate()`** not `buildContext()` — for kernel FC context, use `assembly/project.ts` (`project()`); the older `message-window.ts`/`context-manager.ts` (`ContextManager.build`) stack was deleted 2026-07-07 (no live caller)
3. **Gemini SDK is `@google/genai`** not `@google/generative-ai`
4. **`mock.module()` in Bun** only intercepts ES `import()`, not CJS `require()`
5. **ReasoningService.execute** takes single params object, not positional args
6. **Starlight / Astro 6 content config** must be `src/content.config.ts` (Content Layer API); `src/content/config.ts` is legacy and fails the build
7. **`workspace:*` is fine for internal deps** — `changeset publish` resolves these correctly. Do not manually replace them with pinned versions.
8. **Never manually bump versions or `npm publish`** — the tag-driven flow (`bun run release:dry` → `git tag vX.Y.Z` → publish.yml) stamps versions at tag time; workspace package.json files stay at the 0.10.6 baseline by design.
9. **`PendingGuidance` replaces `steeringNudge`** — harness signals (required tools pending, loop detected, ICS/oracle guidance) are now accumulated in `state.pendingGuidance` and rendered by `think.ts` into the system prompt's `Guidance:` section each turn. Do NOT inject stray `USER` messages for mid-loop guidance; set `pendingGuidance` fields instead.
10. **One entropy scorer per thought** — kernel-runner strategies are scored inline by `runReactiveObserver`; the engine/RI event collectors must skip them (`scoresEntropyInline` from `@reactive-agents/core`). Scoring both paths into the shared per-task trajectory with mismatched iteration labels fabricates "diverging" shapes (FM-C3). All entropy sources are disorder-oriented (higher = more uncertain); never feed a quality metric into the composite uninverted.
11. **No AI co-author trailers in commits, ever** — `Co-Authored-By: Claude ...` / `... @anthropic.com` is forbidden in this repo (shows publicly on GitHub's contributors graph, misattributes authorship). Enforced by a `commit-msg` hook (`.githooks/commit-msg`) that hard-rejects any such trailer regardless of which tool/harness tried to add it. See the Git Hooks section above.
12. **Termination/outcome logic goes in the shared substrate, never per-strategy.** Strategies are being converged (Plan 8, `wiki/Planning/Implementation-Plans/2026-11-02-harness-convergence.md`). New termination or outcome behavior belongs in the shared finalize/terminal path or in typed run-envelope rails, with `rails.posture` as the template. The shared path is `finalizeStrategyResult`, `emitTerminalDecision`, `strategy-terminal-decision.ts`, and the terminal verify gate. Debug entry point: `rax-diagnose cause <runId|path>`; `run-started.config` records the mechanisms a run ran with.

## Project Skills Index

Contributor skills in `.agents/skills/`:

- `repo-tool` — `bun run repo` flow, overrides, hook denials
- `agent-tdd` — Effect-TS TDD, timeouts, teardown
- `architecture-audit` — dead code, layer violations, drift
- `architecture-reference` — dependency graph, build order
- `build-package` — new `@reactive-agents/*` package
- `codebase-health-sweep` — failing tests, type errors, dead code
- `effect-abstraction-audit` — abstraction and composability gaps
- `effect-ts-patterns` — mandatory Effect-TS patterns
- `execute-backlog` — bundle and ship GitHub issues, retro
- `harness-improvement-loop` — H3 + `rax-diagnose attribute`: top harness reason, pin, fix, `h3/verdict.ts`, ledger
- `implement-service` — service creation
- `implement-test` — test creation
- `kernel-debug` — symptom-to-phase map
- `kernel-extension` — kernel phases, guards, meta-tools
- `llm-api-contract` — LLMService signatures
- `mcp-integration` — MCP client, Docker lifecycle
- `memory-patterns` — SQLite/FTS/vec memory
- `mission-brief` — warden dispatch input
- `prepare-release` — tag-driven release
- `provider-streaming` — provider streaming quirks
- `prune-memory` — remove stale memory claims
- `reactive-feature-dev` — feature workflow routing
- `review-patterns` — 9-category compliance review
- `update-docs` — docs, skills, memory sync
- `upward-report` — warden output contract
- `validate-build` — build/test/review gates

Plugin skills: `claude-obsidian:wiki-query`, `claude-obsidian:save`, `claude-obsidian:wiki-ingest`, `claude-obsidian:wiki-lint`.

## Consumer Skills (public)

Source `apps/docs/skills/`; index `https://docs.reactiveagents.dev/.well-known/skills/index.json`.

- Discovery: reactive-agents
- Capabilities: builder-api-reference, reasoning-strategy-selection, context-and-continuity, tool-creation, shell-execution-sandbox, mcp-tool-integration, memory-patterns, multi-agent-orchestration, gateway-persistent-agents, identity-and-guardrails, observability-instrumentation, cost-budget-enforcement, quality-assurance, ui-integration, interaction-autonomy, a2a-agent-networking, provider-patterns
- Recipes: recipe-research-agent, recipe-code-assistant, recipe-persistent-monitor, recipe-orchestrated-workflow, recipe-saas-agent, recipe-embedded-app-agent
