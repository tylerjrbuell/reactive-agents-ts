---
name: reactive-feature-dev
description: Complete feature development workflow for Reactive Agents. Orchestrates the correct sequence of skills for any feature type. Use at the start of any non-trivial implementation task to route to the right skills and follow the right order.
user-invocable: false
---

# Reactive Agents Feature Development Workflow

## Step 0: Route to the Right Skills First

Before writing any code, identify what kind of work this is and load the corresponding skill:

```
Is this kernel work (new phase, guard, meta-tool, custom kernel)?
  → Load: kernel-extension skill

Is this provider or adapter work (new provider, streaming, adapter hooks)?
  → Load: provider-streaming skill

Is this MCP work (docker-based tools, transport, container lifecycle)?
  → Load: mcp-integration skill

Is this a new service in an existing package?
  → Load: implement-service skill

Is this a new package?
  → Load: build-package skill (add-new-package)
```

For all cases, also load: `agent-tdd` (write tests first), `effect-ts-patterns` (required for all code).

## Step 1: Read Before Writing

```bash
# 1. Confirm current architecture
cat AGENTS.md | head -100

# 2. Read the affected package's source entry point
# (see architecture-reference skill for the right first file per package)

# 3. Identify which dependency layers are affected
# Changes to upstream packages (core, llm-provider) require downstream rebuild
```

Do NOT skip this step. Writing code without reading the affected package first causes:

- Duplicate implementations of existing functionality
- Wrong dependency layer — editing a higher-layer package when the change belongs in a lower one
- Breaking existing patterns because you didn't see them

## Step 2: Identify Dependency Impact

Check the build order before touching any package:

```
Layer 0: core → llm-provider (changes here require rebuilding EVERYTHING downstream)
Layer 1: memory, tools, guardrails, cost, identity, observability, interaction, prompts, eval, a2a
Layer 2: reasoning, verification, orchestration, gateway, reactive-intelligence
Layer 3: runtime → reactive-agents (facade)
```

If your change touches Layer 0 or 1, plan for cross-package type verification.

## Step 3: Write the Failing Test First (agent-tdd)

Following `agent-tdd` skill:

```typescript
// 1. Create test file with mandatory header
// Run: bun test packages/<pkg>/tests/<your-file>.test.ts --timeout 15000

// 2. Write ONE failing test that captures the desired behavior
// 3. Run it — confirm it fails with the right error
bun test packages/<pkg>/tests/<your-file>.test.ts --timeout 15000

// 4. Write minimal code to pass
// 5. Run again — confirm it passes
// 6. Add edge case tests, refactor
```

## Step 4: Implement with Effect-TS Patterns

Following `effect-ts-patterns` skill:

- All data shapes: `Schema.Struct` — never `interface` or `type { ... }`
- All errors: `Data.TaggedError` — never `throw new Error()`
- All state: `Ref.make` / `Ref.get` / `Ref.update` — never `let`
- All async: `Effect.tryPromise` — never `await`
- All imports: `.js` extension on relative imports (Bun ESM)
- All service methods: `readonly` keyword

## Step 5: Validate Before Committing

Run both validators:

```bash
# 1. Pattern compliance (anti-pattern grep)
# (from validate-build skill)
grep -rn "throw new" packages/<pkg>/src/ || echo "✅ No throw"
grep -rn "^interface " packages/<pkg>/src/ || echo "✅ No plain interfaces"
grep -rn "let " packages/<pkg>/src/ || echo "✅ No let"
grep -rn "await " packages/<pkg>/src/ || echo "✅ No raw await"

# 2. Full package test
bun test packages/<pkg> --timeout 15000

# 3. Typecheck
bun run typecheck --filter @reactive-agents/<pkg>

# 4. Build (if touching a built package)
bun run build --filter @reactive-agents/<pkg>
```

For kernel changes, also run `review-patterns` Category 9 (kernel-extension compliance).

## Step 6: Update Documentation

Following `update-docs` skill:

```bash
# Check what changed
git diff --name-only HEAD

# Update AGENTS.md if: new package, new builder method, test count changed
# Update README.md if: new package, new provider, new capability
# Update docs site if: new feature needs a docs page
# Update .agents/MEMORY.md with new capabilities/patterns
```

## Step 7: Commit and Add Changeset

```bash
# Stage specific files — never git add -A
git add packages/<pkg>/src/ packages/<pkg>/tests/

# Commit with present-tense description of what changed
git commit -m "feat(<pkg>): <what the change does>"

# Add changeset for version bump
bun run changeset
# Choose: patch (bug fix), minor (new feature), major (breaking change)
```

## Dead Code Areas — Do Not Touch

These sections exist in the codebase but are disabled. Do not modify, re-enable, or "clean up":

| Area | Location | Size |
|------|---------|------|
| `buildDynamicContext` | `packages/reasoning/src/strategies/kernel/phases/context-builder.ts` | ~280 LOC |
| `buildStaticContext` | same file | ~280 LOC |
| Dead text-assembly functions | `packages/reasoning/src/strategies/kernel/utils/context-utils.ts` | ~690 LOC total |

These are preserved as reference. Any PR that modifies them will be rejected.

## Quality Gates Before Any Commit

All of these must pass. No exceptions:

- [ ] No `any` types (including `as any` casts)
- [ ] No `interface` for data shapes (use `Schema.Struct`)
- [ ] No `let` for mutable state (use `Ref`)
- [ ] No `await` (use `Effect.tryPromise` or `Effect.sync`)
- [ ] No `throw` (use `Data.TaggedError`)
- [ ] All relative imports have `.js` extension
- [ ] All tests pass: `bun test packages/<pkg> --timeout 15000`
- [ ] Build passes: `bun run build --filter @reactive-agents/<pkg>`

## Subagent Context Template

When dispatching a subagent for implementation work, include this context block:

```
Project: Reactive Agents (reactive-agents-ts)
Stack: TypeScript + Bun + Effect-TS (^3.10) + bun:test
Key rule: All data shapes use Schema.Struct, errors use Data.TaggedError, state uses Ref, async uses Effect.tryPromise
Tests: always --timeout 15000, always targeted file not global suite
Required skills to load: effect-ts-patterns, [task-specific skill from routing above]
Dead code: do not touch buildDynamicContext/buildStaticContext or context-engine.ts dead sections
Architecture: read AGENTS.md before making changes
```
