# Trustworthy Docs Benchmark Refresh — Implementation Plan

> **For agentic workers:** execute task-by-task. The paid frontier run (Task 5) is COST-GATED — do not run it without explicit user go-ahead.

> **PIVOT (2026-06-28, after benchmark-practice research):** LLM-as-judge is documented-unreliable for headline scoring (12 bias types, run-to-run inconsistency, "reliability without validity"). Leading agent benchmarks (SWE-bench, τ-bench, WebArena, Terminal-Bench) score by **deterministic end-state / execution / tool-trace verification**. So the public bench is **DETERMINISTIC-ONLY** in v1 — no LLM judge in the trust number (reproducible, ~free, no judge-bias caveat). Judge dropped. See research note `wiki/Research/2026-06-28-agent-benchmark-scoring-practices.md`.

**Goal:** Replace the stale, regex-scored, single-run docs benchmark with a trustworthy v2 `SessionReport` scored by **deterministic oracles** (execution + working-dir end-state + tool-call trace), across one model per tier (local→frontier), multi-run variance, reproducibility receipt, and bare-LLM-vs-RA-full ablation ("what the harness buys").

**Architecture:** The v2 eval infra already exists (`runSession` → `SessionReport` with `ablation[]` + `taskReports[]` + `reproducibility`; `judge-server` live layer; Rule-4 preflight). The docs `BenchmarkResults.astro` already renders the ablation sections but reads its top half (matrix/summaries/drilldown/overhead) from `runs[]`, which a `SessionReport` leaves empty — and it does not render `reproducibility` at all. So: add a session config, teach the component to render a SessionReport as the primary view + a Receipt panel, rewrite the methodology page, then generate + commit real data.

**Tech stack:** Bun, Effect-TS, Astro/Starlight, `@reactive-agents/benchmarks`, `@reactive-agents/judge-server`.

## Decisions (locked with user 2026-06-28)
- **SUT matrix (one per tier first):** `gemma4:12b` (local, ollama) · `gemini-2.5-flash` · `gpt-4o-mini` · `claude-haiku-4-5`. More runs/models later.
- **Judge:** cloud frontier, must differ from every SUT model string → **`claude-opus-4-8`** (Rule-4 clean vs haiku/flash/4o-mini/gemma).
- **Scope:** ablation only — `bare-llm` vs `ra-reasoning` vs `ra-full`. No competitor frameworks (not installed).

## Global Constraints
- Strict TS, no `any` (use `unknown` + guards). Caveman-mode does not apply to code/commits.
- No `Co-Authored-By` trailers.
- RTK-prefix CLI.
- Judge model SHA returned by `/version` MUST NOT equal any SUT `model` string (Rule-4 preflight throws otherwise).
- Component must degrade gracefully on BOTH report shapes (legacy `MultiModelReport` and v2 `SessionReport`) — never blank.

---

### Task 1 — `docs-receipts` session config
**Files:** Create `packages/benchmarks/src/sessions/docs-receipts.ts`; Modify `packages/benchmarks/src/run.ts` (import + SESSIONS map).
- Models: the 4 above (contextTier local/standard). Variants: `getVariant("bare-llm")`, `getVariant("ra-reasoning")`, `getVariant("ra-full")` (internal only — competitors excluded).
- `tiers: ["real-world"]` (11 tasks incl `rw-bp1` blueprint). `runs: 3` (variance). `concurrency: 1`, `timeoutMs: 300_000`.
- Register as `"docs-receipts"` in `SESSIONS`.
- Verify: `bun run --cwd packages/benchmarks bench --session docs-receipts --help`-equiv lists it; a `--provider test --runs 1` smoke run emits a SessionReport without throwing.

### Task 2 — Component renders SessionReport as primary + Receipt panel
**Files:** Modify `apps/docs/src/components/BenchmarkResults.astro`.
1. Add `reproducibility` + `taskReports` + `partialMeasurement` to the `SessionReport` type in the component.
2. When `hasSession` and `runs` is empty, **derive the top-of-page views from `ablation`/`taskReports`**: model list from `modelVariantId`; per-tier matrix + per-model summary from `ra-full` `passRate`/`meanTokens`/`meanDurationMs`; task drilldown from `taskReports` (ra-full). Keep the legacy `runs[]` path as fallback.
3. Add a **Receipt panel** (top, prominent): `gitSha`, `judgeModelSha`, `runId`, `reproducibility.replayCommand` (copyable), runs-per-cell, generatedAt. This is the headline trust signal.
4. Show variance/reliability already present in ablation table; ensure "N runs" is labeled (not hardcoded "3 runs" — read it).
- Verify: `bun run --cwd apps/docs build` green; render against the Task-1 smoke fixture shows non-blank matrix + receipt.

### Task 3 — Methodology page rewrite
**Files:** Modify `apps/docs/src/content/docs/features/benchmarks.mdx`.
- **Delete** the "passes if output contains the expected pattern (case-insensitive regex)" section — the trust-killer.
- Document the real scoring: deterministic-verifiable tasks (`node check.mjs`) + dimensional LLM-judge with a **separate frontier judge** (Rule 4, judge ≠ SUT), `runs=3` variance, and the reproducibility receipt.
- Explain the **ablation** (bare-LLM → RA-reasoning → RA-full = what each layer buys).
- Replace "Running Benchmarks"/"Updating displayed results" with the session + judge-server commands (Task 5). Refresh provider-default table (drop retired models).
- Verify: docs build green; no remaining "regex"/"contains the expected pattern" trust claims.

### Task 4 — Smoke fixture for component dev (free)
Run `bench --session docs-receipts --provider test --runs 1 --output apps/docs/src/data/benchmark-report.json` (or a scratch path) to produce a real-shaped SessionReport for Task 2 rendering. Do NOT commit the test-provider data as the published result.

### Task 5 — Generate + commit real data ⚠️ COST-GATED
**Requires explicit user go-ahead — spends frontier API + ~30–90 min.**
1. Start judge-server: `JUDGE_LAYER=live JUDGE_PROVIDER=anthropic JUDGE_MODEL=claude-opus-4-8 JUDGE_MODEL_SHA=claude-opus-4-8 JUDGE_CODE_SHA=$(git rev-parse --short HEAD) PORT=8910 bun run --cwd packages/judge-server src/index.ts`
2. Confirm `curl localhost:8910/version` → `{judgeModelSha:"claude-opus-4-8", ...}`.
3. Run: `bun run --cwd packages/benchmarks bench --session docs-receipts --judge-url http://localhost:8910 --output apps/docs/src/data/benchmark-report.json`
4. Verify: Rule-4 passes (judge ≠ SUT), no retired models, ablation + reproducibility populated, docs build renders it.
5. Commit `benchmark-report.json` + code + docs.

**Cost note:** SUT = gemma local (free) + flash + 4o-mini + haiku (cheap). Judge = opus-4-8 on ~7 llm-judge tasks × 4 models × 3 variants × 3 runs ≈ up to ~250 judge calls — the dominant spend. Tunable via `--runs` / `--task`.

## Risks
- `rw-1` (web-search) + `rw-4` (jsonplaceholder API) hit live network → may flake; `rw-9` is self-contained flaky-by-design. If `rw-1`/`rw-4` are unreliable, slice them out via `--task` for the published run and note coverage.
- Local `gemma4:12b` on tool-using real-world tasks may score low — that is honest signal, not a bug.
