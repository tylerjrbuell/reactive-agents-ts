# Task 10 Report (Arc 1) — 90-second launch demo + docs + README

(Note: this file previously held the Agentic-UI plan's "Task 10+11 interaction rail" report, superseded here per dispatch — that work shipped long since.)

**Status: DONE**
**Commit: `b60a92a6` — "docs: process-model demo + receipt/fork/replay documentation" (7 files, +445/−1)**

## Deliverables

### 1. Demo script — `apps/examples/src/advanced/process-model-demo.ts`
- Durable + reasoning agent on Ollama `qwen3:4b`, custom `calculator` tool (no builtin of that name exists — registered via `.withTools({ tools: [...] })`, arithmetic-only expression validation, no arbitrary code execution).
- Prompt forces tool use per `.probes-live/t5-inspect-smoke.ts` precedent ("You MUST use the calculator tool for every arithmetic step…").
- Sequence: `runStream()` → `handle.inspect()` sampled on an interval (prints one line per new iteration — 5 samples in the verified run, brief asked for ≥2) → `StreamCompleted.receipt` → `agent.fork(runId, { at: 1 })` → `listRuns()` fork-row lineage → prints the `rax ps` / `rax attach` mirror line.
- Graceful skip (exit 0, `passed: true`): Ollama unreachable (`/api/tags` probe, same pattern as `apps/cli/src/commands/demo.ts:detectOllama`), model not pulled, or offline suite mode (`provider === "test"`).
- Registered as `A26` in `apps/examples/index.ts` with a comment explaining the Ollama pin + offline skip; row added to `apps/examples/src/advanced/README.md`. NOT a CI test — examples-suite registration only, verified `--offline` run skips it as PASS.

### 2. Docs page — `apps/docs/src/content/docs/features/process-model.md`
Sections as briefed:
- **The process model** — RunHandle verbs + `inspect()` shape (undefined pre-first-iteration / non-kernel path, lazy-thunk zero cost), `fork()` with honest scoping (counterfactual restart, live LLM calls post-fork, never "time-travel"), both v1 caveats (paused-run stale checkpoint; `model` override discarded under `.withModelRouting()` — explicitly warned, never combined in any example).
- **The trust receipt** — verdict table straight from `computeTrustReceipt` JSDoc rules with confidences 0.95/0.95/**0.8**/0.6/0.8 (verifier-boosted 0.9 NOT mentioned anywhere — dead wiring per constraints); "substantive" definition footnote; `ok` = executor-level success footnote; Ed25519 signing scoped to provenance ("this receipt, this run, untampered" — never correctness).
- **CLI** — `rax ps [--db|--all]` + `rax attach` with sample output (fork row shows `[FORKED-FROM <src>@1]`, matching `ps.ts` formatting).
- **Exact replay** — `loadRecordedRun` → `run.llmTable` → `makeReplayLLMLayer`; exact-replay-only scoping, loud miss on any prompt/config drift, zero tokens; cross-links Snapshot & Replay for the tool-table `replay()` API.
- Sidebar-registered in `astro.config.mjs` under "Ship to Production" (after Durable HITL), `sidebar.order: 22`.

### 3. README — "Agents are processes" section
Inserted after Streaming (flows from `runStream`). 18 lines, code-first: `inspect()`/pause/resume, `result.receipt` with "not a truth certificate" + provenance-signing lines, `fork` with counterfactual-restart framing, `rax ps`/`attach` + exact-replay one-liner, links to docs page + demo source.

### 4. One-line code fix
`packages/core/src/types/receipt.ts` — `TrustReceipt.toolsUsed` JSDoc now defines "substantive" (kernel META/termination/memory-retrieval tools excluded; points at `isSubstantiveReceiptTool`). No behavior change.

## Verification evidence

**Live demo run** (`timeout 280 bun apps/examples/src/advanced/process-model-demo.ts`, ~40s wall):

```
inspect() #1 — iteration=0 steps=0 messages=1 …
inspect() #3 — iteration=2 steps=6 messages=5 …
inspect() #5 — iteration=4 steps=10 … lastThought="The results of the steps are as follows: 1. **137 * 89**: 1"
Step 2 — run completed. output: "**2378.285714285714**"   runId=2he5bx8bquo6k
Step 3 — result.receipt: verdict=tool-grounded confidence=0.8 method=heuristic
  toolsUsed=[calculator] toolCallStats={"ok":3,"failed":0}
Step 4 — fork output: "**2378.285714285714**"  fork receipt.forkedFrom=2he5bx8bquo6k
Step 5 — fork row runId=2he5bx8bquo6k-fork-acc1 forkedFrom=2he5bx8bquo6k forkedAtIteration=1 status=completed
✓ PASS
```

(2378.285714285714 = ((137×89)+4455)/7 — correct; three real calculator calls, all ok.)

**Docs build**: `cd apps/docs && bun run build` → green, 92 pages, "All internal links are valid."

**Typecheck**: `bunx tsc --noEmit -p apps/examples/tsconfig.json` → zero errors in `process-model-demo.ts` (many PRE-EXISTING errors in other example files — untouched, out of scope).

**Offline suite**: `bun run index.ts --offline --filter advanced` → A26 prints "SKIPPED: offline mode" and counts as PASS. Full offline suite 48/49; sole failure is pre-existing `[RS1] crypto-research-agent` (unrelated).

## Concerns / notes for the coordinator
- **Whole-plan final gate** (brief bottom): `bunx turbo run build`, keyless `bun test`, `scripts/check-termination-paths.sh` were NOT run here — this commit is docs + one JSDoc line + a non-CI example, and the gate reads as a plan-level close-out step. Live smoke (demo E2E) is done.
- The examples runner's numeric filter (`/^\d+$/`) can't select lettered nums (`A26`) individually — pre-existing behavior affecting all A/R/I-numbered examples, not changed.
- Advisor tool was unavailable this session (errored); self-review against the binding honest-claims constraints performed instead — all six verified present in copy.
- `.superpowers/sdd/progress.md` was already modified before this session; left uncommitted (not mine).
