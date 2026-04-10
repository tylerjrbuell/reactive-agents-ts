---
name: build-package
description: Add a new package to the Reactive Agents monorepo. Covers scaffolding, package.json, tsconfig, layer wiring, and index exports. Use when creating a net-new @reactive-agents/* package.
argument-hint: <package-name>
---

# Add New Package: $ARGUMENTS

All 22 core packages exist. Use this skill only when creating a genuinely new package.

## Step 1: Determine the layer

Identify which dependency layer your package belongs to (from `architecture-reference`):

| Your package depends on | Layer |
|------------------------|-------|
| Nothing (or only external npm) | Layer 0 |
| `core` only | Layer 1 |
| `core` + `llm-provider` | Layer 2 |
| Multiple Layer 1–2 packages | Layer 3 |
| All packages (facade) | Layer 4 |

Packages can only depend on packages in lower layers.

## Step 2: Scaffold directory structure

```bash
mkdir -p packages/$ARGUMENTS/src/services
mkdir -p packages/$ARGUMENTS/tests
```

## Step 3: Create package.json

```json
{
  "name": "@reactive-agents/$ARGUMENTS",
  "version": "0.0.1",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "bun test --timeout 15000"
  },
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "bun-types": "latest",
    "tsup": "^8.0.0"
  }
}
```

Add additional `@reactive-agents/*` workspace dependencies based on your layer assignment.

## Step 4: Create tsconfig.json

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

## Step 5: Create tsup.config.ts

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
```

## Step 6: Create errors.ts

```typescript
// packages/$ARGUMENTS/src/errors.ts
import { Data } from "effect";

export class $ARGUMENTSError extends Data.TaggedError("$ARGUMENTSError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type $ARGUMENTSErrors = $ARGUMENTSError;
```

## Step 7: Create your first service

Follow `.agents/skills/implement-service/SKILL.md` for the service template.

## Step 8: Create runtime.ts (layer factory)

```typescript
// packages/$ARGUMENTS/src/runtime.ts
import { Layer } from "effect";
import { MyServiceLive } from "./services/my-service.js";
import { DependencyServiceLive } from "@reactive-agents/core";

export const create$ARGUMENTSLayer = () =>
  Layer.mergeAll(
    MyServiceLive.pipe(Layer.provide(DependencyServiceLive)),
  );
```

## Step 9: Create index.ts

```typescript
// packages/$ARGUMENTS/src/index.ts
export { MyService, MyServiceLive } from "./services/my-service.js";
export { create$ARGUMENTSLayer } from "./runtime.js";
export type { $ARGUMENTSErrors } from "./errors.js";
```

## Step 10: Register in workspace

Add to root `package.json` workspaces array if using explicit list:

```json
"packages/$ARGUMENTS"
```

## Step 11: Update architecture-reference and AGENTS.md

After creating the package, update:

- `.agents/skills/architecture-reference/SKILL.md` — add to package list and dependency graph
- `AGENTS.md` — add to package count and dependency tree
- `README.md` — add to packages table
- `.agents/MEMORY.md` — update current package count

## Step 12: Write tests and build

```bash
# Write at least one test (see agent-tdd skill)
bun test packages/$ARGUMENTS --timeout 15000

# Build
bun run build --filter @reactive-agents/$ARGUMENTS

# Typecheck
bun run typecheck --filter @reactive-agents/$ARGUMENTS
```
