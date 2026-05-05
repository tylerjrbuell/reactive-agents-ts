# Cortex Documentation Audit — May 5, 2026

## Executive Summary

**Status: CRITICAL ISSUE FOUND**

Post-May-4 package conversion (`@reactive-agents/cortex` published to npm), cortex documentation contains **significant contradictions** between the feature guide and CLI reference. The feature guide correctly describes cortex as a public npm package, but the CLI reference still claims it is "not shipped in the public CLI" and is a "contributor tool only."

---

## Documentation Review

### 1. `apps/docs/src/content/docs/features/cortex.md`
**Status:** ACCURATE (Updated May 4-5)

**Key Findings:**
- ✅ **Line 22-26:** Correctly shows npm install path: `bun add @reactive-agents/cortex`
- ✅ **Line 26:** Shows `rax cortex` command works after npm install
- ✅ **Line 37-48:** Correctly describes "From source repo (contributors)" as the alternative
- ✅ **Lines 200-206:** Accurately documents `.withCortex()` builder method
- ✅ **Lines 236-244:** All environment variables documented correctly (CORTEX_PORT, CORTEX_URL, CORTEX_NO_OPEN, CORTEX_LOG, CORTEX_SKILL_SCAN_ROOT)

**Issue Found:** Line 250 — Stale Note
```markdown
> **Note:** Cortex is a contributor tool, not a public CLI command. Launch it from a repo clone via `bun cortex`...
```
This contradicts the earlier "From npm (recommended)" tab which clearly shows `rax cortex` is public. This note should be removed or reworded.

### 2. `apps/docs/src/content/docs/reference/cli.md`
**Status:** OUTDATED (Not Updated)

**Critical Issues:**

**Line 85:** Contradicts feature guide
```markdown
Cortex is a contributor tool launched from a repo clone via `bun cortex` (it is not shipped in the public CLI)
```
- ❌ **FALSE:** Cortex IS now shipped in public CLI via lazy-load pattern
- ❌ **FALSE:** `rax cortex` works after `bun add @reactive-agents/cortex`

**Line 93:** Section heading still says "contributor tool"
```markdown
### Cortex (contributor tool)
```
- ❌ Should be: `### Cortex (public package)`

**Line 95:** Claims cortex is not shipped
```markdown
Cortex is the companion studio (Bun + Elysia + SvelteKit). It depends on the workspace source tree and is **not** shipped in the public `rax` CLI.
```
- ❌ **FALSE:** It IS shipped; it's optional/lazy-loaded as a peer dependency
- ❌ Misleads users into thinking they must clone the repo

**Lines 98-103:** Still recommends repo clone as primary path
```bash
git clone https://github.com/tylerjrbuell/reactive-agents-ts
cd reactive-agents-ts
bun install
bun cortex
```
- ❌ Should prioritize `bun add @reactive-agents/cortex && rax cortex`

---

## Command Accuracy Analysis

### `rax cortex` Command
- **Feature guide:** ✅ Accurately described as public npm command
- **CLI reference:** ❌ Incorrectly described as "not shipped"
- **Implementation (apps/cli/src/commands/cortex.ts):** ✅ Correctly implements lazy-load pattern
  - Lines 26-27 show `bun add @reactive-agents/cortex` installation message
  - Lines 106-108 dynamically import `@reactive-agents/cortex` as optional peer dep
  - Lines 110-116 provide clear error message if package not installed

### `bun cortex` Command
- **Feature guide:** ✅ Correctly documented as "from source repo (contributors)"
- **CLI reference:** ✅ Mentioned as alternative (though as primary path)
- **Implementation (apps/cortex/scripts/dev-stack.ts):** ✅ Spawns dev server + Vite UI

