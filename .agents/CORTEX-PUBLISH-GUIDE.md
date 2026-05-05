---
title: Cortex Ad-Hoc Publish Guide
date: 2026-05-05
status: Ready to publish
---

# Publishing `@reactive-agents/cortex` to npm — Ad-Hoc

Cortex package is ready to publish to npm. This guide walks through the manual ad-hoc publish (skipping changeset/CI) and follow-up verification.

## Pre-publish Verification ✅

All boxes checked locally:

- [x] `private: true` removed from `apps/cortex/package.json`
- [x] Version: `0.11.0`
- [x] All `workspace:*` deps replaced with `0.10.2` (latest published versions)
- [x] Package metadata complete (description, keywords, license, repository, homepage, bugs)
- [x] `publishConfig.access: "public"` set
- [x] `files` array includes: dist, ui/build, scripts/dev-stack.ts, README.md, LICENSE
- [x] tsup config bundles `server/index.ts` → `dist/index.js` (167KB) + types
- [x] UI builds to `ui/build/` (SvelteKit static output)
- [x] Tarball: 132 files, 1.5MB packed, 2.97MB unpacked
- [x] Server starts cleanly: `http://127.0.0.1:PORT/api/health` → `{"ok":true}`
- [x] Server serves UI: `http://127.0.0.1:PORT/` → HTML
- [x] CLI lazy-loads via `await import("@reactive-agents/cortex")`

## Publish Steps

### 1. Verify npm authentication

```bash
npm whoami
# OR for bun:
bun pm whoami  # if available, otherwise check ~/.npmrc
```

You should be logged in as the publisher account that owns `@reactive-agents` scope.

### 2. Final clean build

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/cortex
rm -rf dist ui/build
bun run build 2>&1 | tail -10
```

Verify outputs:
```bash
ls dist/
# index.d.ts  index.js  index.js.map
ls ui/build/index.html
# ui/build/index.html
```

### 3. Dry-run pack to verify tarball

```bash
bun pm pack --destination /tmp/cortex-publish-check/
tar -tzf /tmp/cortex-publish-check/reactive-agents-cortex-0.11.0.tgz | wc -l
# Should be ~132 files
```

### 4. Publish

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/cortex

# Option A: Bun
bun publish

# Option B: npm (more battle-tested for first publish)
npm publish
```

If 2FA prompts appear, complete authentication.

### 5. Verify publication

```bash
# Wait ~30s for npm registry propagation
sleep 30
npm view @reactive-agents/cortex version
# Should show: 0.11.0

npm view @reactive-agents/cortex
# Should show full package metadata
```

### 6. Test installation in fresh project

```bash
cd /tmp && rm -rf cortex-publish-test && mkdir cortex-publish-test && cd cortex-publish-test
bun init -y
bun add @reactive-agents/cortex
ls node_modules/@reactive-agents/cortex/dist/index.js
ls node_modules/@reactive-agents/cortex/ui/build/index.html
```

### 7. Test via rax (after CLI v0.11.0 is published)

```bash
cd /tmp/cortex-publish-test
bun add reactive-agents@latest
bun add @reactive-agents/cortex
rax cortex --no-open --port 4399 &
sleep 3
curl http://127.0.0.1:4399/api/health
# Should return: {"ok":true,...}
pkill -f "cortex"
```

## Rollback Plan

If something is broken after publish:

```bash
# Unpublish (only allowed within 72 hours of publish, restrictions apply)
npm unpublish @reactive-agents/cortex@0.11.0

# Or deprecate (preferred — keeps version, warns users)
npm deprecate @reactive-agents/cortex@0.11.0 "Broken; use @reactive-agents/cortex@0.11.1"
```

Then fix issues, bump to `0.11.1`, and republish.

## Why Ad-Hoc?

User suggested skipping the release pipeline / changeset workflow for cortex's first publish because:
1. **Validation:** Confirm cortex works correctly on npm BEFORE committing it to permanent CI release pipeline
2. **Decoupling:** Cortex's first publish doesn't have to block v0.11.0 patch (which has 5 unrelated fixes)
3. **Iteration speed:** If cortex publishing has issues, fix and republish without orchestrating a full release

## After Successful Publish

Once cortex is verified on npm:
1. Add `@reactive-agents/cortex` to changeset config so future releases bump it alongside other packages
2. Update CI workflow to publish cortex automatically going forward
3. Add a release note in CHANGELOG.md for v0.11.0: "feat: cortex companion studio now installable from npm — `bun add @reactive-agents/cortex && rax cortex`"

## Related Files Modified

- `apps/cortex/package.json` — Made publishable (commit `87fd9e72`)
- `apps/cortex/tsup.config.ts` — Added server bundle config (commit `87fd9e72`)
- `apps/cli/src/commands/cortex.ts` — Restored with lazy-load pattern (commit `4e71f58b`)
- `apps/cli/src/index.ts` — Re-registered cortex command (commit `4e71f58b`)
- `apps/cli/tsup.config.ts` — Added cortex to externals (commit `4e71f58b`)
- `README.md`, `apps/cli/README.md`, `apps/cortex/AGENTS.md`, `apps/docs/src/content/docs/features/cortex.md` — Doc updates (this commit)
