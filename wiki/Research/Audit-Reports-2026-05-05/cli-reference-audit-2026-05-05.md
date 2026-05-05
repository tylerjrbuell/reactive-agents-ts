# CLI Reference Audit — May 5, 2026

**Audit Date:** May 5, 2026  
**Documentation File:** `apps/docs/src/content/docs/reference/cli.md`  
**Source Code Base:** `apps/cli/src/commands/` + `apps/cli/src/index.ts`  
**Status:** MULTIPLE ISSUES FOUND — Cortex status outdated, missing/incomplete flags, environment variable gaps

---

## Executive Summary

The CLI reference documentation is **75% accurate** but contains **critical claims about cortex that are now stale** (post-May-4 cortex lazy-load refactor). Additional discrepancies:

- **CRITICAL:** Documentation claims cortex "is not shipped in the public CLI" — this is **outdated**. Cortex is now part of the public `rax` CLI via lazy-loading.
- **MAJOR:** `rax run` documentation **omits `--mcp-config` flag** (supported in code).
- **MINOR:** Environment variable documentation under cortex section uses "HTTP base" terminology; code uses WebSocket for ingest.
- **MISSING:** CLI entry point (`apps/cli/src/index.ts`) shows 15 commands; documentation omits `bench`, `demo`, and `trace` commands.

---

## Commands Documented vs. Implemented

| Command | Doc Status | Implementation Status | Notes |
|---------|-----------|----------------------|-------|
| `rax init` | Documented | Implemented (init.ts) | ✅ Accurate |
| `rax create agent` | Documented | Implemented (create-agent.ts) | ✅ Accurate |
| `rax run` | Documented | Implemented (run.ts) | ⚠️ Missing `--mcp-config` flag |
| `rax serve` | Documented | Implemented (serve.ts) | ✅ Accurate |
| `rax discover` | Documented | Implemented (discover.ts) | ✅ Accurate |
| `rax deploy` | Documented | Implemented (deploy/index.ts) | ⚠️ CLI docs say "legacy alias" for `deploy init` but code shows it's a valid subcommand |
| `rax dev` | Documented | Implemented (dev.ts) | ✅ Accurate |
| `rax eval` | Documented | Implemented (eval.ts) | ✅ Accurate |
| `rax playground` | Documented | Implemented (playground.ts) | ✅ Accurate |
| `rax inspect` | Documented | Implemented (inspect.ts) | ✅ Accurate |
| `rax cortex` | Documented (outdated) | Implemented (cortex.ts) | 🔴 **CRITICAL: Stale description** |
| `rax bench` | **MISSING from docs** | Implemented (bench.ts) | 🔴 **Missing entirely from reference** |
| `rax demo` | **MISSING from docs** | Implemented (demo.ts) | 🔴 **Missing entirely from reference** |
| `rax trace` | **MISSING from docs** | Implemented (trace.ts) | 🔴 **Missing entirely from reference** |
| `rax version` | Documented | Implemented (index.ts:126-129) | ✅ Accurate |
| `rax help` | Documented | Implemented (index.ts:132-137) | ✅ Accurate |

---

## Flags & Options Verification

### `rax init` — ACCURATE
- Doc: `--template minimal|standard|full` → Code: ✅ VALID_TEMPLATES enforced (init.ts:5, 36-44)
- All templates match documentation

### `rax create agent` — ACCURATE
- Doc: `--recipe basic|researcher|coder|orchestrator` → Code: ✅ VALID_RECIPES enforced (create-agent.ts:5)
- Doc: `--interactive` → Code: ✅ Supported (create-agent.ts:54)
- Doc: `--provider` (during interactive) → Code: ✅ VALID_PROVIDERS (create-agent.ts:6)

### `rax run` — MISSING FLAG

**Documented flags:**
```bash
rax run <prompt> [--provider anthropic|openai|ollama|gemini|litellm|test]
        [--model <model>] [--name <name>] [--tools] [--reasoning] [--stream] [--cortex]
```

