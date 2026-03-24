# Reactive Agents — Project Memory

> Cross-agent memory file. Any AI agent working on this codebase should read this for context.
> Keep this file in sync with Claude Code memory at `~/.claude/projects/.../memory/MEMORY.md`.

---

## Current Status (Mar 24, 2026)

- **v0.8.x** — 22 packages + 2 apps, 2,852 tests across 336 files
- **Living Intelligence System** — merged to main (23 commits)
  - Living Skills: SkillRecord, SkillStoreService, SkillEvolutionService, SkillRegistry, SkillResolver, SkillDistiller
  - Intelligence Control Surface: 10 controller decisions (7 new evaluators: temp-adjust, skill-activate, prompt-switch, tool-inject, memory-boost, skill-reinject, human-escalate)
  - Context-aware skill management: 5-stage compression pipeline, injection guard with tier budgets, eviction priority
  - Meta-tools: activate_skill, get_skill_section (auto-included for local/mid tiers)
  - Builder: `.withSkills()`, extended `.withReactiveIntelligence()` (hooks, constraints, autonomy)
  - Runtime API: `agent.skills()`, `agent.exportSkill()`, `agent.loadSkill()`, `agent.refineSkills()`
  - Test guards: test provider excluded from telemetry, learning, and skill distillation
  - MemoryConsolidator CONNECT phase wired to skill distillation
- **Kernel Optimization complete** — Termination Oracle, output assembly, proportional pipeline, RI default-on
- **Benchmark pass rate**: 100% (35/35) on cogito:14b

## Key Specs & Plans

| Document | Purpose |
|----------|---------|
| `docs/superpowers/specs/2026-03-23-living-intelligence-system-design.md` | Living Intelligence System full design spec |
| `docs/superpowers/plans/2026-03-23-living-intelligence-system.md` | Implementation plan (21 tasks, all complete) |
| `docs/superpowers/plans/2026-03-24-telemetry-server-intelligence-enrichment.md` | Telemetry API server changes needed (not yet implemented) |
| `docs/superpowers/specs/2026-03-20-kernel-optimization-design.md` | Kernel optimization spec |

## Critical Build Patterns

- **Effect-TS**: All services use `Context.Tag` + `Layer.effect` pattern. No raw `throw` or `await`.
- **tsconfig**: Each package extends root. Do NOT set `rootDir: "src"` (conflicts with test includes). MUST add `"types": ["bun-types"]` for `bun:test` and `bun:sqlite`.
- **Package.json**: Every package needs `"type": "module"`, `"exports"` with `.js` extensions (required for `moduleResolution: bundler`).
- **Schema dual exports**: Effect-TS Schema values (e.g., `AgentId`) are both values and types. With `verbatimModuleSyntax`, export as value only (`export { AgentId }`), not `export type`.
- **SQLite in Bun**: `bun:sqlite` is synchronous — wrap in `Effect.sync()`, NOT `Effect.tryPromise()`. Use WAL mode.
- **Stream.make**: Takes only 1 type param in current Effect-TS. Use `satisfies` + cast for multi-type streams.
- **Layer composition**: Use `.pipe(Layer.provide(depLayer))` when one layer depends on another's service, NOT `Layer.mergeAll()`.
- **ManagedRuntime**: Use when multiple async calls need shared Effect service instances. `Layer.Layer` creates fresh per `runPromise`; `ManagedRuntime` evaluates once and memoizes.
- **Starlight + Bun**: Must use `legacy: { collections: true }` in `astro.config.mjs`.
- **Gemini SDK**: Use `@google/genai` (v1+), NOT `@google/generative-ai` (legacy). Uses `import()` not `require()`.
- **Test provider**: Provider `"test"` or modelId `"test"` / `"test-*"` must be excluded from all intelligence systems (telemetry, learning, skill evolution).
- **Empty packages**: Need placeholder `src/index.ts` with `// placeholder` to avoid TS18003.
- **Test patterns**: Use `bun:test` imports. `TestLLMServiceLayer` from `@reactive-agents/llm-provider` for deterministic LLM testing.

## Architecture Highlights

- **Brain model**: EntropySensor=Sensory Cortex, ReactiveController=Prefrontal Cortex, TerminationOracle=Anterior Cingulate, LearningEngine=Basal Ganglia, Memory=Hippocampus, Guardrails=Amygdala, Tools+Context=Cerebellum, EventBus=Thalamus
- **Skill sources**: Learned (SQLite) > Project-level installed (`./<agentId>/skills/` > `./.agents/skills/`) > User-level (`~/.agents/skills/`) > Promoted
- **Two skill concepts**: "Developer Skills" (SKILL.md published from docs site for coding agents building _with_ the framework) vs "Living Skills" (runtime skills consumed by agents running _inside_ the framework). These are separate systems.
- **SkillRecord.config**: Uses `SkillFragmentConfig` (flat 6-field type in `@reactive-agents/core`), NOT the richer `SkillFragment` from `reactive-intelligence/telemetry/types.ts`.

