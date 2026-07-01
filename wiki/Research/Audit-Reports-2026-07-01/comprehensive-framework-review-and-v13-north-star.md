---
type: audit-report
status: final
created: 2026-07-01
tags: [architecture, dx, docs, plans-triage, north-star, v0.13]
---

# Comprehensive Framework Review + v0.13 North Star (2026-07-01)

**Method:** 4 parallel read-only audits (architecture health, docs accuracy, simplification/DX, plans triage) + **live hands-on runs** — 5 probe agents built and executed against real providers (claude-haiku-4-5 cloud, qwen3:14b + gemma4:e4b local Ollama) by an agent that had never used the framework before. That "first-touch" perspective is the most valuable data here.

---

## 1. Live-Run Findings (empirical, this session)

### What worked — and is genuinely differentiated

| Probe | Result |
|---|---|
| Minimal hello (haiku) | ✅ build 100ms, run 1.2s, clean `result.output/success/metadata` with cost + tokens surfaced |
| Custom tool + `.withOutputSchema` (haiku) | ✅ correct typed object `{warmest:"Tokyo",coldest:"Oslo",spreadC:17}`, `result.object.spreadC` type-flows, 6.4s / 6,967 tok / 2 LLM calls |
| **Same code on gemma4:e4b (4B local)** | ✅ **identical correct typed object**, 20.1s / 10,951 tok / 4 LLM calls — the cross-tier headline claim held in an unscripted hands-on test |
| Plain hello on qwen3:14b | ✅ 39.5s (thinking tokens), correct |

The cross-tier promise is real. A cold external tester reproduced the README's core claim without help. That is the launch asset.

### What broke — first-10-minutes papercuts (all hit organically)

