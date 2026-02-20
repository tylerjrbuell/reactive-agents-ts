---
name: build-package
description: Build a specific Reactive Agents package from its spec. Guides you through the complete build process for any package in the monorepo.
disable-model-invocation: true
argument-hint: <package-name>
---

# Build Package: $ARGUMENTS

## Pre-Flight Checks

1. Verify the monorepo is set up (root `package.json` with workspaces exists). If not, follow `spec/docs/00-monorepo-setup.md` first.
2. Verify all dependency packages for this package are already built and passing tests.

## Build Process

Follow these steps exactly for the `$ARGUMENTS` package:

### Step 1: Identify the spec file

Look up the package in the build order table. Read the corresponding spec file from `spec/docs/`. The spec files are:

| Package       | Spec File                                              |
| ------------- | ------------------------------------------------------ |
| core          | `layer-01-core-detailed-design.md`                     |
| llm-provider  | `01.5-layer-llm-provider.md`                           |
| memory        | `02-layer-memory.md`                                   |
| reasoning     | `03-layer-reasoning.md`                                |
| verification  | `04-layer-verification.md`                             |
| cost          | `05-layer-cost.md`                                     |
| identity      | `06-layer-identity.md`                                 |
| orchestration | `07-layer-orchestration.md`                            |
| tools         | `08-layer-tools.md`                                    |
| observability | `09-layer-observability.md`                            |
| interaction   | `layer-10-interaction-revolutionary-design.md`         |
| runtime       | `layer-01b-execution-engine.md`                        |
| guardrails    | `11-missing-capabilities-enhancement.md` (Package 1)   |
| eval          | `11-missing-capabilities-enhancement.md` (Package 2)   |
| prompts       | `11-missing-capabilities-enhancement.md` (Package 3)   |
| cli           | `11-missing-capabilities-enhancement.md` (Extension 7) |

### Step 2: Read the full spec

Read the entire spec file. Pay special attention to:

- **Package Structure** section — create all directories exactly as shown
- **Build Order** section — implement files in this exact numbered sequence
- **package.json** section — use exact dependencies listed

### Step 3: Create package.json

Create `packages/$ARGUMENTS/package.json` with the dependencies from the spec. Use this template:

```json
{
  "name": "@reactive-agents/$ARGUMENTS",
  "version": "0.0.1",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "bun run typecheck",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "effect": "^3.10.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "bun-types": "latest"
  }
}
```

Add internal dependencies as needed (e.g., `"@reactive-agents/core": "workspace:*"`).

### Step 4: Create tsconfig.json

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### Step 5: Implement files in Build Order

For each file in the spec's Build Order:

1. Read the exact code from the spec
2. Create the file, following the spec code closely
3. Ensure all imports reference the correct packages
4. Verify Effect-TS patterns are followed:
   - Types use `Schema.Struct`
   - Errors use `Data.TaggedError`
   - Services use `Context.Tag` + `Layer.effect`
   - State uses `Ref`
   - No `throw`, no raw `await`

### Step 6: Create the runtime factory

Create `src/runtime.ts` with a `createXxxLayer()` function that composes all services.

### Step 7: Create index.ts

Create `src/index.ts` that re-exports all public types, errors, services, and the layer factory.

### Step 8: Write tests

Create test files as specified. Use `bun:test` (`describe`, `it`, `expect`). Test with the Effect test runtime:

```typescript
import { Effect, Layer } from "effect";
import { describe, it, expect } from "bun:test";

describe("MyService", () => {
  const testLayer = createMyLayer();

  it("should do work", async () => {
    const result = await Effect.gen(function* () {
      const svc = yield* MyService;
      return yield* svc.doWork("input");
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(result).toBe("expected");
  });
});
```

### Step 9: Run tests

```bash
bun test packages/$ARGUMENTS
```

All tests must pass before moving to the next package.

### Step 10: Run install and typecheck

```bash
bun install
bun run --filter "@reactive-agents/$ARGUMENTS" typecheck
```

## Critical Reminders

- **Copy from the spec** — the spec contains exact code to implement. Do not invent patterns.
- **Follow the Build Order** — files have dependencies on each other. Order matters.
- **Check dependency packages exist** — if the spec imports from `@reactive-agents/core`, that package must be built first.
- **One package at a time** — complete and test one package before starting the next.
