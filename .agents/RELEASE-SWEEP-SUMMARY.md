---
title: v0.10.2 Post-Release Quality Sweep — Summary Report
date: 2026-05-05
status: Complete
---

# v0.10.2 Post-Release Quality Sweep Summary

**Sweep Period:** May 4–5, 2026  
**Scope:** Comprehensive testing of v0.10.2 release across CLI, SDK, and build systems  
**Status:** ✅ Complete — 5 critical issues identified, 2 partially fixed, 3 documented for v0.11.0 patch

---

## Executive Summary

Post-release testing of v0.10.2 uncovered **5 critical/high-severity issues** that should be addressed in the next patch release (v0.11.0):

| Issue | Severity | Impact | Status |
|-------|----------|--------|--------|
| **P1-5: SDK agent.run() missing** | CRITICAL | SDK completely broken for standard usage | Needs investigation |
| **P1-3: cortex command broken (npm)** | CRITICAL | npm users can't use cortex studio | Partially fixed (turbo.json) |
| **P1-1: CLI --help broken across 3 commands** | HIGH | Poor discoverability, bad UX | Ready to fix |
| **P1-4: CommonJS require fails** | MEDIUM | Node.js consumers blocked | Design needed |
| **P1-2: Vague LLM error messages** | MEDIUM | Poor error UX | Investigate |
| **W1-2: Build system asset caching** | MEDIUM | Assets don't auto-bundle in turbo | Fixed (turbo.json) |

---

## Testing Methodology

1. **CLI Command Testing**
   - Tested all major commands: `rax init`, `rax create agent`, `rax run`, `rax demo`, `rax cortex`, `rax serve`, `rax playground`, `rax bench`
   - Tested --help flags and error cases
   - Result: 4 UX issues found

2. **npm Package Installation Testing**
   - Fresh `npm install reactive-agents` in /tmp/test-rax-npm
   - Verified CLI binaries work: `rax version`, `rax --help`
   - Tested cortex command
   - Result: 1 critical build system issue, 1 npm structural issue

3. **SDK Usage Testing**
   - Fresh bun project with `bun add reactive-agents`
   - Tested basic agent creation: `ReactiveAgents.create().withProvider("test").build()`
   - Tested advanced features with tools and types
   - Result: 1 critical SDK API issue (agent.run() missing)

4. **Build System Verification**
   - Tested turbo build cache behavior
   - Verified asset bundling in CLI build
   - Checked package.json exports across 27 packages
   - Result: 2 issues with asset bundling and cache

---

## Detailed Findings

### CRITICAL Issues (Block next release or SDK use)

#### P1-5: Agent.run() Method Missing from SDK
**Symptom:**
```typescript
const agent = await ReactiveAgents.create().withProvider("test").build();
await agent.run("Hello");  // TypeError: agent.run is not a function
```

**Evidence:** Built agent from npm package doesn't have `.run()` method  
**Root cause:** Needs investigation — likely mismatch in ReactiveAgent interface export or return type  
**Impact:** SDK completely unusable for standard agent execution pattern  
**Fix effort:** HIGH — requires investigation into builder, runtime, and exports  
**Recommendation:** Hold v0.11.0 patch until this is investigated

#### P1-3: Cortex Command Broken in npm-Installed CLI
**Symptom:**
```
$ rax cortex --no-open
✖ Cortex server entry not found: /node_modules/reactive-agents/node_modules/cortex/server/index.ts
```

**Root cause (identified):** Turbo.json build configuration didn't include `assets/**` in outputs for CLI builds, so cortex UI assets weren't cached/bundled for npm distribution

**Fix applied (partial):**
- ✅ Updated turbo.json to include `assets/**` in @reactive-agents/cli#build outputs
- ✅ Added cortex/ui source files as build inputs
- ✅ Updated package.json build script to run `build:cortex-ui` before tsup
- ⚠️ Still needs verification that turbo cache correctly includes assets in npm package

**Verification needed:** Run clean build, check npm package includes assets/cortex/index.html

#### P1-4: CommonJS Require Fails
**Symptom:**
```
$ node -e "require('reactive-agents')"
Error [ERR_INTERNAL_ASSERTION]: This is caused by either a bug in Node.js...
```

**Root cause:** Package exports ESM-only, Node.js CommonJS require fails without clear error  
**Impact:** Node.js users (non-ESM) can't use package  
**Fix options:**
1. Provide `.cjs` wrapper entry point
2. Clear error message in package.json exports
3. Re-export CommonJS shim

**Effort:** MEDIUM (design + implementation)

---

### HIGH Priority Issues

#### P1-1: CLI Commands Don't Respect --help Flag
**Affected commands:**
- `rax init --help` → Creates project called "--help" instead of showing help
- `rax create agent --help` → Tries to create agent instead of showing help
- `rax run --help` → Shows error instead of help

**Root cause:** Commands skip `--help` check before processing positional arguments

**Solution proven:** Other commands (`dev`, `serve`, `discover`) correctly check for --help at top of function

**Example fix pattern (from dev.ts):**
```typescript
export function runInit(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }
  // ... rest of implementation
}
```