## Sub-Agent System — Known Issues

- Context forwarding partially addressed (kernel optimization tightened defaults: maxIterations=3, enableMemory=false)
- Small models (cogito:14b) still struggle with complex delegation — solo mode preferred for simple tasks
- Scratchpad sync uses manual `Ref.get` + map merge after tool execution — should be a proper Effect service

## V1.0 Roadmap (Remaining)

### P0 — Must Ship
- **Telemetry server enrichment**: 11 new `run_reports` columns, `skill_effectiveness` table, 3 new API endpoints (plan: `docs/superpowers/plans/2026-03-24-telemetry-server-intelligence-enrichment.md`)
- **Bidirectional Messaging Gateway**: MCP push notifications, EventBus forwarding, Signal/Discord/Telegram. Design: `docs/plans/2026-03-01-gateway-observability-and-bidirectional-messaging-design.md`
- **`rax start` Hero Experience**: Pre-built configurable agent, `rax create my-agent --template researcher` → working agent in 5 min
- **Sub-agent improvements**: Result passthrough, tool scoping on `spawn-agent`, directive prompts, static iteration optimization

### P1 — Should Ship
- NL cron scheduling via chat
- Agent sharing via Agent as Data (export/import JSON)
- Execution proof API (signed traces for enterprise/compliance)

### Deferred from Living Intelligence
- **Bundled skill packages**: `node_modules/@reactive-agents/skill-*` scan path
- **CLI commands**: `rax skill export`, `rax skill list`
- **Zettelkasten-based skill conflict detection** (depends on existing graph)

### Separate Specs Needed
- **Effect-TS public API abstraction** — hide Effect from public API, keep accessible for power users
- **Docs overhaul & onboarding polish**

## Related Projects

### Project Dispatch
Natural language automation builder — "Claude Code for automation, Reactive Agents is the language." Separate repo.
- Stack: Elysia + Svelte + SQLite (Turso-ready), Bun runtime
- Spec: `docs/superpowers/specs/2026-03-15-project-dispatch-design.md`
- Architecture: Process-isolated server, north star toward microkernel
- SaaS-ready data model (tenant_id on all tables)
- MVP: DispatchAgent chat, runner lifecycle, dashboard, supervisor, MCP tool packs

### Platform Adapters (deferred — post V1.0)
Runtime-agnostic layer for Node.js compatibility: `DatabaseAdapter`, `ProcessAdapter`, `ServerAdapter`.
- New package: `@reactive-agents/platform`
- Call sites to migrate: bun:sqlite (6 packages), Bun.spawn (3), Bun.serve (2), Bun.file/write, Bun.hash, Bun.Glob
- Node.js would need `better-sqlite3` as the only extra dependency

## Post-V1.0 Roadmap

- Phase 5: Evolutionary Intelligence (`@reactive-agents/evolution`, v1.1+)
- Platform adapters for Node.js support
- Agent marketplace / community skill hub
- Docker sandbox for code-execute
- Codebase cleanup: execution engine phase extraction (see `docs/superpowers/plans/2026-03-22-codebase-cleanup.md`)
- Spec: `spec/docs/09-ROADMAP.md`

## Remaining Known Issues

- Memory-flush still 1-2s on some trivial tasks (proportional pipeline may not receive correct metadata)
- Telemetry notice shows despite `telemetry: false` (cosmetic — test guard now suppresses for test provider)
- Formal benchmark runs needed across Anthropic, OpenAI, Gemini providers

## User Preferences

- **No Co-Authored-By lines** in git commits — shows publicly on GitHub contributors page
- **Commit before branching** — always commit/stash exploratory changes before creating feature branches
- **Bun-first** — no Node.js support for V1.0; Bun is the target runtime
- **No Cortex UI for V1.0** — framework fundamentals first
- **Terse responses** — no trailing summaries, the user can read diffs

## Version History (condensed)

- v0.3–v0.5.2: Foundation through Trust & Differentiators
- v0.6.4: 1,654 tests, 13 framework gaps fixed
- v0.7.0: EventBus groundwork, metrics dashboard, 884 tests
- v0.8.0: Adoption readiness, kernel optimization, 2,676 tests, 100% benchmark pass
- v0.8.x+LIS: Living Intelligence System, 2,852 tests, 336 files
