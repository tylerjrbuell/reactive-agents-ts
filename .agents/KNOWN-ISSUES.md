# Known Issues & Limitations

## Current Issues

### KI-1: `rax cortex` command broken in npm-installed CLI (v0.10.2)

**Severity:** Medium (impacts studio feature, workaround available)  
**Affected versions:** 0.10.2+  
**Status:** Documented, fix in progress

**Symptoms:**
```
$ rax cortex
✖ Cortex server entry not found:
  /home/user/node_modules/reactive-agents/node_modules/cortex/server/index.ts
```

**Root cause:** 
- CLI uses `__dirname`-relative path to load `apps/cortex/server/index.ts`
- When bundled and installed via npm, `apps/cortex` source code isn't available
- Static UI assets aren't bundled into the CLI npm package

**Current workaround:**
```bash
# Run cortex from source instead
cd <repo>/apps/cortex
bun start  # Starts UI on port 5173, API on 4321
```

**Permanent fix (in progress):**
1. Include cortex's built static UI in CLI npm package (bundled static mode)
2. Modify cortex command to gracefully fall back if source isn't available
3. Document that `--dev` mode only works from source repository

**Affected commands:**
- `rax cortex` (without --dev) — fails because static assets not bundled
- `rax cortex --dev` — fails because server source not available in npm package

**Unaffected commands:**
- `rax run` — works (doesn't depend on cortex app)
- `rax playground` — works
- `rax serve` — works
- `rax demo` — works

---

## Resolved Issues (Reference)

### KI-0: Bun module export paths (v0.10.0-0.10.1) — FIXED in v0.10.2

**Issue:** All 27 packages exported `"bun": "./src/index.ts"` but npm packages don't include src/  
**Fix:** Changed to `"bun": "./dist/index.js"`  
**Validation:** All npm-installed packages now resolve correctly
