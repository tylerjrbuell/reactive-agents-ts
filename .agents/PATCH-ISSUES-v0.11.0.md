---
title: Patch Issues — v0.10.2 Release Sweep
status: In Progress
date: 2026-05-04
---

# v0.11.0 Patch Issues (discovered in v0.10.2)

## Critical Issues (UX-blocking)

### Issue P1-3: `rax cortex` STILL broken in npm-installed CLI
**Severity:** CRITICAL (command completely broken for npm users)  
**Command:** `rax cortex` from npm-installed package

**Problem:**
- Running `rax cortex` after `npm install reactive-agents` fails
- Error: `Cortex server entry not found: /node_modules/reactive-agents/node_modules/cortex/server/index.ts`
- This indicates cortex/server source tree path is being checked even though we should be using bundled static UI

**Expected behavior:** 
- Should load bundled static UI from `node_modules/reactive-agents/assets/cortex/index.html`
- Should NOT try to load source files from node_modules

**Root cause:** 
- The cortex command fix we applied only worked in repo mode
- npm-installed package doesn't have cortex source tree, only bundled assets
- Need to check if static assets exist FIRST, before checking for dev server

**Affected file:** `apps/cli/src/commands/cortex.ts` line 187-189

**Current logic (wrong):**
```typescript
const staticPath = path.resolve(__dirname, "../../assets/cortex");
const hasStatic = existsSync(path.join(staticPath, "index.html"));
const hasServerSource = existsSync(serverEntry);  // ← checks first, tries to run dev mode
```

**Expected logic:**
Check for static assets first in npm-installed case. When running from npm, serverEntry will NOT exist, so skip the dev check entirely.

**Effort:** MEDIUM (need to verify path resolution in npm context)

---

### Issue P1-1: CLI commands don't respect `--help` flag
**Severity:** HIGH (UX regression — common user expectation broken)  
**Files affected:** 
- `apps/cli/src/commands/init.ts`
- `apps/cli/src/commands/create-agent.ts`  
- `apps/cli/src/commands/run.ts`

**Problem:**
- `rax init --help` creates a project called "--help" instead of showing help
- `rax create agent --help` tries to create an agent instead of showing help
- `rax run --help` doesn't show help text (command uses print-on-error pattern instead)

**Root cause:** Commands don't check for `--help` / `-h` before processing positional args

**Solution:** Add help check at top of each command function:
```typescript
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  return;
}
```

**Expected behavior:**
- All commands should respond to `--help` consistently (other commands like `dev`, `serve`, `discover` already do)

**Effort:** LOW (5 min fix across 3 files)

---

### Issue P1-2: CommonJS require of `reactive-agents` fails
**Severity:** MEDIUM (breaks Node.js consumers)  
**Problem:**
```
cd /tmp/test-npm && node -e "require('reactive-agents')"
→ Error [ERR_INTERNAL_ASSERTION]: This is caused by either a bug in Node.js or incorrect usage of Node.js internals.
```

**Root cause:** 
- Package exports ES modules but doesn't handle CommonJS fallback
- Entry point is `dist/index.js` (ESM-only)
- Node.js CommonJS require fails with assertion error instead of clear error

**Expected behavior:**
- Either provide `.cjs` entry point for CommonJS users
- OR clear error message: "reactive-agents requires ESM. Use `import` or set `"type": "module"` in package.json"
- OR re-export CommonJS shim

**Effort:** MEDIUM (needs package.json exports tweak or wrapper)

---

