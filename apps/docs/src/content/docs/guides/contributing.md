---
title: Contributing
description: How to develop, test, and release changes to Reactive Agents.
sidebar:
  order: 99
---

## Setup

```bash
git clone https://github.com/tylerjrbuell/reactive-agents-ts.git
cd reactive-agents-ts
bun install
bun test          # 2189 tests — all must pass
bun run build     # ESM + DTS for all 22 packages
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

This project uses **[Changesets](https://github.com/changesets/changesets)** for versioning and publishing. **Never manually bump `package.json` versions or edit `CHANGELOG.md` for a new release.**

### 1. Add a changeset with your PR

Every PR that changes user-facing behaviour needs a changeset:

```bash
bun run changeset
```

The interactive prompt asks:
- **Which packages changed?** — Select any package (all 20 are in a fixed group, so all move together)
- **Bump type?** — `patch` for fixes, `minor` for new features, `major` for breaking changes
- **Summary?** — One line description that becomes the CHANGELOG entry

This creates `.changeset/<random-name>.md`. Commit it alongside your code.

### 2. Merge to main

The `changesets/action` workflow detects pending changesets and automatically opens a **"chore: version packages"** PR that:
- Bumps all package versions consistently
- Generates `CHANGELOG.md` entries from your changeset summaries
- Stays open and accumulates more changesets until you're ready to release

### 3. Merge the Version Packages PR to publish

When you're ready to ship, merge the "chore: version packages" PR. The workflow then:
1. Builds all packages
2. Runs `changeset publish` — correctly resolves `workspace:*` deps and publishes to npm
3. Creates a GitHub Release with the generated notes

### Bump types

| Type | When | Example |
|---|---|---|
| `patch` | Bug fixes, test fixes, internal refactors | `0.7.6 → 0.7.7` |
| `minor` | New features, new builder methods, new exports | `0.7.6 → 0.8.0` |
| `major` | Breaking API changes | `0.7.6 → 1.0.0` |

All 20 publishable packages move together in a fixed group — bumping any one bumps all of them to the same version.

---

## Documentation

### When to update what

| Change | Update |
|---|---|
| New package | `CLAUDE.md` package map, `README.md` packages table, docs sidebar |
| New builder method | `README.md`, `apps/docs/src/content/docs/reference/builder-api.md`, `CLAUDE.md` |
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

- No `throw` — use `Effect.fail` with tagged errors
- No raw `await` — use `Effect.promise` or `Effect.tryPromise`
- No `any` — use precise types, generics, and tagged unions
- All public APIs need JSDoc comments
- New services need tests in `tests/`
