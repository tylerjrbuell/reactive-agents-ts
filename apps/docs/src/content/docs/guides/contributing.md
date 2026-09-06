---
title: Contributing
description: 'How to develop, test, and release changes to Reactive Agents.'
sidebar:
  order: 99
---

## Setup

```bash
git clone https://github.com/tylerjrbuell/reactive-agents-ts.git
cd reactive-agents-ts
bun install
bun test          # 9,000+ tests — all must pass
bun run build     # ESM + DTS for all 34 packages
```

---

## Development Cycle

```bash
bun test                   # Run full suite
bun test --watch           # Watch mode during development
bun run typecheck          # Workspace-wide type checking
bun run build              # Build all packages and apps
bun run rax -- <args>      # Run the local rax CLI
bun run docs:dev           # Docs site dev server
```

### Before opening a PR

- [ ] `bun test` — 100% green
- [ ] `bun run build` — no errors
- [ ] Documentation updated (see below)
- [ ] Changeset added (see Release Workflow below)

---

## Release Workflow

Releases are **tag-driven lockstep**: one version number stamps every public package at once. `.changeset/*.md` files are notes, not the driver — there is no auto-generated "Version Packages" PR. **Never manually bump `package.json` versions or edit `CHANGELOG.md`.**

### What a contributor does: add a changeset

Every PR that changes user-facing behaviour needs a changeset:

```bash
bun run changeset
```

The interactive prompt asks:
- **Which packages changed?** — select the package(s) your change touches
- **Bump type?** — `patch` for fixes, `minor` for new features, `major` for breaking changes (this bump type informs the release note; every package still ships at the same lockstep version regardless)
- **Summary?** — this text becomes the public CHANGELOG entry verbatim, so write it for a reader of the changelog, not as a commit message

This creates `.changeset/<random-name>.md`. Commit it alongside your code and open the PR as usual.

### What a maintainer does: cut the release

At release time, a maintainer aggregates all pending changesets into `CHANGELOG.md`, picks an explicit version number, and pushes a `vX.Y.Z` git tag. That tag push is the entire trigger — `scripts/release.ts`, run by CI, stamps every package to that version, builds, and publishes to npm in dependency order, then consumes (deletes) the changeset files it aggregated. See `.claude/skills/prepare-release/SKILL.md` for the full maintainer flow.

### Bump types

| Type | When |
|---|---|
| `patch` | Bug fixes, test fixes, internal refactors |
| `minor` | New features, new builder methods, new exports |
| `major` | Breaking API changes, removed exports |

All public packages ship at the same lockstep version — the bump type shapes the changelog note, it does not produce independent per-package versions.

---

## Documentation

### When to update what

| Change | Update |
|---|---|
| New package | `AGENTS.md` package map/status, `README.md` packages table, docs sidebar |
| New builder method | `README.md`, `apps/docs/src/content/docs/reference/builder-api.md`, `AGENTS.md` |
| New CLI command | `README.md`, `apps/docs/src/content/docs/reference/cli.md` |
| New feature | `apps/docs/src/content/docs/features/<name>.md` |
| API signature change | Search docs: `grep -r "oldMethod" apps/docs/` |

### Docs site

```bash
bun run docs:dev      # http://localhost:4321
bun run docs:build    # Production build
bun run docs:preview  # Preview built output
```

Docs are deployed to [docs.reactiveagents.dev](https://docs.reactiveagents.dev) on every push to `main`.

---

## Package Structure

New packages follow this layout:

```
packages/<name>/
  src/
    types.ts          # Schema.Struct types, tagged errors
    errors.ts         # Data.TaggedError definitions
    services/         # Effect-TS Context.Tag services
    runtime.ts        # Layer factories (createXxxLayer)
    index.ts          # All public exports
  tests/
  package.json        # "version" matches workspace, "private": true if internal
  tsconfig.json       # extends ../../tsconfig.json
```

Internal packages that should never be published must have `"private": true` in `package.json`.

### Adding a new package to the publish pipeline

1. Create the package following the structure above
2. Add it to the `fixed` group in `.changeset/config.json`
3. Add its build step to the `build:packages` script in root `package.json`
4. Add it to the workspace in root `package.json` `workspaces`

---

## Code Standards

This project uses **Effect-TS** throughout. Load the `effect-ts-patterns` skill before writing any service code.

```typescript
import { Effect } from "effect";
// Often also: Layer, Context, Schema, Data, Ref — import only what you use
```

- No `throw` — use **`Effect.fail`** with tagged errors (or `Effect.die` for defects)
- No raw `await` inside Effect programs — use **`Effect.promise`**, **`Effect.tryPromise`**, or **`yield*`** inside **`Effect.gen`**
- Prefer **`Effect.succeed`** / **`Effect.sync`** for pure or trivial sync work
- No `any` — use precise types, generics, and tagged unions
- All public APIs need JSDoc comments
- New services need tests in `tests/`

## What's Next

- [FAQ](/guides/faq/) — production readiness, honest caveats, what's not done yet
- [Architecture](/concepts/architecture/) — layer system and package boundaries before you dig into a package
- [Troubleshooting](/guides/troubleshooting/) — symptom-to-fix reference for common failures