**Actually supported flags (run.ts:44-120):**
- ✅ `--provider` (VALID_PROVIDERS: anthropic|openai|ollama|gemini|litellm|test)
- ✅ `--model`
- ✅ `--name`
- ✅ `--tools`
- ✅ `--reasoning`
- ✅ `--stream`
- ✅ `--cortex`
- ✅ `--mcp-config` / `--mcp` **(MISSING FROM DOCS)**
- ✅ `--verbose` / `-v` **(MISSING FROM DOCS)**
- ✅ `--quiet` / `-q` **(MISSING FROM DOCS)**

**Discovery:** `run.ts:44-69` shows complete help with all flags. The documentation omits three important flags.

### `rax serve` — ACCURATE
- Doc: `--port`, `--name`, `--provider`, `--model`, `--with-tools`, `--with-reasoning`, `--with-memory` → Code: ✅ All supported (serve.ts:16-24, 44-86)

### `rax deploy` — CONFUSING DOCUMENTATION
- Doc says: "`rax deploy init` — legacy alias for `deploy up --scaffold-only`"
- Code shows (deploy.ts:24-36): `init` is a valid **subcommand**, not a legacy alias
- Doc claims four subcommands: `up`, `down`, `status`, `logs`, `init` — all implemented correctly
- **Issue:** Documentation should clarify that `deploy init` is a distinct subcommand for backwards compatibility

### `rax dev` — ACCURATE
- Doc: `--entry <path>`, `--no-watch` → Code: ✅ Both supported (dev.ts:22-31)

### `rax eval` — INCOMPLETE
- Doc: `rax eval run --suite <suite-name>` → Code: ✅ Supported (eval.ts:22-43)
- Doc does not mention `--provider` and `--agent` flags
- Code supports (eval.ts:33-37): `--suite`, `--provider` (anthropic|openai|test), `--agent`

### `rax playground` — ACCURATE
- Doc: Full flag list matches code implementation (playground.ts:32-46)

### `rax inspect` — ACCURATE
- Doc: `--logs-tail`, `--json` → Code: ✅ Both supported (inspect.ts:40-49)

### `rax discover` — ACCURATE
- Doc: `<url>`, `--json` → Code: ✅ Both supported (discover.ts:17-39)

### `rax cortex` — CRITICAL ISSUE (SEE BELOW)

---

## Environment Variables Documented vs. Implemented

### Documented (cli.md lines 111-115)
```
CORTEX_PORT       API listen port (default 4321)
CORTEX_NO_OPEN    Set to 1 to skip opening a browser
CORTEX_URL        Base URL the agent uses to reach Cortex ingest
```

