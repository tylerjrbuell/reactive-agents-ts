---
name: reactive-feature-dev
description: Complete feature development workflow for Reactive Agents. Orchestrates the correct sequence of skills for any feature type. Use at the start of any non-trivial implementation task to route to the right skills and follow the right order.
user-invocable: false
---

# Reactive Agents Feature Development Workflow

## Step 0: Route to the right skills

| Work | Load |
|---|---|
| Kernel (phase, guard, meta-tool, custom kernel) | `kernel-extension` |
| Provider / adapter / streaming | `provider-streaming` |
| MCP (docker tools, transport, container lifecycle) | `mcp-integration` |
| New service in an existing package | `implement-service` |
| New package | `build-package` |

Always also: `agent-tdd` (tests first), `effect-ts-patterns` (all code), `repo-tool` (commands below).

## Step 1: Orient

```bash
bun run repo status                    # branch, plans, debt
bun run repo scope <files you will touch>   # owner/warden, checks, docs
bun run repo find "<symbol or topic>"       # then: bun run repo outline <file>, Read a range
```

Read the affected package's entry point first (`architecture-reference` names it) and its upstream layers. Changes to `core` / `llm-provider` need downstream rebuild and type verification. Domain-scoped edits go through the owning warden (AGENTS.md ownership table).

## Step 2: Failing test first (`agent-tdd`)

Write ONE failing test, run it, confirm the right failure, write minimal code, rerun, then edge cases:

```bash
bun run repo test packages/<pkg>/tests/<file>.test.ts
```

## Step 3: Implement (`effect-ts-patterns`)

`Schema.Struct` for data, `Data.TaggedError` for errors, `Ref` for state, `Effect.tryPromise` for async, `.js` on relative imports, `readonly` service methods. No `any`.

## Step 4: Validate

```bash
bun run repo verify packages/<pkg>   # tests + typecheck + narrow gates
bun run repo check --all             # repo gates
```

Pattern review (`review-patterns`); kernel changes also its Category 9. Build when touching a built package (`packages/reasoning` exports `dist`: rebuild before downstream tests).

## Step 5: Docs, changeset, commit

`update-docs` picks the files to touch. `bun run changeset` (patch fix / minor feature / major breaking). Stage specific files, never `git add -A`; one concern per commit; no AI co-author trailers.

## Subagent context block

```
Project: reactive-agents-ts. TypeScript + Bun + Effect-TS + bun:test. Read AGENTS.md first.
Rules: Schema.Struct data, Data.TaggedError errors, Ref state, Effect.tryPromise async, no any.
Commands: bun run repo test|verify|check|find (no piped tests, no recursive grep). Skills: effect-ts-patterns, repo-tool, [task skill].
```