### Issue P1-4: Vague error message for Ollama connection failure
**Severity:** MEDIUM (user can't diagnose problem)  
**Command:** `rax demo`

**Problem:**
- When Ollama isn't running: `llm_error` with no explanation
- User gets: `✗ [completion] Reactive strategy terminated: llm_error`
- No indication what went wrong or how to fix it

**Expected behavior:** Clear error message like:
```
✗ Cannot connect to Ollama at http://localhost:11434
  Make sure Ollama is running: ollama serve
  Learn more: https://ollama.ai
```

**Root cause:** LLM provider connection errors not surfaced with actionable context

**Effort:** MEDIUM (error handler needs context injection)

---

## Warnings (non-blocking, good-to-fix)

### Issue W1-1: Help text for `rax run` shows error code exit
**Severity:** LOW  
**Problem:**
```
✖ Usage: rax run <prompt> [options]
```
The `✖` prefix indicates error exit, but this is `--help` output (should be clean)

**Root cause:** `run.ts` doesn't handle `--help` flag; when user types `rax run --help`, it fails validation (no prompt given)

**Effort:** LOW (same fix as P1-1)

---

### Issue W1-2: Cortex UI assets not included in CLI build output (turbo cache issue)
**Severity:** MEDIUM (breaks npm-installed CLI completely)  
**Problem:**
- When running `turbo build`, cortex UI assets are not copied to `apps/cli/assets/cortex/`
- Manual `bun run build:cortex-ui` works correctly
- Result: npm-installed CLI has empty assets directory, `rax cortex` fails
- Root cause: `turbo.json` specifies `"outputs": ["dist/**"]` but assets go to `assets/`

**File:** `turbo.json` line 21

**Fix required:**
```json
"@reactive-agents/cli#build": {
  "outputs": ["dist/**", "assets/**"]  // Add assets to outputs
}
```

OR create explicit turbo task for cortex UI build:
```json
"@reactive-agents/cli#build:cortex-ui": {
  "inputs": ["../cortex/ui/src/**", "../cortex/ui/svelte.config.js"],
  "outputs": ["assets/cortex/**"]
}
```

**Effort:** LOW (one-line fix in turbo.json)

---

## Resolved (v0.10.2)

✅ **Cortex command broken in npm-installed CLI** — Fixed by bundling UI in CLI build  
✅ **Bun export paths broken across all 27 packages** — Fixed by updating exports to ./dist/index.js  
✅ **CLI external dependencies not marked** — Fixed by adding to tsup.config.ts  
✅ **TypeScript deprecation warnings** — Fixed by ignoreDeprecations in tsconfig.json

---

### Issue P1-5: Agent.run() method missing or wrong return type
**Severity:** CRITICAL (SDK completely broken for most use cases)  
**Problem:**
```typescript
const agent = ReactiveAgents.create().withProvider("test").build();
const result = await agent.run("Say hello");  // ← TypeError: agent.run is not a function
```

**Expected behavior:** Built agent should have `.run(prompt)` method that returns `Promise<AgentResult>`

**Root cause:** Build return type mismatch or async builder not awaiting properly

**Finding:** `.build()` returns a Promise, but the issue is that agent.run() doesn't exist on the returned object

**Effort:** HIGH (needs investigation into builder pattern and return types)

---

## Patch Effort Summary

| ID | Severity | Effort | Category | Status |
|----|----------|--------|----------|--------|
| P1-1 | HIGH | LOW | CLI UX | Ready to fix |
| P1-2 | MEDIUM | MEDIUM | LLM errors | Investigate |
| P1-3 | CRITICAL | MEDIUM | CLI cortex | Turbo config fix applied |
| P1-4 | MEDIUM | MEDIUM | SDK CommonJS | Design needed |
| P1-5 | CRITICAL | HIGH | SDK core | Blocking (investigate first) |
| W1-1 | LOW | LOW | CLI UX | Ready to fix |
| W1-2 | MEDIUM | LOW | Build system | Turbo config fix applied |

**Total effort for v0.11.0 patch:** ~3–4 hours  
**Recommended focus:** 
1. **P1-5 (SDK .run() missing)** — BLOCKING, investigate immediately
2. **P1-1 (--help flags)** — HIGH impact, easy fix
3. **P1-3 (cortex turbo)** — Turbo config fix applied, needs testing

---

## Critical Findings Summary

**Pre-release testing revealed 5 serious issues affecting v0.10.2 stability:**

1. **SDK Core Broken** (P1-5): `agent.run()` method missing — blocks all SDK users
2. **CLI Cortex Broken** (P1-3): npm-installed `rax cortex` fails due to turbo cache (partially fixed with turbo.json change)
3. **CLI UX Broken** (P1-1): All commands ignore `--help` flag — poor discoverability
4. **Build System Broken** (W1-2): Cortex UI assets not auto-copied in turbo builds
5. **Ecosystem Broken** (P1-2, P1-4): CommonJS require fails; LLM errors vague

**Recommendation:** Do NOT release v0.10.3 until P1-5 (SDK core) is investigated and fixed.

---

## Testing Checklist for Patch Release

- [ ] `rax init --help` shows help (doesn't create project)
- [ ] `rax create agent --help` shows help  
- [ ] `rax run --help` shows help without error prefix
- [ ] `rax demo` with Ollama offline gives clear error + fix suggestion
- [ ] All other `--help` invocations work consistently
- [ ] Cortex asset bundling verified in turbo build
- [ ] No regressions in command execution

---

## Notes

- Help text already defined in most commands (HELP constant)
- Pattern is already proven in `dev.ts`, `serve.ts`, `discover.ts` — just copy pattern to other commands
- User explicitly requested this type of UX issue discovery: "continue looking for issues after release like this"

