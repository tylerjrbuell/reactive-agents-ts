---
name: validate-build
description: Validate a completed package against its spec. Checks patterns, types, exports, dependencies, and test coverage after building a package.
disable-model-invocation: true
argument-hint: <package-name>
---

# Validate Package: $ARGUMENTS

Run this checklist after building a package to ensure it conforms to the spec and project patterns.

## 1. Structure Check

Verify the package directory matches the spec's Package Structure section:

```bash
find packages/$ARGUMENTS/src -type f -name "*.ts" | sort
```

Compare the output against the file list in the spec. Every file listed in the spec must exist.

## 2. Dependency Check

Read `packages/$ARGUMENTS/package.json` and verify:

- [ ] `"type": "module"` is set
- [ ] `"effect": "^3.10.0"` is in dependencies
- [ ] All internal dependencies use `"workspace:*"` (e.g., `"@reactive-agents/core": "workspace:*"`)
- [ ] Dependencies match what the spec lists
- [ ] No unnecessary dependencies (e.g., no `lancedb`, no `nomic`)
- [ ] `tsconfig.json` extends `../../tsconfig.json`

## 3. Pattern Compliance

Search the package source for anti-patterns:

```bash
# Should find ZERO matches for these anti-patterns:
grep -rn "throw new" packages/$ARGUMENTS/src/ || echo "✅ No throw"
grep -rn "^interface " packages/$ARGUMENTS/src/ || echo "✅ No plain interfaces"
grep -rn "let " packages/$ARGUMENTS/src/ || echo "✅ No let declarations"
grep -rn "new Error" packages/$ARGUMENTS/src/ || echo "✅ No new Error"
grep -rn "await " packages/$ARGUMENTS/src/ || echo "✅ No raw await"
grep -rn "Promise<" packages/$ARGUMENTS/src/ | grep -v "runPromise\|test" || echo "✅ No raw Promises"

# Should find matches for required patterns:
grep -rn "Schema.Struct" packages/$ARGUMENTS/src/ && echo "✅ Uses Schema.Struct"
grep -rn "Data.TaggedError" packages/$ARGUMENTS/src/ && echo "✅ Uses Data.TaggedError"
grep -rn "Context.Tag" packages/$ARGUMENTS/src/ && echo "✅ Uses Context.Tag"
grep -rn "Layer.effect\|Layer.scoped" packages/$ARGUMENTS/src/ && echo "✅ Uses Layer.effect/scoped"
grep -rn "Ref.make\|Ref.get\|Ref.update" packages/$ARGUMENTS/src/ && echo "✅ Uses Ref for state"
```

## 4. Service Verification

For every service in the package, verify:

- [ ] Class extends `Context.Tag("ServiceName")<...>()`
- [ ] Tag string matches class name exactly
- [ ] All methods are `readonly`
- [ ] All methods return `Effect.Effect<T, E>`
- [ ] Live layer uses `Layer.effect(Tag, Effect.gen(...))`
- [ ] Dependencies resolved with `yield* OtherService`

## 5. Runtime Factory Check

Verify `src/runtime.ts`:

- [ ] Exports a `createXxxLayer()` function
- [ ] Uses `Layer.mergeAll()` to combine services
- [ ] Uses `Layer.provide()` to wire dependencies
- [ ] Takes configuration parameters if needed by the spec

## 6. Index.ts Exports

Verify `src/index.ts` exports:

- [ ] All public Schema types
- [ ] All `Data.TaggedError` classes
- [ ] All service `Context.Tag` classes
- [ ] All `*Live` layer implementations
- [ ] The `createXxxLayer()` factory function
- [ ] No internal/private implementation details

## 7. Test Coverage

Verify tests exist and pass:

```bash
bun test packages/$ARGUMENTS
```

Check:

- [ ] Test file exists for each service
- [ ] Tests cover happy path, error cases, and state management
- [ ] Tests use `Effect.provide(testLayer)` pattern
- [ ] Tests use mock layers for dependencies where appropriate
- [ ] All tests pass

## 8. TypeScript Compilation

```bash
bun run --filter "@reactive-agents/$ARGUMENTS" typecheck
```

Must complete with zero errors.

## 9. Spec Fidelity

Read through the spec one final time and verify:

- [ ] Every type/schema in the spec is implemented
- [ ] Every error type in the spec is implemented
- [ ] Every service in the spec is implemented
- [ ] Every method on every service matches the spec's signature
- [ ] The build order was followed (files created in correct sequence)
- [ ] Any spec-specific notes or caveats are addressed

## 10. Integration Points

If this package is consumed by others:

- [ ] Downstream packages can import from `@reactive-agents/$ARGUMENTS`
- [ ] Types are usable in downstream service signatures
- [ ] Layer can be composed with `Layer.provide()` in downstream packages

## Report

After completing all checks, summarize:

- Number of checks passed / total
- Any issues found with specific file paths and line numbers
- Recommended fixes for any failures
