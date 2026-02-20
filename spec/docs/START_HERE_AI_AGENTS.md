# START HERE: AI Agent Build Instructions

## What You're Building

**Reactive Agents** — a TypeScript + Effect-TS + Bun AI agent framework with 10 layers, 3 enhancement packages, a runtime, and a CLI. 15 packages total.

Every layer spec contains **exact code to copy**. Types use `Schema.Struct`, errors use `Data.TaggedError`, services use `Context.Tag` + `Layer.effect`. Do NOT deviate from these patterns.

---

## Choose Your Build Mode

| Mode | When to Use | How |
|------|------------|-----|
| **Solo** | One agent, sequential build | Follow [Solo Workflow](#solo-workflow) below |
| **Agent Team** | Parallel build with teammates | Follow [Agent Team Workflow](#agent-team-workflow) below |

---

## Agent Team Workflow

Use this mode when running Claude Code with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. The team lead coordinates, teammates build.

### Prerequisites

1. Monorepo must be scaffolded first — follow `00-monorepo-setup.md`
2. All agents receive `CLAUDE.md` and `.claude/skills/` automatically
3. Read `00-master-architecture.md`, `implementation-guide-complete.md`, and `FRAMEWORK_USAGE_GUIDE.md` before starting

### Team Structure

| Role | What They Do | Skills They Use |
|------|-------------|----------------|
| **Lead** | Plans phase, assigns packages, runs gate checks, validates integration | `build-coordinator`, `validate-build`, `review-patterns` |
| **Teammate** | Builds one package at a time, reports status when done | `build-package`, `implement-service`, `implement-test`, `validate-build` |

### Phase Launch Prompts

Copy-paste one of these prompts to start an agent team build. Each prompt is self-contained.

---

#### Launch Prompt: Phase 1 — Foundation

```
Build Phase 1 (Foundation) of the Reactive Agents framework.

PREREQUISITES:
- Verify monorepo is scaffolded per spec/docs/00-monorepo-setup.md (root package.json, tsconfig.json, package directories). If not, scaffold it first.

YOUR ROLE: Team lead. You coordinate, assign, and validate. You do NOT build packages yourself.

SCOPE — Build these 7 packages in dependency order:
1. @reactive-agents/core → spec/docs/layer-01-core-detailed-design.md
2. @reactive-agents/llm-provider → spec/docs/01.5-layer-llm-provider.md
3. @reactive-agents/memory (Tier 1) → spec/docs/02-layer-memory.md
4. @reactive-agents/tools → spec/docs/08-layer-tools.md
5. @reactive-agents/reasoning (Reactive only) → spec/docs/03-layer-reasoning.md
6. @reactive-agents/interaction (Autonomous only) → spec/docs/layer-10-interaction-revolutionary-design.md
7. @reactive-agents/runtime → spec/docs/layer-01b-execution-engine.md

TEAM ASSIGNMENTS:
- Teammate A: Build core, then memory, then runtime
- Teammate B: (after core passes) Build llm-provider, then tools, then reasoning
- Teammate C: (after llm-provider passes) Build interaction

DEPENDENCY GATES — Enforce strictly:
- Gate 1: core must pass before ANY other package starts
- Gate 2: llm-provider must pass before memory, tools, reasoning, interaction
- Gate 3: ALL packages 1-6 must pass before runtime starts

FOR EACH TEAMMATE ASSIGNMENT:
"Read the spec file listed above. Use /build-package <name> for the full build procedure. When finished, run /validate-build <name> and report: pass/fail, any blockers, and the list of exports from index.ts."

GATE VALIDATION (you, the lead, run these):
- After each package: bun run build (workspace type-check)
- After each gate: bun test (full test suite)
- Before runtime: verify all 6 package index.ts exports resolve

SUCCESS CRITERIA:
- All 7 packages implemented with passing tests
- Zero TypeScript errors: bun run build
- All services follow Effect-TS patterns (check via /review-patterns)
- Runtime ExecutionEngine 10-phase loop is functional
```

---

#### Launch Prompt: Phase 2 — Differentiation

```
Build Phase 2 (Differentiation) of the Reactive Agents framework.

PREREQUISITE: Phase 1 must be complete. Verify: bun run build && bun test (zero errors).

YOUR ROLE: Team lead. Coordinate and validate. Do NOT build packages yourself.

SCOPE — Build these 6 items (all Phase 1 deps are satisfied):
8.  @reactive-agents/reasoning (full — add 4 remaining strategies) → spec/docs/03-layer-reasoning.md
9.  @reactive-agents/guardrails → spec/docs/11-missing-capabilities-enhancement.md (Package 1)
10. @reactive-agents/verification → spec/docs/04-layer-verification.md
11. @reactive-agents/eval → spec/docs/11-missing-capabilities-enhancement.md (Package 2)
12. @reactive-agents/cost → spec/docs/05-layer-cost.md
13. @reactive-agents/memory (Tier 2 — add sqlite-vec KNN) → spec/docs/02-layer-memory.md

TEAM ASSIGNMENTS (all can start immediately — deps are met):
- Teammate A: reasoning (full strategies), then memory Tier 2 upgrade
- Teammate B: guardrails, then verification (verification needs memory from Phase 1)
- Teammate C: eval, then cost

FOR EACH TEAMMATE ASSIGNMENT:
"Read the spec file. Use /build-package <name> for the full build procedure. When finished, run /validate-build <name> and report: pass/fail, blockers, and index.ts export list."

GATE VALIDATION:
- After each package: bun run build
- After all 6 complete: bun test (full suite including Phase 1)
- Verify reasoning strategies: all 5 (Reactive, PlanExecuteReflect, TreeOfThought, Reflexion, Adaptive) are exported
- Verify memory Tier 2: sqlite-vec KNN search works alongside existing FTS5

SUCCESS CRITERIA:
- All 6 items complete with passing tests
- Zero TypeScript errors across entire workspace
- Reasoning exports all 5 strategy types
- Memory Tier 2 adds KNN without breaking Tier 1 FTS5
```

---

#### Launch Prompt: Phase 3 — Production

```
Build Phase 3 (Production) of the Reactive Agents framework.

PREREQUISITE: Phases 1 and 2 must be complete. Verify: bun run build && bun test (zero errors).

YOUR ROLE: Team lead. Coordinate and validate. Do NOT build packages yourself.

SCOPE — Build these 6 items (high parallelism — most depend only on core):
14. @reactive-agents/identity → spec/docs/06-layer-identity.md
15. @reactive-agents/orchestration → spec/docs/07-layer-orchestration.md
16. @reactive-agents/observability → spec/docs/09-layer-observability.md
17. @reactive-agents/prompts → spec/docs/11-missing-capabilities-enhancement.md (Package 3)
18. @reactive-agents/interaction (all 5 modes) → spec/docs/layer-10-interaction-revolutionary-design.md
19. @reactive-agents/cli → spec/docs/11-missing-capabilities-enhancement.md (Extension 7)

TEAM ASSIGNMENTS:
- Teammate A: identity, then orchestration (orchestration needs identity + reasoning + tools)
- Teammate B: observability, then prompts
- Teammate C: interaction (extend to all 5 modes), then cli (cli needs runtime + interaction)

DEPENDENCY GATES:
- Gate: identity must pass before orchestration starts
- Gate: interaction (full) must pass before cli starts
- All other packages can build in parallel

FOR EACH TEAMMATE ASSIGNMENT:
"Read the spec file. Use /build-package <name> for the full procedure. Run /validate-build <name> when done. Report: pass/fail, blockers, index.ts exports."

FINAL INTEGRATION (after all packages):
1. bun run build — zero TypeScript errors across all 15 packages
2. bun test — all tests pass across all packages
3. Verify runtime can compose all layers: createRuntime() with every optional layer enabled
4. Verify ReactiveAgentBuilder: ReactiveAgents.create().withModel('claude-sonnet').build() resolves
5. Run /review-patterns packages/ for a final pattern compliance sweep

SUCCESS CRITERIA:
- All 15 packages implemented and tested
- Full workspace type-checks cleanly
- ReactiveAgentBuilder end-to-end functional
- CLI can invoke agent runs
```

---

### How Agent Teams Work

1. **You paste a phase prompt** into Claude Code (with agent teams enabled)
2. **Lead reads the prompt**, uses the `build-coordinator` skill to plan assignments
3. **Lead creates tasks** for each teammate via the shared task list
4. **Teammates build** using `build-package`, `implement-service`, `implement-test` skills
5. **Teammates validate** using `validate-build` and report back to lead
6. **Lead runs gate checks** (`bun run build`, `bun test`) before releasing dependent packages
7. **Lead runs final integration** when all packages in the phase are done

### Tips for Best Results

- **Start with Phase 1.** Don't skip phases — each builds on the last.
- **One package per teammate at a time.** Don't overload with concurrent packages.
- **Gate checks are non-negotiable.** A broken upstream package cascades to everything downstream.
- **Read the spec first, always.** Every spec has a Build Order section — follow it exactly.
- **Use `/validate-build` religiously.** It catches 90% of pattern drift before it compounds.

---

## Solo Workflow

If you're a single agent (no team), build everything sequentially.

### Step 1: Read Core Documents

1. **`00-master-architecture.md`** — System overview, layer diagram, data flow, dependencies
2. **`implementation-guide-complete.md`** — 14-week build plan, package map, Effect-TS patterns, troubleshooting
3. **`FRAMEWORK_USAGE_GUIDE.md`** — Public API examples: builder patterns, agent creation, task execution

### Step 2: Scaffold the Monorepo

Follow `00-monorepo-setup.md` — create root configs, all package directories, shared tsconfig.

### Step 3: Build In This Order

Each spec has a **Build Order** section with numbered steps. Follow it exactly.

#### Phase 1: Foundation

| # | Package | Spec | Notes |
|---|---------|------|-------|
| 1 | `@reactive-agents/core` | `layer-01-core-detailed-design.md` | 14 steps; includes ContextWindowManager |
| 2 | `@reactive-agents/llm-provider` | `01.5-layer-llm-provider.md` | embed() via OpenAI/Ollama |
| 3 | `@reactive-agents/memory` | `02-layer-memory.md` | Tier 1 (bun:sqlite + FTS5, zero deps) |
| 4 | `@reactive-agents/tools` | `08-layer-tools.md` | MCP client |
| 5 | `@reactive-agents/reasoning` (Reactive only) | `03-layer-reasoning.md` | |
| 6 | `@reactive-agents/interaction` (Autonomous only) | `layer-10-interaction-revolutionary-design.md` | |
| 7 | `@reactive-agents/runtime` | `layer-01b-execution-engine.md` | ExecutionEngine; 10-phase loop |

#### Phase 2: Differentiation

| # | Package | Spec | Notes |
|---|---------|------|-------|
| 8 | `@reactive-agents/reasoning` (all 5 strategies) | `03-layer-reasoning.md` | |
| 9 | `@reactive-agents/guardrails` | `11-missing-capabilities-enhancement.md` | Package 1 |
| 10 | `@reactive-agents/verification` | `04-layer-verification.md` | |
| 11 | `@reactive-agents/eval` | `11-missing-capabilities-enhancement.md` | Package 2 |
| 12 | `@reactive-agents/cost` | `05-layer-cost.md` | |
| 13 | `@reactive-agents/memory` (Tier 2) | `02-layer-memory.md` | Add sqlite-vec KNN |

#### Phase 3: Production

| # | Package | Spec |
|---|---------|------|
| 14 | `@reactive-agents/identity` | `06-layer-identity.md` |
| 15 | `@reactive-agents/orchestration` | `07-layer-orchestration.md` |
| 16 | `@reactive-agents/observability` | `09-layer-observability.md` |
| 17 | `@reactive-agents/prompts` | `11-missing-capabilities-enhancement.md` (Package 3) |
| 18 | `@reactive-agents/interaction` (all modes) | `layer-10-interaction-revolutionary-design.md` |
| 19 | `@reactive-agents/cli` | `11-missing-capabilities-enhancement.md` (Extension 7) |

### Step 4: For Each Package

Use `/build-package <name>` — it handles the full 10-step process:
1. Read the spec → 2. Create package.json → 3. Create tsconfig → 4. Implement in build order → 5. Runtime factory → 6. index.ts exports → 7. Tests → 8. `bun test` → 9. `bun run build` → 10. `/validate-build`

---

## Spec Quick Reference

| Document | What It Contains |
|----------|-----------------|
| `00-monorepo-setup.md` | Directory structure, root configs, package template, dependency map |
| `00-master-architecture.md` | Layer diagram, data flow, dependencies |
| `implementation-guide-complete.md` | 14-week plan, patterns, troubleshooting |
| `FRAMEWORK_USAGE_GUIDE.md` | ReactiveAgentBuilder fluent API, createRuntime(), examples |
| `layer-01-core-detailed-design.md` | L1: types, EventBus, AgentService, TaskService, ContextWindowManager |
| `layer-01b-execution-engine.md` | Runtime: ExecutionEngine, 10-phase loop, LifecycleHooks |
| `01.5-layer-llm-provider.md` | L1.5: LLMService, Anthropic/OpenAI/Test, prompt caching |
| `02-layer-memory.md` | L2: bun:sqlite, 4 memory types, Zettelkasten, Tier 1/2 |
| `03-layer-reasoning.md` | L3: 5 strategies, selector, tracker |
| `04-layer-verification.md` | L4: 5 verification layers, adaptive selection |
| `05-layer-cost.md` | L5: router, cache, compression, budgets |
| `06-layer-identity.md` | L6: Ed25519 certs, auth, audit, delegation |
| `07-layer-orchestration.md` | L7: workflows, agent mesh, durable exec, A2A |
| `08-layer-tools.md` | L8: MCP client, function calling, tool registry |
| `09-layer-observability.md` | L9: OpenTelemetry tracing, metrics, logging |
| `layer-10-interaction-revolutionary-design.md` | L10: 5 modes, adaptive switching, collaboration |
| `11-missing-capabilities-enhancement.md` | Guardrails, eval, prompts, CLI, extensions |

---

## Checklist Per Package

- [ ] All types use `Schema.Struct` (never `interface`)
- [ ] All errors use `Data.TaggedError` (never `throw`)
- [ ] All services use `Context.Tag` + `Layer.effect` (never classes)
- [ ] State managed with `Ref` (never `let`)
- [ ] Async uses `Effect.tryPromise` (never raw `await`)
- [ ] Runtime factory `createXxxLayer()` composes all services
- [ ] `index.ts` re-exports all public types, errors, services, layers
- [ ] Tests pass: `bun test packages/<name>`
- [ ] Type-check passes: `bun run build`
- [ ] 80%+ test coverage

**Additional checklist for `@reactive-agents/runtime`:**
- [ ] `src/builder.ts` implements `ReactiveAgentBuilder`, `ReactiveAgent`, `ReactiveAgents`
- [ ] `ReactiveAgents.create().withModel(...).build()` resolves to `ReactiveAgent`
- [ ] `ReactiveAgent.run(input)` returns `Promise<AgentResult>`
- [ ] `ReactiveAgentBuilder.buildEffect()` returns `Effect<ReactiveAgent>`
- [ ] All builder `.withX()` methods update config and return `this` (fluent)