### Port/URL/Startup Information
- **CORTEX_PORT:** ✅ Documented everywhere (default 4321)
- **CORTEX_URL:** ✅ Documented everywhere (default http://localhost:4321)
- **CORTEX_NO_OPEN:** ✅ Documented everywhere (suppress browser auto-open)
- **URL consistency:** ✅ Correctly documented as `http://127.0.0.1:4321` for `rax cortex`, `http://localhost:5173` for Vite dev UI

---

## Availability Claims Analysis

### Cortex as Public Package
- **Feature guide:** ✅ Claims cortex is public (implicit via npm tab)
- **CLI reference:** ❌ Claims cortex is "contributor tool only"
- **Reality:** `@reactive-agents/cortex` v0.10.2 is published to npm with `"publishConfig": { "access": "public" }`

### Documentation of Installation Paths
- **Feature guide:** ✅ Both paths shown equally:
  - "From npm (recommended)" — `bun add @reactive-agents/cortex`
  - "From source repo (contributors)" — git clone
- **CLI reference:** ❌ Only shows source repo path; npm path entirely absent

---

## Environment Variables Documentation

| Variable | Feature Guide | CLI Reference | Actual Status |
|----------|---|---|---|
| `CORTEX_PORT` | ✅ Documented | ✅ Documented | Default: 4321 |
| `CORTEX_URL` | ✅ Documented | ✅ Documented | Default: http://localhost:4321 |
| `CORTEX_NO_OPEN` | ✅ Documented | ✅ Documented | Suppress browser |
| `CORTEX_LOG` | ✅ Documented | ❌ Missing | Options: error, warn, info, debug |
| `CORTEX_SKILL_SCAN_ROOT` | ✅ Documented | ❌ Missing | Extra SKILL.md scan path |

---

## Implementation Verification

### `apps/cli/src/commands/cortex.ts` (Lazy-Load Pattern)
- ✅ **Line 2:** Comment accurately describes lazy-load pattern
- ✅ **Lines 26-27:** Help text shows `bun add @reactive-agents/cortex` installation
- ✅ **Line 108:** Dynamic import of `@reactive-agents/cortex` as optional peer dep
- ✅ **Lines 110-116:** User-friendly error message if not installed:
  ```
  Install it:
    bun add @reactive-agents/cortex
  Or run from source repo:
    bun cortex
  ```

### `@reactive-agents/cortex` Package (v0.10.2)
- ✅ **package.json line 2:** Version: 0.10.2
- ✅ **package.json line 26:** `"publishConfig": { "access": "public" }`
- ✅ **package.json line 28:** `"main": "./dist/index.js"` (shipping dist/)
- ✅ **package.json lines 38-43:** Files array includes `ui/build` (bundled static assets)

### Cortex Startup Modes
- ✅ **npm mode:** `rax cortex` (after `bun add @reactive-agents/cortex`)
  - API: http://127.0.0.1:4321
  - Browser auto-opens
- ✅ **source mode:** `bun cortex` (from cloned repo)
  - API: http://localhost:4321
  - UI (Vite dev): http://localhost:5173 (hot reload)

---

## Critical Issues Found

### Issue 1: CLI Reference Contradicts Feature Guide (BLOCKING)
**Severity:** HIGH  
**Files:** `apps/docs/src/content/docs/reference/cli.md` (lines 85, 93, 95)

**Current Text:**
```markdown
### Cortex (contributor tool)
Cortex is the companion studio ... It depends on the workspace source tree and is **not** shipped in the public `rax` CLI.
```

**Why Critical:**
- User reads feature guide, sees `bun add @reactive-agents/cortex && rax cortex` works
- User reads CLI reference, sees "not shipped in public CLI"
- User is confused and uncertain which source to trust
- Actual implementation supports the feature guide; CLI reference is stale

**Impact:** New users will attempt to clone repo instead of using npm package, defeating the purpose of publishing cortex as public package.

### Issue 2: CLI Reference Omits Lazy-Load Pattern (MISLEADING)
**Severity:** HIGH  
**Files:** `apps/docs/src/content/docs/reference/cli.md` (lines 93-103)

**Current Text:**
```markdown
To run it, clone the repo and use the root `cortex` script:
```

**Why Misleading:**
- Doesn't mention that cortex is now lazy-loadable as optional peer dep
- Doesn't show `bun add @reactive-agents/cortex` path at all
- Makes npm-installed CLI users think they must clone repo to use cortex

**Impact:** Users who install rax via npm won't discover the cortex npm package.

### Issue 3: Feature Guide Note is Contradictory (CONFUSING)
**Severity:** MEDIUM  
**Files:** `apps/docs/src/content/docs/features/cortex.md` (line 250)

**Current Text:**
```markdown
> **Note:** Cortex is a contributor tool, not a public CLI command.
```

**Why Confusing:**
- Contradicts the immediately preceding "From npm (recommended)" tab
- Suggests cortex is not public, when the entire feature guide promotes it as public
- Created before May 4 package conversion; not updated

**Impact:** Reduces user confidence in the recommended npm installation path.

### Issue 4: CLI Reference Missing Environment Variables
**Severity:** LOW  
**Files:** `apps/docs/src/content/docs/reference/cli.md` (lines 111-115)

**Missing Variables:**
- `CORTEX_LOG` (server log verbosity)
- `CORTEX_SKILL_SCAN_ROOT` (extra SKILL.md scan path)

**Impact:** CLI reference users won't know these variables exist.

---

## Recommendations

### Critical Edits Required

#### Edit 1: Replace `apps/docs/src/content/docs/reference/cli.md` lines 85-86
**Current:**
```markdown
**`--cortex`:** Enables `.withCortex()` on the builder so run lifecycle events are sent to a local **Cortex** companion studio (WebSocket ingest). Cortex is a contributor tool launched from a repo clone via `bun cortex` (it is not shipped in the public CLI). Set `CORTEX_URL` to the HTTP base (default `http://127.0.0.1:4321`).
```

**Recommended:**
```markdown
**`--cortex`:** Enables `.withCortex()` on the builder so run lifecycle events are sent to a local **Cortex** companion studio (WebSocket ingest). Cortex is available as `@reactive-agents/cortex` on npm and can be installed with `bun add @reactive-agents/cortex`, then launched with `rax cortex`. Set `CORTEX_URL` to the HTTP base (default `http://127.0.0.1:4321`).
```

#### Edit 2: Replace `apps/docs/src/content/docs/reference/cli.md` lines 93-103
**Current:**
```markdown
### Cortex (contributor tool)

Cortex is the companion studio (Bun + Elysia + SvelteKit). It depends on the workspace source tree and is **not** shipped in the public `rax` CLI. To run it, clone the repo and use the root `cortex` script:

```bash
git clone https://github.com/tylerjrbuell/reactive-agents-ts
cd reactive-agents-ts
bun install
bun cortex
# API on http://localhost:4321 — UI on http://localhost:5173
```

Then in another terminal (npm-installed CLI works fine for this side):

```bash
rax run "Research topic" --cortex --provider anthropic
```
```

**Recommended:**
```markdown
### Cortex

Cortex is the companion studio (Bun + Elysia + SvelteKit). It is available as a public npm package and can be launched alongside any agent run.

**From npm (recommended):**

```bash
bun add @reactive-agents/cortex
rax cortex
# API + UI on http://127.0.0.1:4321 (opens in browser automatically)
```

Then in another terminal:

```bash
rax run "Research topic" --cortex --provider anthropic
```

**From source repo (contributors):**

```bash
git clone https://github.com/tylerjrbuell/reactive-agents-ts
cd reactive-agents-ts
bun install
bun cortex
# API on http://localhost:4321 — UI on http://localhost:5173 (Vite dev mode)
```
```

#### Edit 3: Remove or reword contradictory note in `apps/docs/src/content/docs/features/cortex.md` line 250
**Current:**
```markdown
> **Note:** Cortex is a contributor tool, not a public CLI command. Launch it from a repo clone via `bun cortex` (or `cd apps/cortex && bun start`). The `rax run --cortex` flag still works in the published CLI — it streams events to whatever Cortex instance you have running locally.
```

**Recommended:**
```markdown
> **Note:** When running `rax cortex` (npm), Cortex opens your browser at `http://127.0.0.1:4321` automatically. From source-repo `bun cortex`, the Vite dev UI opens at `http://localhost:5173` (hot-reload), with the API on `:4321`. Both modes stream events via the `--cortex` flag in `rax run` or `.withCortex()` in code.
```
(Already present at line 68; line 250 note is redundant and contradictory.)

#### Edit 4: Add missing environment variables to `apps/docs/src/content/docs/reference/cli.md` lines 111-115
**After line 114 (`CORTEX_URL`), add:**
```markdown
| `CORTEX_LOG` | Server log verbosity: `error` \| `warn` \| `info` \| `debug` (default `info`) |
| `CORTEX_SKILL_SCAN_ROOT` | Extra root path to scan for `SKILL.md` files in Lab/Skills |
```

---

## Verification Checklist

- ✅ Cortex is published to npm as `@reactive-agents/cortex` (v0.10.2)
- ✅ Cortex package has `"publishConfig": { "access": "public" }`
- ✅ CLI implements lazy-load pattern with optional peer dep
- ✅ Feature guide correctly describes npm + source paths
- ❌ CLI reference contradicts feature guide (NEEDS FIX)
- ✅ All environment variables documented in feature guide
- ❌ CLI reference missing 2 environment variables (NEEDS FIX)

---

## Post-Audit Status

**Recommendation:** Update `cli.md` (lines 85-115, 93-103) to match feature guide accuracy and reflect the new public npm package availability. Remove or reword contradictory note in features/cortex.md line 250.

**Estimated effort:** 15 minutes (4 targeted edits)  
**Impact:** Eliminates user confusion; accelerates npm adoption of cortex package
