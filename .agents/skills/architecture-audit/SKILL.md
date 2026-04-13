---
name: architecture-audit
description: Use when the architecture may have drifted from documentation, packages have grown complex, dead code or disabled systems are suspected, or before planning a major refactor — scoped to the reactive-agents-ts 22-package monorepo.
user-invocable: true
---

# Architecture Audit

## Overview

System-level health check for Reactive Agents. Like `/simplify` but scoped to architecture: surveys the package topology, kernel internals, and documentation for dead code, over-abstraction, layer violations, and stale claims — then fixes what's safe and flags what needs planning.

**Use when:**
- `AGENTS.md`, `MEMORY.md`, or inline docs may no longer match the code
- A package or subsystem has grown unexpectedly complex
- Cleaning up after a large feature: scaffolding, flags, disabled code wasn't removed
- Preparing to plan a refactor and need an honest current-state baseline

**Don't use for:**
- Effect-TS abstraction candidates specifically → `effect-abstraction-audit`
- Code-level cleanup of recent changes → `/simplify`
- Single-file or unit-level concerns

---

## Phase 1: Architecture Snapshot

Before launching agents, orient to current state. Read in this order:

**Authoritative docs:**
```
AGENTS.md                                        # canonical architecture + build order
apps/cortex/AGENTS.md                            # Cortex-specific patterns
```

**Kernel internals (highest-churn area):**
```
packages/reasoning/src/strategies/kernel/
  kernel-state.ts        # KernelState, Phase type, KernelContext
  kernel-runner.ts       # runKernel() loop
  react-kernel.ts        # makeKernel() factory
  phases/                # context-builder, think, guard, act
  utils/                 # ics-coordinator, loop-detector, tool-utils, etc.
```

**Known architectural debt (pre-loaded — verify each is still present):**
| Debt item | Location | Status to verify |
|-----------|----------|-----------------|
| ~690 LOC dead text-assembly code | `context-engine.ts` | Still present? |
| `buildDynamicContext`/`buildStaticContext` (~560 LOC behind flags) | `context-engine.ts` | Still behind flags? |
| 5 of 7 provider adapter hooks unwired | `provider-adapters/` | `continuationHint`, `errorRecovery`, `synthesisPrompt`, `qualityCheck`, `systemPromptPatch` |
| `KernelState.meta` untyped bag | `kernel-state.ts` | `as any` casts? |
| Strategy routing for local models | `strategy-registry.ts` | Still disabled? |

**Determine scope before proceeding.** Full repo, one package, or one subsystem? Narrow scope = deeper findings.

---

## Phase 2: Launch Three Agents in Parallel

Use the Agent tool to launch all three concurrently. Pass each agent the relevant file paths and the debt table from Phase 1.

### Agent 1: Architecture Health

Inspect the codebase for structural problems:

1. **Layer violations** — Does code in one layer reach through to another it shouldn't? Does `act.ts` know about provider specifics? Does `context-builder.ts` trigger side effects? Does `reasoning` package import directly from `runtime`?
2. **Over-abstraction** — Thin wrappers that add no behavior; one-instance interfaces; single-call factories; config objects wrapping a single primitive; plugin/registry patterns with only one registered implementation and no second on the horizon
3. **Under-abstraction** — Identical or near-identical logic copy-pasted across files with slight variation; repeated stream-parsing patterns across providers; duplicated kernel dispatch logic
4. **Dead or disabled systems** — Feature-flagged code that has no activation path; exported functions/types with zero callers in the monorepo; disabled strategies or routing paths; commented-out orchestration logic
5. **Scope creep** — Utility files that have grown into mini-frameworks; config objects that have accumulated behavior beyond pure data; packages whose `index.ts` exports exceed their documented purpose
6. **Coupling hotspots** — Files imported by 8+ other files; changes here force cascading updates; circular or near-circular dependencies

For each finding: file path, one-sentence problem description, fix direction, and risk (Low / Medium / High).

### Agent 2: Documentation Accuracy

Compare every documented claim against what actually exists:

1. **`AGENTS.md` architecture claims** — Read each section describing package responsibilities, the ExecutionEngine loop phases, and build order. Does the code match? Flag drifted descriptions, removed phases, renamed exports
2. **`MEMORY.md` accuracy** — Check "Architecture (Post Refactor)" and "What Shipped" sections against current file contents. Flag entries describing files, patterns, or module layouts that no longer exist
3. **Kernel extension docs** — Do `AGENTS.md` instructions for "adding a new phase" / "adding a guard" / "adding a meta-tool" still work step-for-step against the current code?
4. **Inline file headers** — Are module-level JSDoc or block comments describing the right responsibility? Are `@param` / `@returns` still accurate?
5. **`apps/docs/src/content/docs/`** — Do user-facing docs describe current public API behavior? Are there documented APIs (`ReactiveAgentBuilder` methods, strategy names, config fields) that no longer exist or have changed signature?
6. **Known debt list** — For each item in the Phase 1 debt table: has it been resolved without docs being updated? Update the debt table if so

