# Monorepo Setup — AI Agent Implementation Spec

## Overview

This document specifies the monorepo scaffolding required **before** building any package. It defines the root workspace configuration, shared TypeScript config, per-package template, and build/test scripts. Follow this spec first.

**Runtime:** Bun ≥ 1.1
**Package Manager:** Bun (built-in workspace support)
**Module System:** ESM (`"type": "module"`)

---

## Step 1: Create Directory Structure

```bash
mkdir -p packages/{core,llm-provider,memory,reasoning,verification,cost,identity,orchestration,tools,observability,interaction,runtime,guardrails,eval,prompts}
mkdir -p apps/{cli,examples}
```

---

## Step 2: Root `package.json`

```json
{
  "name": "reactive-agents",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "build": "bun run --filter '*' build",
    "test": "bun test",
    "test:watch": "bun test --watch",
    "typecheck": "bun run --filter '*' typecheck",
    "clean": "find packages apps -name 'dist' -type d -exec rm -rf {} + 2>/dev/null || true"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "bun-types": "latest"
  }
}
```

---

## Step 3: Root `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "exclude": ["node_modules", "dist"]
}
```

---

## Step 4: Per-Package `tsconfig.json` Template

Every package in `packages/` uses this template (adjust `rootDir` if needed):

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "paths": {}
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

---

## Step 5: Per-Package `package.json` Template

Each package follows this structure. Replace `PACKAGE_NAME` and `DEPS` per-package:

```json
{
  "name": "@reactive-agents/PACKAGE_NAME",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "test:watch": "bun test --watch"
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

**Inter-package references** use `"workspace:*"`:

```json
{
  "dependencies": {
    "@reactive-agents/core": "workspace:*",
    "@reactive-agents/llm-provider": "workspace:*"
  }
}
```

---

## Step 6: Package Dependency Map

This table shows the required `dependencies` for each package's `package.json`. All packages also depend on `effect@^3.10.0`.

| Package         | Workspace Dependencies                                  | External Dependencies                           |
| --------------- | ------------------------------------------------------- | ----------------------------------------------- |
| `core`          | —                                                       | `ulid`                                          |
| `llm-provider`  | `core`                                                  | —                                               |
| `memory`        | `core`                                                  | —                                               |
| `reasoning`     | `core`, `llm-provider`                                  | `ulid`                                          |
| `verification`  | `core`, `llm-provider`, `memory`                        | —                                               |
| `cost`          | `core`, `llm-provider`, `memory`                        | —                                               |
| `identity`      | `core`                                                  | `@noble/ed25519`                                |
| `orchestration` | `core`, `llm-provider`, `identity`, `reasoning`, `cost` | —                                               |
| `tools`         | `core`                                                  | —                                               |
| `observability` | `core`                                                  | `@opentelemetry/api`, `@opentelemetry/sdk-node` |
| `interaction`   | `core`, `reasoning`, `observability`                    | —                                               |
| `runtime`       | `core`, `llm-provider`, `memory`                        | —                                               |
| `guardrails`    | `core`, `llm-provider`                                  | —                                               |
| `eval`          | `core`, `llm-provider`                                  | —                                               |
| `prompts`       | `core`                                                  | —                                               |

**Optional dependencies** for `runtime`:

```json
{
  "optionalDependencies": {
    "@reactive-agents/guardrails": "workspace:*",
    "@reactive-agents/verification": "workspace:*",
    "@reactive-agents/cost": "workspace:*",
    "@reactive-agents/reasoning": "workspace:*",
    "@reactive-agents/tools": "workspace:*",
    "@reactive-agents/identity": "workspace:*",
    "@reactive-agents/observability": "workspace:*",
    "@reactive-agents/interaction": "workspace:*"
  }
}
```

**Note:** `tools` does NOT depend on `identity` in Phase 1. Authorization enforcement is added as an optional dependency in Phase 3 after identity is built.

---

## Step 7: `.gitignore`

```
node_modules/
dist/
bun.lockb
.env
.env.local
.reactive-agents/
*.tsbuildinfo
```

---

## Step 8: Validate Setup

After running `bun install`, verify:

```bash
# All packages resolve
bun install

# TypeScript config is valid
bunx tsc --noEmit

# Test runner works
bun test
```

---

## Step 9: Environment Variables

Create a `.env.example` at the root:

```bash
# LLM (at least one required)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Embeddings (Tier 2 memory only)
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

# Ollama (local alternative)
# EMBEDDING_PROVIDER=ollama
# OLLAMA_ENDPOINT=http://localhost:11434

# Optional
LLM_DEFAULT_MODEL=claude-sonnet-4-20250514
LLM_MAX_RETRIES=3
```

---

## Build Order After Setup

Once this monorepo is scaffolded, proceed to build packages in the order specified in `START_HERE_AI_AGENTS.md`:

1. `@reactive-agents/core` (Layer 1)
2. `@reactive-agents/llm-provider` (Layer 1.5)
3. `@reactive-agents/memory` (Layer 2, Tier 1)
4. `@reactive-agents/tools` (Layer 8)
5. `@reactive-agents/reasoning` (Layer 3, Reactive only)
6. `@reactive-agents/interaction` (Layer 10, Autonomous only)
7. `@reactive-agents/runtime` (ExecutionEngine + Builder)

---

## Success Criteria

- [ ] `bun install` completes without errors
- [ ] All 15 `packages/*/package.json` files exist with correct dependencies
- [ ] Root `tsconfig.json` and per-package `tsconfig.json` files exist
- [ ] `bun test` runs (even with zero tests, exits cleanly)
- [ ] `.env.example` exists at root
- [ ] `.gitignore` excludes node_modules, dist, .env, .reactive-agents/

**Status: Ready for AI agent implementation**
**Priority: FIRST — before any package build**