1. **`defineTool` crashes with `TypeError: undefined is not an object (evaluating 'schema.ast')`** when given intuitive-but-wrong field names (`parameters`/`execute` instead of `input`/`handler`). No input validation, no helpful message. `packages/tools/src/define-tool.ts:133`.
2. **Tool authoring has no sweet spot.** `defineTool()` = typed args but requires an Effect handler; `tool()` = plain async but args are untyped `Record<string, unknown>`. The industry-standard shape (schema + plain async fn + inferred arg types — AI SDK/Mastra style) doesn't exist. The framework's **own example** resorts to `as never`: `apps/examples/src/tools/healing-malformed-tool-call.ts:171` — `.withTools({ tools: [addTool] as never })`.
3. **Tool registration is undiscoverable.** Guessed `.withCustomTools([...])` (doesn't exist); correct form `.withTools({ tools: [...] })` found only by grepping examples.
4. **Local timeout cliff.** `Effect.timeout('120 seconds')` hardcoded in `packages/llm-provider/src/providers/local.ts` (complete + stream). Not threaded from `.withTimeout()`. On a contended GPU (two models swapping — a normal dev-box state), per-call latency hit 57s–2m31s, one call breached 120s, and the whole run died with bare `Local LLM request timed out` — no model name, no elapsed, no "model may be cold-loading / GPU busy" hint. Worse: ollama server logs show requests **completing at 2m31s after the client abandoned at 2m0s** — retry + abandonment burns GPU minutes server-side.
5. **Missing API key doesn't fail fast.** `build-validation.ts` prints a good warning, but `build()` succeeds and the failure arrives later as a raw provider 401/error. Also found: env keys are captured at module-import time while build-validation reads at build time — runtime key deletion produced "API key: (missing)" warning **plus a successful paid API call**, an inconsistent split-brain.
6. **Model typo error surface.** `.withModel('claude-opusss-99')` → raw duplicated 404 JSON printed twice + stack trace into `reactive-agent.ts` internals. (The capability-fallback warning that fires alongside is actually excellent — the error path should match its quality.)

### Overhead observation (feeds v0.13 receipts)

Simple QA = 60 tok (near-zero harness tax). Tool task = ~7k tok cloud / ~11k local. Publish this multiplier yourself before someone else measures it for you — it's the honest-receipts brand.

---

## 2. Architecture Health (audit agent, condensed)

**Grade: B+ — structurally healthy, no launch blockers.**

- ✅ Zero layer violations (reasoning imports clean; middle layers clean). Termination single-owner verified (`kernel/loop/terminate.ts` + CI lint). Phase pipeline coherent, fixed-order.
- ✅ Most AGENTS.md debt-table items verified fixed (reactive-observer `as any` gone, quality-utils banner fixed, patchStrategy confirmed dead — delete-safe).
- ⚠️ Open items (post-launch, not blockers):
  - **Provider adapter duplication** — 5 adapters × ~800 LOC with similar streaming/retry/format logic; a shared base could remove ~200 LOC and centralize quirks.
  - **`direct.ts` vs `reactive.ts`** — same kernel, different entry + ~100 LOC duplicated config mapping; merge to `coreReactive(maxIterations?)` with aliases.
  - **Sub-agent path duplication** (`local-agent-tools.ts` vs `spawn-handlers.ts`, ~60 LOC savable).
  - **Loop-detector precedence**: `checkAllToolsCalled()` (iterate-pass.ts:833) fires before `detectLoop()` (:839) — can mask strategySwitching; needs an intent comment or reorder.
  - 10 files >1,000 LOC; 3 justified (event-bus, runner, think), 7 decomposition candidates (arbitrator.ts 1,343 and iterate-pass.ts 1,028 first).
  - `ProviderName`/`OutputFormat` god-module hub in `runtime/src/types.ts` — move to core or document as intentional.

---

## 3. Documentation Accuracy (audit agent, condensed)

3 critical, 1 high, 2 cosmetic:

| Severity | Finding |
|---|---|
| CRITICAL | `apps/docs/reference/builder-api.md` missing `.withFabricationGuard()` + `.withStallPolicy()` (both shipped, both in CHANGELOG 0.13.0 draft) |
| CRITICAL | `wiki/Hot.md` 15 days stale — still says v0.12 "mid-flight", durable Phase E pending (both shipped) |
| CRITICAL | README missing `.withThinking` / `.withFabricationGuard` / `.withStallPolicy` / `.withModelRouting` |
| HIGH | `.withThinking()` only documented inside ModelParams, not as a method entry |
| COSMETIC | AGENTS.md still marks `@reactive-agents/channels` "not on main yet" (it's merged); CHANGELOG DRAFT marker |
| PASS | Strategy count (7), provider count (6), package math (35+6) all accurate |

---

## 4. Simplification + DX (audit agent + live corroboration)

- **81 public builder methods, 101 private fields** (up from 77). `compose()` is a pure alias of `withHarness()`. Memory/learning has 4 overlapping enable-surfaces (`withMemory`+`withSkillPersistence`, `withLearning`, `withProfile(intelligent())`, `withoutMemory`). Observability has 2 routes (unified + 7 dedicated).
- **No 2-line path.** Minimal template = ~31 generated LOC; no `.quick()`/env-default entry.
- `withOutputSchema` returns via `this as unknown as ReactiveAgentBuilder<A>` — works, but is a type-safety band-aid.
- `create-reactive-agent` templates lack variants (no with-memory, with-approval-gates, with-structured-output).
- Top effort/impact ratios: (1) `.quick()` env-default preset, (2) kill `compose()` alias, (3) upfront key validation, (4) memory/learning consolidation, (5) observability single-route canonicalization.

**Caution (per project memory/no-metric-gaming):** consolidation must be additive facades + soft deprecation of true aliases only — never `@deprecated` on working documented methods to hit a count.

---

## 5. Plans Triage — build / don't build / redirect

| Plan | Status | Verdict |
|---|---|---|
| Eval phases 1–4b (lift gate, gate CLI, ledger) | SHIPPED (`benchmarks/src/gate/gate.ts`, ledger.ts, `rax eval gate`) | Core Receipts engine — feature it |
| Cost-aware model routing | SHIPPED (`cost/src/routing/capability-rail.ts`) | Done, document loudly |
| Cross-tier thinking | SHIPPED (opt-in; per-request thinking = unbuilt seam) | Ship as-is; ablation post-launch |
| Docs revamp | SHIPPED | Verify build + Umami pre-launch |
| Canonical tool execution | SHIPPED A–C; Phase E (batch `.on()` symmetry) deferred | Phase E → v0.14 |
| Cutover leg-B substrate | SHIPPED (RA_ASSEMBLY flag removed, curate() deleted) | Closed |
| Strategy portfolio (2026-06-28) | PARTIAL — Blueprint (ReWOO-shaped) shipped; cross-cutting items open | Blueprint suffices for v0.13; defer rest |
| **Abstention / trust loop** | **UNBUILT on main** — lives on `feat/o3-abstention-trust-loop`, green, unmerged | **Merge after final E2E — the honesty story compounds bench credibility** |
| Cortex rich-trace UI | PARTIAL — `toTraceEvent` mapper on main; UI in worktree only | v0.13.1 if branch clean, else v0.14 |
| Agentic orchestration strategies (2026-06-17 spec) | UNBUILT | **Do NOT build for v0.13** — research-grade scope doubling; revisit v0.14+ with adoption data |
| Memory v2.0 foundation | SUPERSEDED by memory-default-OFF | **Deprioritize indefinitely** until multi-session is a real user ask |
| Adoption strategy (2026-03-05) | STALE | Archive; revisit post-launch with real users |
| Framework gap assessment (2026-03-08) | STALE | Reference only; most gaps closed |

**Also outstanding:** local `main` is **98 commits ahead of origin, never pushed** — the launch repo the public sees is a month behind the real one. Push is a launch prerequisite.

---

## 6. Improvement Backlog (ranked)

### P0 — before launch (first-touch DX wave; ~1 week)

The bench proves reliability; these decide whether a launch-day visitor survives the first 10 minutes. Every item below was hit organically in live probing.

1. **Tool authoring v2**: one canonical shape — schema (Standard Schema: Effect/Zod/Valibot) + plain async handler + **inferred arg types**. Keep Effect handler as advanced form. Validate `defineTool` options at call time (actionable error, not `schema.ast` TypeError). Fix the `as never` in the healing example (it's a smell marker, not a workaround).
2. **Fail-fast `build()`**: missing key / unknown model for the chosen provider = typed build error with fix instructions (opt-out flag for lazy environments). Unify env capture to one read point.
3. **Local timeout**: thread `.withTimeout()` (or an `ollama.requestTimeoutMs` config) into `local.ts`; default should scale for cold-load; timeout error must carry model + elapsed + "cold-load/GPU-contention" hint; abort the server-side request on client timeout.
4. **Error surface polish**: de-duplicate provider error messages; map to plain Errors with a one-line cause + suggestion; keep stack out of default console.
5. **Docs gap close**: builder-api entries for fabrication guard, stall policy, thinking, model routing; README feature bullets; refresh `wiki/Hot.md`; fix channels wording in AGENTS.md.
6. **`.quick()` / env-default entry point** + 2–3 new scaffold templates (structured-output, approval-gates, memory).

### P1 — launch train (v0.13 core)

7. Merge `feat/o3-abstention-trust-loop` after E2E (per project rule: green parts ≠ verified headline).
8. **Public bench** (the actual Receipts deliverable) — include the harness token-multiplier as a self-published receipt (hello=60tok, tool-task≈7k cloud/11k local from this session as internal baseline).
9. Push `main` to origin; OIDC trusted publishing.
10. Cost-governance demo (budget + watchdog + approval killswitches composing) — already planned, cheap, visual.

### P2 — post-launch (v0.13.x / v0.14)

11. Builder-surface consolidation: remove `compose()` alias, one canonical memory/learning route, observability single-route; additive facades + soft deprecations only.
12. Provider adapter base extraction (~200 LOC dedup, centralizes streaming quirks).
13. `direct`/`reactive` merge; sub-agent path unification; `patchStrategy` deletion; loop-detector precedence comment/reorder.
14. Cortex timeline UI (if worktree branch clean); canonical tool-execution Phase E.
15. arbitrator.ts / iterate-pass.ts decomposition.

---

## 7. North Star for v0.13 → v1.0

**One sentence: the harness is the product, receipts are the proof, first-touch DX is the funnel.**

The strategy debate is settled by evidence, not preference:

- **Prove** — v0.13 "Receipts" direction is *correct*; nothing in four audits or five live probes argues for new capability. Heavy-strategy parity, falsified optimization levers, and the orchestration spec's speculative scope all say the same thing: differentiation is *reliability-per-tier with evidence*, not feature count. The eval gate + ledger + deterministic replay already form the verdict engine — the bench is the last mile.
- **Polish** — the one gap the Receipts plan under-weights: launch traffic is first-touch traffic. This session's tester (an experienced agent-framework user, effectively) hit 4 papercuts in 10 minutes — tool authoring, fail-fast, timeout cliff, error surfaces. A great bench with a `schema.ast` TypeError in minute 3 converts nobody. The P0 wave is small (~1 week) and belongs *before* the Show-HN, not after.
- **Publish** — 98 unpushed commits, stale Hot.md, and missing docs for shipped headline features mean the public artifact lags the real project by a month. Launch is as much a sync task as a marketing task.

**Explicit non-goals (hold the line):** LATS/GoT-class heavy strategies, multi-agent orchestration substrate, Memory v2 CAS/versioning, benchmarks-as-marketing beyond the pinned public bench. Every one of these is either empirically parity-at-3-15×-cost or speculative without adoption data.

**v0.14 decision gate:** revisit orchestration + memory-multi-session only with post-launch user signal; capability bets (experience-reuse, recitation) stay behind the ablation lift rule (≥3pp, ≤15% token overhead) measured on the *public* bench.

---

## Appendix: probe scripts

Probes were `scratch-probe-{1..5}-*.ts` at repo root (gitignored pattern), deleted after the session. Shapes: minimal hello; defineTool + withOutputSchema (cloud); same on ollama gemma4:e4b + qwen3:14b; missing-key/model-typo error surfaces. Ollama contention evidence: `journalctl -u ollama` 16:47–16:56 (chat calls 57s–2m31s, one 500 at client 2m cutoff, server completions after abandonment).