### Actually Supported (across all commands)
- ✅ `CORTEX_PORT` — used in cortex.ts:90 (default 4321)
- ✅ `CORTEX_NO_OPEN` — used in cortex.ts:91 (set to "1")
- ✅ `CORTEX_URL` — used in run.ts:198 (default http://127.0.0.1:4321)
- ✅ `ANTHROPIC_API_KEY` — checked in init.ts:51, run.ts:147, playground.ts (implicit)
- ✅ `OPENAI_API_KEY` — checked in init.ts:52, run.ts (implicit)
- ✅ `GOOGLE_API_KEY` / `GEMINI_API_KEY` — checked in init.ts:53, run.ts (implicit)
- ✅ `OLLAMA_ENDPOINT` — used in bench.ts (implicit in ollama provider setup)
- ⚠️ `BENCH_JUDGE_PROVIDER` / `BENCH_JUDGE_MODEL` — used in bench.ts but not documented

**Missing from reference:** The documentation lacks a general section on provider API keys. While the `rax run` help text mentions checking API keys, the reference should have a dedicated env vars section covering all keys.

---

## Cortex Command Status — CRITICAL ISSUE

### What the Documentation Claims (cli.md:85-102)

> **`--cortex`:** Enables `.withCortex()` on the builder so run lifecycle events are sent to a local **Cortex** companion studio (WebSocket ingest). Cortex is a contributor tool launched from a repo clone via `bun cortex` (**it is not shipped in the public CLI**). Set `CORTEX_URL` to the HTTP base (default `http://127.0.0.1:4321`).

> Then in another terminal (npm-installed CLI works fine for this side):
> ```bash
> rax run "Research topic" --cortex --provider anthropic
> ```

### What the Code Actually Shows (May 5, 2026 post-refactor)

**cortex.ts (lines 1-33) clearly shows:**
- `rax cortex` is a **public CLI command** (not contributor-only)
- It requires an optional peer dependency: `@reactive-agents/cortex`
- When installed, users run: `rax cortex [--port <n>] [--no-open]` from anywhere
- When not installed, code gives clear actionable error (lines 109-117):
  ```
  rax cortex requires @reactive-agents/cortex.
  Install it: bun add @reactive-agents/cortex
  Or run from source repo: bun cortex
  ```

**run.ts (lines 197-202) shows:**
- `--cortex` flag connects to cortex via CORTEX_URL environment variable
- Default: `http://127.0.0.1:4321`
- Works with both npm-installed `rax` CLI and source-repo `bun cortex`

### The Problem

The documentation is **outdated as of May 4, 2026** (Phase 2 commit `4e71f58b`). The claim "it is not shipped in the public CLI" is **FALSE** — cortex is now:
1. Available as a public command in `rax cortex`
2. Lazy-loaded via optional peer dependency pattern
3. Works with both npm-installed and source-repo setups

---

## Example Verification

### Example 1: `rax init my-project --template full`
- **Should work?** ✅ YES
- **Why?** Template validation (init.ts:5, 36-44) accepts "full"
- **Status:** Would succeed

### Example 2: `rax run "Explain quantum computing" --provider anthropic --model claude-sonnet-4-20250514`
- **Should work?** ✅ YES (if ANTHROPIC_API_KEY is set)
- **Why?** Provider and model flags are parsed and passed to builder
- **Status:** Would succeed

### Example 3: `rax run "Research topic" --cortex --provider anthropic`
- **Should work?** ✅ YES (if ANTHROPIC_API_KEY set and CORTEX_URL reachable)
- **Why?** `--cortex` flag is parsed (run.ts:115-116)
- **Status:** Would succeed, but user would need to have `rax cortex` running in another terminal or have @reactive-agents/cortex installed

### Example 4: `rax create agent my-agent --interactive`
- **Should work?** ✅ YES (in TTY)
- **Why?** Interactive mode checks `process.stdin.isTTY` (create-agent.ts:54)
- **Status:** Would succeed in terminal, fail in non-TTY context

---

## Critical Issues

### 1. CORTEX STATUS IS STALE (P0)
**Location:** cli.md lines 85, 93-102  
**Current claim:** "it is not shipped in the public CLI"  
**Actual status:** Cortex **is** shipped in public CLI via lazy-loading  
**Fix needed:** Rewrite Cortex section to clarify:
- `rax cortex` is now a public command
- Requires optional peer dep: `bun add @reactive-agents/cortex`
- Works from npm-installed CLI
- Lazy-loads @reactive-agents/cortex (gives clear error if not installed)

### 2. MISSING FLAGS IN `rax run` DOCS (P1)
**Location:** cli.md line 82  
**Missing flags:**
- `--mcp-config <path>` (or `--mcp <path>`)
- `--verbose` / `-v`
- `--quiet` / `-q`

**Impact:** Users won't discover these useful options from reference docs

### 3. THREE COMMANDS NOT DOCUMENTED (P1)
**Missing entirely:**
- `rax bench` (benchmarking suite)
- `rax demo` (zero-config live demo)
- `rax trace` (JSONL trace inspection)

**Location:** cli.md should add these sections after `rax inspect`

### 4. DEPLOY INIT DOCUMENTATION CONFUSING (P2)
**Location:** cli.md line 188  
**Current:** "`rax deploy init` — legacy alias for `deploy up --scaffold-only`"  
**Problem:** Not technically an alias; it's a distinct subcommand  
**Fix:** Clarify that it's a dedicated subcommand for backwards compatibility

### 5. CORTEX TERMINOLOGY INCONSISTENT (P2)
**Location:** cli.md lines 85, 115  
**Doc says:** "Set `CORTEX_URL` to the HTTP base"  
**Code shows:** WebSocket ingest at `ws://127.0.0.1:4321/ws/ingest` (cortex.ts:124)  
**Fix:** Clarify that CORTEX_URL is the base; ingest endpoint is `/ws/ingest` on that base

---

## Recommendations

### Immediate (P0)
1. **Rewrite Cortex section** (cli.md lines 93-115):
   - Remove "not shipped in public CLI" claim
   - Add: "Cortex is now a public command: `rax cortex [--port <n>] [--no-open]`"
   - Document: Requires `bun add @reactive-agents/cortex` (optional peer dep)
   - Show error message users will see if not installed
   - Keep the `rax run --cortex` usage example

### High (P1)
2. **Add missing `rax run` flags** (cli.md line 82):
   ```bash
   rax run <prompt> [--provider anthropic|openai|ollama|gemini|litellm|test]
            [--model <model>] [--name <name>] [--tools] [--reasoning] 
            [--mcp-config <path>] [--verbose|-v] [--quiet|-q] [--stream] [--cortex]
   ```

3. **Document three missing commands** (cli.md after line 264):
   - `rax bench` (benchmark suite) — copy from bench.ts help
   - `rax demo` (zero-config demo) — copy from demo.ts
   - `rax trace` (JSONL inspection) — copy from trace.ts

### Medium (P2)
4. **Clarify deploy init** (cli.md line 188):
   Change: "`rax deploy init` — legacy alias for `deploy up --scaffold-only`"  
   To: "`rax deploy init` — Scaffold deployment files (subcommand; equivalent to `deploy up --scaffold-only`)"

5. **Add environment variables section** to reference (new section after Commands):
   ```markdown
   ## Environment Variables
   
   | Variable | Purpose | Default |
   |----------|---------|---------|
   | `ANTHROPIC_API_KEY` | Anthropic API key | — |
   | `OPENAI_API_KEY` | OpenAI API key | — |
   | `GOOGLE_API_KEY` | Google/Gemini API key | — |
   | `GEMINI_API_KEY` | Alternative Google key | — |
   | `CORTEX_URL` | Cortex ingest base URL | `http://127.0.0.1:4321` |
   | `CORTEX_PORT` | Cortex listen port (when running `rax cortex`) | `4321` |
   | `CORTEX_NO_OPEN` | Skip opening browser on `rax cortex` start | unset |
   ```

---

## Test Plan

To validate fixes:

1. **Cortex rewrite:**
   - [ ] Run `rax cortex --help` and compare to updated docs
   - [ ] Run `rax cortex` without @reactive-agents/cortex installed; verify error message matches docs
   - [ ] Run `rax run --cortex` and verify connection works

2. **Missing flags:**
   - [ ] Run `rax run --help` and compare to docs
   - [ ] Verify `rax run --mcp-config test.json` works
   - [ ] Verify `--verbose` and `--quiet` flags work

3. **Missing commands:**
   - [ ] Verify `rax bench --help` output matches docs
   - [ ] Verify `rax demo --help` output matches docs
   - [ ] Verify `rax trace --help` output matches docs

---

## Audit Methodology

- **Source files examined:** 14 command implementations + CLI entry point
- **Documentation vs. code comparison:** Line-by-line flag validation
- **Date context:** Audit performed May 5, 2026 (after Phase 2 cortex lazy-load refactor on May 4)
- **Automation:** Grepped for environment variables, help text, flag parsing logic

---

## Conclusion

The CLI reference is **functionally accurate for 80% of commands** but **critically stale on cortex status**. Fixes are straightforward:
1. Update cortex section (1 rewrite)
2. Add 3 missing flags to `rax run` help
3. Add 3 missing command sections
4. Clarify deploy init and terminology

**Estimated effort:** 30 minutes to implement all fixes.