For each finding: document file, specific claim, what's wrong in one sentence, correct description.

### Agent 3: Simplification Opportunities

Find where complexity exceeds what the problem requires:

1. **Configuration explosion** — Config schemas with accumulated fields beyond any real use case; options that have never been set to non-default by any test or caller; YAGNI violations
2. **Phase or strategy duplication** — Multiple phases doing overlapping work (e.g., two context-assembly paths); strategies that share >70% of their logic and could be one strategy with a parameter
3. **Indirection chains** — A → B → C → D where B and C route without adding behavior; passes-through that exist only for historical reasons
4. **Parallel systems** — Two systems doing the same job (e.g., two tool-call parsers, two context builders, two error formatters); identify which is canonical and which is dead weight
5. **Type gymnastics** — Complex conditional types, deep `infer` chains, or mapped types where a simpler domain model would be clearer and equally safe
6. **Premature extensibility** — Registries, plugin hooks, or lifecycle systems built for N implementations but only 1 exists and no second is planned in the next milestone

For each finding: file path, description of unnecessary complexity, effort estimate (Low / Medium / High), impact estimate (Low / Medium / High).

---

## Phase 3: Triage and Fix

Wait for all three agents. Categorize every finding:

### Fix Immediately
Safe to fix now without architectural planning:
- Stale documentation claims in `AGENTS.md`, `MEMORY.md`, inline comments
- Dead exports (zero callers, confirmed unused)
- Incorrect or outdated kernel extension instructions
- Comment cleanup (narrating removed behavior, referencing deleted files)

Rule: fix is < 25 lines and touches ≤ 2 files. Anything larger → Flag for Planning.

### Flag for Planning
Do NOT implement without a written plan:
- Dead code removal touching > 2 files (e.g., `context-engine.ts` cleanup)
- Collapsing parallel systems
- Restructuring config schemas
- Untangling layer violations

Add each to the **Architecture Debt Register** (see Output below).

### Escalate to User
Needs explicit decision before any action:
- Parallel systems where the canonical choice is ambiguous
- Simplifications that change the public API of `@reactive-agents/*`
- Findings that would span > 3 packages
- Anything where fixing reveals a deeper design question

---

## Output

When complete, report:

1. **Documentation fixes applied** — count and list of files changed
2. **Top 3 simplification opportunities** — file, problem, effort/impact
3. **Architecture debt register update** — append findings to the debt table in `AGENTS.md` under an `## Architecture Debt` section (create if absent), formatted as:

```markdown
| Area | File | Problem | Effort | Impact | Status |
|------|------|---------|--------|--------|--------|
| Dead code | context-engine.ts | ~690 LOC dead behind flags | High | High | Open |
```

4. **Escalations** — anything requiring explicit user decision

Keep the summary under 12 lines. The debt register carries the full detail.

---

## Architecture Quick Reference

| Pattern | Location | What it IS |
|---------|----------|------------|
| `Phase[]` pipeline | `kernel-runner.ts` | Sequential kernel phases; `(state, ctx) => Effect<KernelState>` |
| `Guard[]` chain | `phases/guard.ts` | Tool-call safety checks; any guard can block |
| `MetaToolHandler` registry | `phases/act.ts` | Inline meta-tool dispatch; new tools = one registry entry |
| `makeKernel()` factory | `react-kernel.ts` | Custom kernel configurations; override default phase set |
| Two independent records | `kernel-state.ts` | `messages[]` (LLM sees) vs `steps[]` (systems observe) |
| Provider adapter hooks | `provider-adapters/` | 7 lifecycle hooks; only `taskFraming` + `toolGuidance` wired |
| ExecutionEngine loop | `packages/runtime/` | 10 phases: BOOTSTRAP → GUARDRAIL → STRATEGY-SELECT → THINK → ACT → OBSERVE → MEMORY-FLUSH → VERIFY → AUDIT → COMPLETE |

## Layer Boundary Rules

```
core → llm-provider / memory / tools / identity / observability / interaction
     → reasoning / guardrails / verification / cost / eval / a2a / gateway / orchestration / prompts
     → runtime
     → reactive-agents (facade)
```

- No upward imports (reasoning must not import runtime)
- No skip-layer imports (reasoning must not import reactive-agents)
- `packages/reasoning` may import: core, llm-provider, memory, tools only

## Anti-Patterns to Flag on Sight

| Anti-pattern | Known location | Signal |
|-------------|----------------|--------|
| Dead code behind feature flags | `context-engine.ts` | `buildDynamicContext`, `buildStaticContext` |
| Untyped meta bag with `as any` | `kernel-state.ts` | `meta: Record<string, unknown>` |
| Half-built extensibility | `provider-adapters/` | 5/7 hooks defined, never called |
| Disabled strategy routing | `strategy-registry.ts` | Local model routing commented out |
| Two-path context building | `context-engine.ts` + `phases/context-builder.ts` | Which is canonical? |