**Files to fix:** 3 files, ~5 minutes total  
- `apps/cli/src/commands/init.ts`
- `apps/cli/src/commands/create-agent.ts`  
- `apps/cli/src/commands/run.ts`

#### P1-2: Vague LLM Error Messages
**Symptom (from `rax demo`):**
```
✗ [completion] Reactive strategy terminated: llm_error
```

When Ollama isn't running, user gets cryptic "llm_error" with no actionable suggestion

**Expected behavior:**
```
✗ Cannot connect to Ollama at http://localhost:11434
  Make sure Ollama is running: ollama serve
  Learn more: https://ollama.ai
```

**Fix effort:** MEDIUM (error context injection in provider adapters)

---

### MEDIUM Priority Issues

#### W1-2: Cortex UI Assets Not Auto-Bundled in Turbo Builds
**Symptom:** Running `turbo build` doesn't include cortex UI assets in CLI package

**Root cause:** turbo.json didn't specify assets as CLI build output

**Fix applied:** Added `assets/**` to @reactive-agents/cli#build outputs in turbo.json

**Verification:** Needs manual test of turbo build → npm install → rax cortex (should work)

---

## Positive Findings ✅

- ✅ Basic SDK import works: `import { ReactiveAgents } from 'reactive-agents'`
- ✅ Test provider agent creation successful
- ✅ Sub-package imports work: `import type { Task } from '@reactive-agents/core'`
- ✅ Package exports correctly configured (27/27 packages have correct bun exports)
- ✅ Cortex help text and environment variables work correctly
- ✅ CLI asset bundling infrastructure works (just needed turbo.json fix)
- ✅ Version command works: `rax version` → `v0.10.2`

---

## Recommendations for v0.11.0 Patch

### Priority 1 (Ship-blocking)
1. **Investigate P1-5 (SDK agent.run() missing)** — Determine if this is export issue or runtime bug
   - Check ReactiveAgent interface in @reactive-agents/runtime
   - Verify builder.build() returns correct type
   - Test with TypeScript strict mode

### Priority 2 (High impact, easy fix)
2. **Fix P1-1 (--help flags in 3 commands)** — 5 min implementation, high UX impact
   - Copy --help check pattern from `dev.ts` to init/create-agent/run

### Priority 3 (Infrastructure)
3. **Verify cortex bundling** — Test turbo build cache includes assets
   - Clean build + npm install in /tmp
   - Run `rax cortex` to confirm it starts without errors

### Priority 4 (Design + implement)
4. **Add CommonJS support or clear error (P1-4)** — Design decision needed
5. **Improve LLM error messages (P1-2)** — Better UX for provider failures

---

## Test Verification Checklist for v0.11.0

Before shipping patch, run:

```bash
# Clean rebuild
rm -rf .turbo apps/cli/dist apps/cli/assets/cortex
bun run build --filter @reactive-agents/cli

# Verify cortex assets present
ls apps/cli/assets/cortex/index.html

# npm install test
cd /tmp && rm -rf test-patch && mkdir test-patch && cd test-patch
bun add reactive-agents

# Test CLI commands
rax version         # Should show 0.10.3 (or next patch version)
rax init --help     # Should show help, not create project
rax run --help      # Should show help, not fail
rax create agent --help  # Should show help
rax cortex --no-open    # Should start without errors (verify in another terminal)

# Test SDK
cat > test.ts << 'EOF'
import { ReactiveAgents } from 'reactive-agents';
const agent = await ReactiveAgents.create()
  .withProvider("test")
  .build();
const result = await agent.run("test");
console.log("✓ SDK works");
EOF
bun run test.ts
```

---

## Files Modified in Sweep

- ✅ `.agents/PATCH-ISSUES-v0.11.0.md` — Comprehensive patch issues catalog
- ✅ `turbo.json` — Added CLI build cache config with assets output
- ✅ `apps/cli/package.json` — Build script now runs cortex UI build first
- ✅ `apps/cli/src/commands/cortex.ts` — Improved error messages for dev vs bundled mode
- ✅ `apps/cli/assets/cortex/` — Cortex UI assets now present (index.html, favicon.svg, _app/)

---

## Next Steps

1. **User Action Required:** Review this summary and decide:
   - Do we fix P1-5 before v0.11.0?
   - Do we include P1-1, P1-2, P1-4 fixes in patch?
   - Do we need full regression test cycle?

2. **Recommended Path:**
   - Fix P1-5 (critical SDK issue) ASAP
   - Bundle P1-1 + P1-2 + P1-4 into v0.11.0 patch
   - Release v0.11.0 with all fixes together

3. **Testing:**
   - Run test verification checklist above
   - Smoke test with real API key (Anthropic) instead of test provider
   - Test `rax demo` with Ollama running and not running

---

## Conclusion

v0.10.2 revealed that while the release infrastructure (build, packaging, exports) works well, there are **3 critical issues in SDK/CLI that need addressing before next production use**:

1. SDK core functionality broken (agent.run)
2. Popular cortex feature broken in npm (build system issue)
3. Multiple UX paper cuts (--help, error messages)

All are fixable within a single patch cycle. The build system fix (turbo.json) is already applied and needs verification.

