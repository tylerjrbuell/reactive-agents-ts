---
name: review-patterns
description: Review code changes for Effect-TS pattern compliance in the Reactive Agents framework. Use when reviewing PRs, completed packages, or any code changes to enforce project conventions.
argument-hint: <file-or-package-path>
---

# Review Code: $ARGUMENTS

## Review Checklist

Ultrathink through each of these categories systematically.

### Category 1: Type Definitions

Search for type definitions in the target files:

**PASS if:**

- All data shapes use `Schema.Struct` from Effect
- IDs use `Schema.brand()`
- Enums/unions use `Schema.Literal()`
- Optional fields use `Schema.optional()`
- Types are derived with `typeof XxxSchema.Type`

**FAIL if:**

- Uses `interface` for data shapes (should be `Schema.Struct`)
- Uses `type X = { ... }` for complex objects (should be `Schema.Struct`)
- Uses TypeScript `enum` (should be `Schema.Literal`)
- Uses `?:` for optional fields (should be `Schema.optional()`)

### Category 2: Error Handling

**PASS if:**

- All error classes extend `Data.TaggedError("TagName")<{ ... }>`
- Tag string matches class name
- All properties are `readonly`
- Package defines a union type for all errors
- No `throw new Error()` or `throw new XxxError()` anywhere

**FAIL if:**

- Uses `throw` anywhere
- Uses `new Error()` instead of `Data.TaggedError`
- Error properties are not `readonly`
- Tag string doesn't match class name

### Category 3: Service Definitions

**PASS if:**

- Services extend `Context.Tag("Name")<ServiceTag, Interface>()`
- Tag string matches the class name
- All methods are `readonly`
- All methods return `Effect.Effect<T, E>`
- Live implementation uses `Layer.effect(Tag, Effect.gen(...))`
- Dependencies resolved via `yield* OtherService`
- Scoped resources use `Layer.scoped` + `Effect.acquireRelease`

**FAIL if:**

- Uses OOP class with constructor for service
- Uses dependency injection via constructor params
- Methods return `Promise<T>` instead of `Effect.Effect`
- Uses `new Service()` anywhere

### Category 4: State Management

**PASS if:**

- All mutable state uses `Ref` from Effect
- State initialization with `Ref.make()`
- State reads with `Ref.get()`
- State updates with `Ref.update()` or `Ref.modify()`
- Atomic operations use `Ref.modify()`

**FAIL if:**

- Uses `let` for mutable state
- Uses class properties for state
- Uses global mutable variables
- State mutations without Ref

### Category 5: Async Operations

**PASS if:**

- Sync operations (bun:sqlite) wrapped in `Effect.sync()`
- Async operations (fetch, file I/O) use `Effect.tryPromise()`
- `Effect.tryPromise` has a `catch` that returns `Data.TaggedError`
- LLMService calls are NOT wrapped in `Effect.tryPromise` (they already return Effect)

**FAIL if:**

- Uses raw `await`
- Uses `Promise.then()` / `Promise.catch()`
- Wraps Effect-returning functions in `Effect.tryPromise`
- Missing error handler in `Effect.tryPromise`

### Category 6: Layer Composition

**PASS if:**

- Package exports `createXxxLayer()` factory function
- Uses `Layer.mergeAll()` for independent services
- Uses `Layer.provide()` for dependent services
- Layer factory takes configuration arguments when needed

**FAIL if:**

- No layer factory exported
- Dependencies not wired with `Layer.provide()`
- Missing services in the merged layer

### Category 7: Imports and Exports

**PASS if:**

- Relative imports use `.js` extension (Bun ESM requirement)
- `index.ts` exports all public types, errors, services, and layer factory
- Internal imports use correct package names (`@reactive-agents/xxx`)
- No circular imports between packages

**FAIL if:**

- Missing `.js` extension on relative imports
- `index.ts` missing public exports
- Internal implementation details exported

### Category 8: LLMService Usage (if applicable)

**PASS if:**

- Calls `llm.complete({ messages: [...], ... })` with `messages` array
- Reads `response.content` for text output
- Reads `response.usage.estimatedCost` for cost
- Reads `response.usage.totalTokens` for token count
- Does NOT wrap in `Effect.tryPromise`

**FAIL if:**

- Uses `prompt:` field (doesn't exist)
- Reads `.text` instead of `.content`
- Reads `.usage.cost` instead of `.usage.estimatedCost`
- Reads `.usage.confidence` (doesn't exist)
- Wraps in `Effect.tryPromise`

## Output Format

For each category, report:

- **PASS** / **FAIL** / **N/A**
- If FAIL: list the specific files and lines with the violation
- Suggested fix for each violation

Summary: X/8 categories passed. [List critical issues if any.]
