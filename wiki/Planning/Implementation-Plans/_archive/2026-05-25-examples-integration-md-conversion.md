# Bundle: examples-integration-md-conversion
Date: 2026-05-25
Budget: 45 min
Issues: #86

## Context

HS-30 (audit-2026-05-21). 3 integration example files use whole-file `@ts-nocheck` + `(agent as any).dispose()`:

- `apps/examples/src/integrations/25-nextjs-streaming.ts` — uses `next` types implicitly via Request/Response; no real dispose cast
- `apps/examples/src/integrations/26-hono-agent-api.ts` — imports `hono` (not in deps); `(agentInstance as any).dispose()` in shutdown
- `apps/examples/src/integrations/27-express-middleware.ts` — imports `express` (not in deps); `(agentState.instance as any).dispose()` in shutdown

**Root cause:** examples import 3rd-party framework packages (next, hono, express) that `apps/examples/package.json` does NOT install. `@ts-nocheck` masks the missing-module errors. The `as any` on `.dispose()` was added in the same noise — but `ReactiveAgent.dispose(): Promise<void>` IS publicly typed at `packages/runtime/src/reactive-agent.ts:156`; the cast was speculative ("if dispose exists") not actually needed.

**Drift:** zero. All 3 cited locations + 2 `(as any).dispose()` sites confirmed at the exact files. No consumer references the .ts paths beyond their own self-referential docstrings.

## Acceptance criteria

- **#86**: `grep -rn '@ts-nocheck\|(agentInstance as any)\|(agentState.instance as any)' apps/examples/src/integrations/` → 0. Three `.ts` example files converted to `.md` snippets with fenced code blocks. README or directory index updated if it references the old `.ts` paths.

## Baseline

Captured post-branch.

## Execution units (ordered)

1. **Unit 1 — convert 25 / 26 / 27 to .md.** For each file:
   - Extract the top-comment-block prose into a `## Overview` markdown section.
   - Wrap the executable code in a single ` ```ts ` fenced block.
   - Convert the bottom doc-comment blocks (`/** ─── BROWSER CLIENT EXAMPLE ─── */`) into separate markdown sections with appropriate fences.
   - Delete the original `.ts` file (or use `git mv` → rename).
   - Drop `@ts-nocheck` (markdown doesn't typecheck) and the `(x as any).dispose()` casts — replace the dispose blocks with simply `await agentInstance.dispose();` since the method is publicly typed.

2. **Unit 2 — update integrations directory index.** If `apps/examples/src/integrations/` has an index file or README referencing the .ts paths, update to .md.

## Risk register

- **Risk:** Runner (`apps/examples/index.ts`) silently picks up `.ts` files via glob. → **Mitigation:** verified via grep — no consumer references the 25/26/27 paths beyond self-reference.
- **Risk:** README points at the old paths. → **Mitigation:** grep `apps/examples/README*` (if exists) for the file names.

## Verification protocol

- `rtk bun run build` — green (these are not built; examples app has no build step)
- `rtk bun test` — green workspace
- Verified-by recheck: `rtk grep -rn '@ts-nocheck\|(.* as any).dispose' apps/examples/src/integrations/` → 0

## Out-of-scope

- Other `@ts-nocheck` usage elsewhere in the repo — different sites, different reasons.
- Adding `hono`/`express`/`next` as actual devDeps for typed `.ts` examples — would bloat the examples app for a single doc-snippet purpose. `.md` is the right surface.
