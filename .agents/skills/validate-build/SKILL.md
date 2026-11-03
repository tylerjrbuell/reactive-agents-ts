---
name: validate-build
description: Validate a completed package against its spec. Checks patterns, types, exports, dependencies, and test coverage after building a package.
disable-model-invocation: true
argument-hint: <package-name>
---

# Validate Package: $ARGUMENTS

Run after building a package. Mechanical gates first, then the manual checklist.

## 1. Gates

```bash
bun run repo verify packages/$ARGUMENTS   # tests + typecheck + narrow gates
bun run repo check --all                  # ownership/catalog/placement/skills/docs gates
bun run build                             # dist/ must have index.js + index.d.ts, no stale files
```

All must be clean. Test coverage: one test file per service, covering happy path, error cases and state; tests use `Effect.provide(testLayer)` with mock layers.

## 2. Structure and dependencies

- [ ] Files match the spec's Package Structure (`bun run repo outline <spec>` to find the section)
- [ ] `package.json`: `"type": "module"`, `effect` dependency, internal deps `"workspace:*"`, only spec-listed deps
- [ ] `tsconfig.json` extends `../../tsconfig.json`
- [ ] Ownership row exists (`tools/repo/ownership.json`) - `check --only ownership-coverage`

## 3. Pattern compliance (Grep tool over `packages/$ARGUMENTS/src`)

Zero hits expected for: `throw new`, `new Error`, raw `await`, `Promise<` outside `runPromise`/tests, plain `interface` (acceptable only for strategy input types carrying Effect types), `let`. Required hits: `Schema.Struct`, `Data.TaggedError`, `Context.Tag`, `Layer.effect`/`Layer.scoped`, `Ref` for state. Full rubric: `review-patterns`.

## 4. Kernel changes (`packages/reasoning/src/kernel/`)

FAIL if: a phase signature is not `(state: KernelState, context: KernelContext) => Effect<KernelState, never, LLMService>`; a guard returns anything but `{ allow: true }` or `{ block: true; reason: string }`; the runner main loop gained per-turn logic (use a phase); meta-tool registry entries live outside `act`. Rules: `kernel-extension`.

## 5. Services, factory, exports

- [ ] Each service: `Context.Tag("Name")` matching the class name, `readonly` methods returning `Effect.Effect<T, E>`, live layer via `Layer.effect(Tag, Effect.gen(...))`, deps via `yield*`
- [ ] `src/runtime.ts` exports `createXxxLayer()`, composed with `Layer.mergeAll()` / `Layer.provide()`
- [ ] `src/index.ts` exports Schema types, `Data.TaggedError` classes, service tags, `*Live` layers and the factory; nothing internal

## 6. Spec fidelity and consumers

- [ ] Every spec type, error, service and method signature is implemented
- [ ] Downstream packages can import `@reactive-agents/$ARGUMENTS` and compose its layer with `Layer.provide()`

## Report

Checks passed / total, issues with file:line, recommended fixes.
