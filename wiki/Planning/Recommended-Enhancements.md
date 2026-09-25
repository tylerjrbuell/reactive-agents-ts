---
aliases: [High-Leverage Backlog, Recommended Enhancements]
tags: [planning, backlog, prioritization]
updated: 2026-09-23b
---

# Recommended Enhancements

**Purpose:** Running, curated list of the highest-leverage bug fixes and new
capabilities for users — distilled from GH issues, `wiki/Issues/Running Issues
Log.md`, and `wiki/Hot.md`, with each item spot-checked against the actual
codebase before inclusion (not just trusted from docs). This is a *curation*
layer on top of GH issues, not a replacement for them — every item here should
have (or get) a GH issue number.

**Convention:** Add items here only after a code-level spot-check confirms
the gap is still real. Remove/strike items once shipped, with the closing
commit/PR noted.

---

## 2026-09-23 sweep (second pass, same day) — fresh DISCOVER + sprint batching

**Trigger:** re-invoked with no args, immediately after the morning's backlog overhaul
(section below). This pass runs the DISCOVER step the morning pass time-boxed —
`bun test` full suite (not just `bun run build`) — and produces capped sprint batches
per the skill's BATCH step, which the morning pass didn't do explicitly.

**Sources read this pass:** `bun test` (full run, 9619 tests/1257 files — new signal,
not read this morning), `wiki/Architecture/DEBT-REGISTER.md` §3 (OPEN cross-cutting
gaps + §3b absorbed-open-work table, ~120 lines not read this morning),
`wiki/Failure-Modes/00 FM Catalog.md` (grepped for open 🔄 markers — all point to the
same pre-09 "Phase 1.5 M-series" framework already parked this morning, no new
candidates). `gh issue list --state all --search` dedupe checks for every new
candidate below.

### DISCOVER finding — dev branch test suite is red (2 of 4 failures root-caused this pass)

`bun test` on `dev` HEAD (`45d84d91`): **9586 pass / 4 fail** (up from the 2026-09-22
memory snapshot's 9454/2-fail — file count also grew 1235→1257, consistent with
in-progress judgment-layer work). Two failures isolated to
`judgment-comprehend-shadow-wiring.test.ts`: `askCallCount` off by exactly +1 in both
the small- and large-tool-roster cases. Read `judgment-classification.ts` end to end —
production chunking math is correct for the test's inputs; only one production call
site. Working hypothesis (UNVERIFIED, explicitly flagged as such in the filed issue):
a shared module-level `askCallCount` plus an un-scoped `Effect.forkDaemon` fiber
leaking a stray `ask()` call across sequential tests in the same file — a test-hygiene
bug, not a confirmed production double-fire. Filed as
[#215](https://github.com/tylerjrbuell/reactive-agents-ts/issues/215), P1, with the
production-double-fire alternative explicitly named as the P0 case to rule out first.
Other 2 failures (a live-model benchmark scenario inside `packages/trace/__tests__/layer.test.ts`)
time-boxed out — flagged in the issue for separate triage, not conflated with the
judgment-shadow finding.

### SCORE

| Item | Blast | Freq | Cost(inv) | Score | Status |
|---|---|---|---|---|---|
| #215 dev-red test regression | 2 (blocks clean merge of active WIP judgment-layer branch) | 3 (every `dev` test run hits it right now) | 2 (isolated to one test file + one shadow module) | **12** | VERIFIED (symptom); root cause is a stated hypothesis, not fully confirmed |
| #213 wither batch 2 | 2 | 2 | 2 | 8 | carried from morning sweep |
| #206 abstention synthesis | 2 | 3 | 2 | 12 | carried, previously filed, re-scored this pass — high freq (any budget-exhausted run) |
| #214 as-unknown-as ceiling | 1 | 1 | 3 | 3 | carried from morning sweep |

### DEDUPE note

`DEBT-REGISTER.md` §3b's "#39 per-entity requirements" (generic `cardinality:"per-entity"`
tool-coverage, still OPEN per the register) was considered for filing this pass but
**not filed** — it's already recorded in `wiki/Hot.md` "What's Next" #5 as a known,
disclosed, untouched backlog item with no owner decision to defer, but also no fresh
grounding done this pass beyond re-reading the existing register entry (no new
file:line evidence gathered). Left as a "needs go/no-go" flag rather than filed
speculatively — same disposition as the morning pass gave HS-236.

### Sprint batches (capped, score-sorted, mixed bug/capability)

**Sprint 1 — unblock `dev`, ship this week**
1. **#215** (score 12) — root-cause + fix the dev-branch test regression. Do this FIRST — it's blocking clean CI on active WIP.
2. **#206** (score 12) — abstention synthesis on budget exhaustion. Already scoped, needs the design pass called out in its own thread.
3. **#213** (score 8) — wither batch 2, pattern fully established, can run in parallel with #215/#206 (different files).

**Sprint 2 — contributor-facing backlog (good first issue / help wanted)**
1. **#54** Mistral adapter — re-verified real this morning, `good first issue`.
2. **#55** Cohere adapter — same.
3. **#38** README Named Users section — trivial, newly labeled `good first issue`.
4. **#214** (score 3) — as-unknown-as ceiling gap, mechanical, `good first issue`.

**Needs go/no-go (not filed, flagged for owner decision):**
- `DEBT-REGISTER.md` §3b "#39 per-entity requirements" — real, disclosed, untouched; no explicit defer decision recorded, but also not re-grounded this pass.

---

## 2026-09-23 sweep — full backlog overhaul, contributor-onboarding pass

**Trigger:** first "beginning to get contributions" sweep — full re-triage of all 22
open GH issues (not just new-candidate scoring), stale-issue closure, and a fresh
DISCOVER pass (build/test baseline, provider/exporter/template dir checks, TODO/FIXME
density).

**Sources read:** `gh issue list --state open --limit 200` (22 open, full titles +
labels, sorted by staleness), `gh label list` (full taxonomy), `wiki/Issues/Running
Issues Log.md` (full), `wiki/Hot.md` (full), `wiki/Planning/Recommended-Enhancements.md`
(this file, full), `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md` (§1-3, §7-9 —
sampled, ~180 of ~370 lines), `wiki/Architecture/DEBT-REGISTER.md` (grepped for
"wither"/"as-unknown-as", not read in full). Fresh discovery: `bun run build` (38/38
green), `ls packages/llm-provider/src/providers/` (6 files: anthropic, gemini, litellm,
local, local-probe, openai — groq/xai route through litellm per
`runtime.ts:64`), `ls packages/observability/src/exporters/` (3: console, file, otlp),
`grep TODO|FIXME packages/*/src` (33 hits, mostly regex-literal false positives or
already-tracked/deliberate stubs — no new candidates surfaced).

### GROUND — every open issue re-verified against current code/docs

| # | Title | Result |
|---|---|---|
| #62 | Roadmap Phase C→G tracker | **STALE — CLOSED.** `09-UNIFIED-PROGRAM.md` was rewritten in place 2026-08-12, replacing the Phase C-G letter sequencing entirely with a K/P/T strand model + Steps 0-6 ordered path (§7). The tracker followed a framework that no longer exists in the canonical doc. |
| #37 | multi-agent template (`create-reactive-agent`) | **STALE — CLOSED.** Body specs the template around `@reactive-agents/orchestration`, which AGENTS.md confirms was removed entirely in v0.14. Unbuildable as specced. |
| #124 | harness-convergence 3.2 composite confidence signal | **STALE — CLOSED.** Filed 2026-05-23, before the meta-loop overhaul (v0.14) and TypeSafe/Jev judgment layer (Sept 2026) shipped a per-iteration `assessment` trace event + `agent.judge()` shadow sites — the surface this issue targeted no longer matches the architecture. |
| #125 | harness-convergence 3.3 capability composition routing | **STALE — CLOSED.** Same disposition as #124. |
| #34, #45 | code-action bench vs reactive (qwen3:14b) | VERIFIED still open/real — code-action is still `promote-candidate` tier per AGENTS.md's live strategy registry, not GA. Not scheduled in 09's current Steps 0-6, so flagged parked (comment added), not closed. |
| #36 | Promote code-action → GA | VERIFIED, blocked on #34/#45. Comment added noting parked status. |
| #42, #43, #44 | M8/M10/M14 mechanism benches | **UNVERIFIED (sampled out)** — not re-grounded against current code this pass; flagged via comment for owner triage given they predate 09's WIP=1 path. |
| #48, #49, #51 | τ-bench gates | VERIFIED still real — `wiki/Hot.md` "What's Next" confirms the τ-bench environment bridge is deliberately tabled (2026-09-14 owner decision), not abandoned. Comments added clarifying tabled ≠ stale. |
| #50, #52, #38 | README/reproducibility doc chores | VERIFIED still real, independent of roadmap framing. #38 (Add Named Users section) labeled `good first issue` + `help wanted` — trivial, self-contained doc edit. |
| #54, #55 | Mistral / Cohere provider adapters | VERIFIED — `ls packages/llm-provider/src/providers/` confirms neither exists. Already correctly labeled `good first issue`/`help wanted`. |
| #31, #32, #33 | Langfuse/Braintrust exporters, OTel sampling | VERIFIED still open (re-confirmed exporters dir unchanged since 09-19 sweep). |
| #206 | Abstention synthesis on budget exhaustion | VERIFIED still open, still needs its own design pass per prior sweep note. |

### FILE — 2 new issues from fresh DISCOVER, both grounded and dedupe-checked

| Item | GH | Score | Why |
|---|---|---|---|
| Wither batch 2 — behavioral proof for 9 SILENT builder withers (withA2A, withAgentTool, withCircuitBreaker, withGrounding, withHarness, withMinIterations, withStallPolicy, withVerification, withVerificationStep) | [#213](https://github.com/tylerjrbuell/reactive-agents-ts/issues/213) | Blast 2 (public API surface) × Freq 2 (every builder user of these withers is currently unprotected against silent breakage) × Cost(inv) 2 (pattern fully established by batch 1, ~1-2hr/wither) = **8** | Fully specced in `DEBT-REGISTER.md` §B3 census with an existing 6-test precedent (batch 1, 2026-09-15) to follow — low-ambiguity, contributor-ready. |
| `as-unknown-as` cast ceiling gap (79 actual vs 78 declared ceiling) | [#214](https://github.com/tylerjrbuell/reactive-agents-ts/issues/214) | Blast 1 (single type-safety ratchet) × Freq 1 (CI-only surface) × Cost(inv) 3 (small, mechanical) = **3** | Carried in `wiki/Hot.md` "What's Next" since 2026-09-15, never filed as a GH issue — pure tracking gap, not a new finding. Labeled `good first issue`. |

### Contributor-onboarding labeling pass

Reviewed all 20 remaining open issues for `good first issue`/`help wanted` fit. Confirmed
correct on #54, #55 (already labeled) and #213/#214 (labeled at filing). Added to #38
(trivial README section addition — was missing both labels despite being genuinely
beginner-suited). No other open issue is small/self-contained enough to qualify — the
rest are either research-track (bench gates, M-series spikes) or require deep kernel/
harness context.

### Net result

22 open → **4 closed** (stale, superseded by architecture rewrites) → **2 filed**
(grounded, contributor-ready) → **20 open**, all re-verified or explicitly marked
unverified-sampled-out this pass. No item was silently re-ranked without a ground check.

---

## 2026-09-19 sweep

Method: `gh issue list` (23 open) + full read of `wiki/Issues/Running Issues
Log.md` + `wiki/Hot.md`. Small sample, not exhaustive — see note at bottom.

### Batch 1 — Ship-blocking (do first)

| Item | GH | Status | Why highest leverage |
|---|---|---|---|
| `createRequire(import.meta.url)` crashes every LLM provider on Cloudflare Workers at module scope (`packages/runtime-shim/src/{fs,hash,database,spawn,serve,glob}.ts`) | [#205](https://github.com/tylerjrbuell/reactive-agents-ts/issues/205) | Open, filed today | Structural, not cosmetic: blocks the entire Cloudflare Workers template (#59) and every provider on that runtime target, not just the PR under review. Confirmed via live `wrangler dev` smoke test (not just a bundle dry-run) — the bug is invisible to `wrangler deploy --dry-run`. Fix is small (move `createRequire` into function scope / lazy-init) relative to the blast radius. |
| Cloudflare Workers template (`create-reactive-agent`) | [#59](https://github.com/tylerjrbuell/reactive-agents-ts/issues/59) | Open, blocked by #205 | Expands the framework's deployable-runtime surface (edge/serverless) — a capability class, not a bugfix. Currently blocked on #205; sequence #205 first. |

### Batch 2 — User-facing quality gap (do next)

| Item | GH | Status | Why highest leverage |
|---|---|---|---|
| No honest abstention synthesis when budget exhausts with no valid output — agent ships silent empty output instead of "I couldn't complete this, here's what I tried" | [#206](https://github.com/tylerjrbuell/reactive-agents-ts/issues/206) | **Filed this sweep** (was only tracked as HS-239 in the wiki, never migrated to GH) | Spot-checked directly: `resolvePassOutput()` (`packages/reasoning/src/kernel/loop/run-pass.ts:78-99`) confirmed to return `null` on budget exhaustion with no valid thought — read the function body, not inferred. This hits *every* long-running/budget-constrained task that doesn't finish in time, which is a common real-workload path, not an edge case. The prior related bug (RA shipping a *lying* continuation message in this same path) was already fixed (HS-237, 2026-09-09); this is the follow-on gap that fix intentionally left open. Competing framework (Mastra) handles the equivalent case with a compliant abstention message on the same bench task/model. |

### Batch 3 — Framework-wide determinism gap (documented, not yet scoped into an issue)

| Item | GH | Status | Why leverage is real but lower-priority |
|---|---|---|---|
| No deterministic, free (non-LLM) tool-requirement inference — tasks with no `.withRequiredTools()`/`TaskContract` are fully permissive by default; whether a needed tool gets called is left to first-iteration model sampling alone | Not filed (HS-236 in Running Issues Log, explicitly "document, don't build" per user decision 2026-09-03) | Documented only | Real structural gap (confirmed: `packages/runtime/src/builder/contract-tool-set.ts:100-113`), but the prior LLM-based classifier attempt for the same problem was already killed for 0pp lift at +25-167% token cost — so a cheap regex-based version needs real scoping (file-write-only vs. broader verb coverage) before it's issue-worthy. Left un-filed deliberately; flagging here so it isn't lost, not recommending immediate action.

### Backlog debt (lower leverage, tracked already — not re-litigated this sweep)

`as-unknown-as` cast ceiling gap (79 vs 78, pre-existing, `wiki/Hot.md` "What's Next" #3), Wither batches 2-4, τ-bench environment bridge (tabled), #39 per-entity requirements, #44 kernel→engine signal unification. All already tracked in `wiki/Hot.md` — not duplicated here since they're internal-debt rather than user-facing-capability items.

---

## 2026-09-19 sweep (second pass, same day)

**Context:** a first sweep ran earlier today (the "2026-09-19 sweep" section
above) and produced #205, #59, #206, and the documented-not-filed HS-236
item. This pass explicitly dedupes against that section — none of those four
are re-scored or re-listed below.

**Sources read this pass:** `gh issue list --state open --limit 200` (26 open,
full titles/labels — same list re-read, no new issues since the morning
sweep); `~/.claude/projects/.../memory/MEMORY.md` (full, incl. linked
`Current Status`/`Architecture` sections); `wiki/Hot.md` (full, ~150 lines);
`wiki/Architecture/DEBT-REGISTER.md` (head + tail sections, ~250 of its
~600 lines — **sampled, not exhaustive**, it is a large historical file and
most of §2/§2b is already marked RESOLVED); `wiki/Failure-Modes/00 FM
Catalog.md` (head, ~180 of its lines — **sampled**, scanned for open 🔄
markers only); `wiki/Issues/Running Issues Log.md` (head ~150 lines —
**sampled**, this file is ~640 lines per the morning sweep's own note and
was not re-read in full this pass, since the morning sweep already read it
in full and nothing in Hot.md/MEMORY.md flagged a change to it today).
**Skipped entirely:** every closed GH issue, the 09-UNIFIED-PROGRAM spec,
wiki/Architecture/Specs generally, and all `wiki/Research/Debriefs/*` files
beyond what MEMORY.md already summarizes.

### GROUND — new candidates checked against live code

| Candidate | Claim source | Check performed | Result |
|---|---|---|---|
| Langfuse exporter (#31) | GH #31, open since 2026-05-15 | `ls packages/observability/src/exporters/` | **VERIFIED** — only `console-exporter.ts`, `file-exporter.ts`, `otlp-exporter.ts` exist; no Langfuse-specific exporter. (Note: package was `@reactive-agents/observe` when filed, renamed to `@reactive-agents/observability` since — same gap, different path.) |
| Braintrust exporter (#32) | GH #32, open since 2026-05-15 | Same directory listing | **VERIFIED** — same finding as #31, no Braintrust exporter. |
| OTel sampling + `ReasoningStepCompleted` nesting (#33) | GH #33, open since 2026-05-15 | `grep -n "sampl" packages/observability/src/tracing/*.ts` → 0 hits; `grep -rl "ReasoningStepCompleted" packages/observability/src/` → 0 hits (only in `debugging/thought-tracer.ts` and `metrics/metrics-collector.ts`, not tracing) | **VERIFIED** — no sampling logic in the tracing layer; `ReasoningStepCompleted` isn't consumed by the tracer for nesting either. |
| Wither batch 2 (9 SILENT withers: withA2A, withAgentTool, withCircuitBreaker, withGrounding, withHarness, withMinIterations, withStallPolicy, withVerification, withVerificationStep) | `wiki/Architecture/DEBT-REGISTER.md:124` (B3 census, 2026-09-15) | Read the census row directly | **VERIFIED** as a real, current, enumerated backlog — but already recorded in this file's "Backlog debt" section above and in `wiki/Hot.md` "What's Next" #2. Not re-scored; would fragment the record to re-list it. |
| GH #62 Roadmap milestone tracker (priority:p1) | `gh issue list` | Read issue via list metadata (title only — body not fetched, program-management tracker not code work) | **UNVERIFIED (sampled out)** — did not open the issue body this pass; excluded from scoring as non-code (program-management), consistent with the morning sweep's same call on this issue. |
| #55 Cohere adapter, #54 Mistral adapter (good-first-issue, area:providers) | `gh issue list` | Not grounded against `packages/llm-provider/src/adapters/` this pass | **UNVERIFIED (sampled out)** — plausibly still real gaps (both open since 2026-05-15) but not spot-checked; time-boxed out. |
| Remaining open issues #34/#36/#37/#38/#42/#43/#44/#45/#48/#49/#50/#51/#52/#124/#125 | `gh issue list` | Titles read only | **UNVERIFIED (sampled out)** — mostly Phase D–G research/doc-chore items already sequenced by the roadmap; not independently re-verified this pass. |

### SCORE

| Item | Blast radius | Frequency | Fix cost (inv.) | Score | Status |
|---|---|---|---|---|---|
| #33 OTel sampling + span nesting | 2 (all OTel/observability users at scale — cost control) | 2 (common non-default path: anyone running tracing in production) | 2 (moderate, isolated — sampling policy + nesting fix inside `tracing/`) | **8** | VERIFIED, already filed |
| #31 Langfuse exporter | 1 (one narrow integration path) | 1 (opt-in, vendor-specific) | 2 (moderate — new exporter implementing existing interface) | **2** | VERIFIED, already filed |
| #32 Braintrust exporter | 1 | 1 | 2 | **2** | VERIFIED, already filed |

No new GH issues filed this pass — all three scored candidates are already
open (#31/#32/#33), so step 5 (FILE) has nothing new to do. Scores are low
relative to this morning's #205 (ship-blocking, high blast radius); this
pass did not surface anything of comparable severity in the time-boxed
sample. That itself is a finding: the morning sweep likely already claimed
the highest-signal items visible from a cheap scan.

### Sprint 4 (opportunistic, low urgency) — observability exporter debt

5. Scope #33 (OTel sampling + span nesting) — highest-scored surviving item this pass, but still moderate (8/27); reasonable to bundle with #31/#32 into one observability-focused sprint rather than schedule alone.
6. #31 + #32 (Langfuse/Braintrust exporters) — same shape as #33, low individual leverage (2/27 each), bundle together if picked up.

**Not re-litigated (already tracked, see sections above):** #205, #59, #206, HS-236, wither batch 2, `as-unknown-as` ceiling gap, wither batches 3-4, τ-bench bridge, #39, #44.

---

## Prioritized execution plan (sprints)

**Sprint 1 (this week) — unblock Workers support**
1. Fix #205 (`createRequire` lazy-init in `runtime-shim`) — small, isolated, high blast-radius payoff.
2. Land #59 (Cloudflare Workers template) once #205 is verified fixed with a live `wrangler dev` smoke test, not just a bundle check.

**Sprint 2 (next) — close the "silent failure" UX gap**
3. Scope and implement #206 (budget-exhaustion abstention synthesis). Suggested shape: deterministic/templated message (not another LLM call) summarizing attempted steps + exhaustion reason. Needs its own design pass per the wiki's own sizing note — don't try to land it as a quick patch.

**Sprint 3 (opportunistic) — decide on the determinism gap**
4. Make an explicit call on HS-236 (regex-based required-tool inference): either scope a narrow file-write-only version and file it, or formally close it as "not pursuing" so it stops recurring in health-sweep notes.

**Not batched (needs owner decision, not effort):** τ-bench environment bridge, Roadmap milestone tracker (#62) — these are program-management items, not code-level work; re-surface at the next Hot.md session-start review rather than scheduling as sprint work.

---

## Sampling note

This sweep read `gh issue list` (23 open issues, full titles), the full
`Running Issues Log.md` (~640 lines), and `Hot.md` in full. It did **not**
read every closed issue, every health-sweep register row in depth, or the
09-UNIFIED-PROGRAM / North Star specs. Two candidate items were spot-checked
against source (`run-pass.ts` for #206, `runtime-shim` files referenced by
#205's own issue body) — the rest of this list is not independently
re-verified beyond what's already documented at the cited locations. Treat
this as a fast high-signal pass, not an exhaustive audit.

---

## 2026-09-19 sweep (third pass)

Method: full open-GH-issue list (23, all titles/labels read), memory file
(`~/.claude/projects/.../memory/MEMORY.md`, 122 lines) read in full, targeted
grep/read against `wiki/Architecture/DEBT-REGISTER.md` entries and live
source for two memory claims. Did **not** re-read `Running Issues Log.md`,
`Hot.md`, or the Failure-Modes catalog in depth this pass (both prior sweeps
today already covered them in full/sampled).

### Result: no new sprint this pass

All 23 open GH issues were already either covered by the first two sweeps
today (#205, #59, #206) or are long-standing research/roadmap/provider-adapter
items (τ-bench gates, Cohere/Mistral adapters, phase trackers) already
correctly deprioritized as additive-nice-to-have, not broken/blocking.

Two memory claims were run down and found **STALE** — correcting them here
rather than filing anything:

| Claim (source) | GROUND check | Verdict |
|---|---|---|
| "Two live memory-consolidator services (unverified)" — MEMORY.md architecture note | `find packages -iname "*memory-consolidat*"` → exactly one production file, `packages/memory/src/services/memory-consolidator.ts` | **STALE** — memory note should be corrected/removed, not actioned |
| D-2026-07-30-I, DEBT-REGISTER: "`predictNumCtx` + `BUCKETS` designed but never wired" | `grep num_ctx` across `packages/llm-provider/src` shows demand-driven `num_ctx` IS wired end-to-end via `capability.recommendedNumCtx` / `local.ts` (different implementation path than the named `predictNumCtx`/`BUCKETS`, but the same gap is closed) | **STALE — superseded**, not an open gap; DEBT-REGISTER entry needs a status update, no GH issue needed |

No item scored high enough (or was ungrounded-but-real) to justify a new
sprint batch. Recommendation: next sweep should widen scope to closed-issue
history and the Failure-Modes catalog rather than re-scanning the same 23
open issues, which are now fully accounted for.

**Sampled out:** `wiki/Failure-Modes/00 FM Catalog.md`, `Running Issues
Log.md` re-read, closed GH issues, the 09-UNIFIED-PROGRAM spec.

## 2026-09-19 sweep (fourth pass — DISCOVER)

**New this pass:** first pass to run DISCOVER (fresh code checks) instead of only re-reading trackers. Ran `bun run build` (clean, 37/37), `bun test` (9428 pass/25 skip/4 todo/2 fail), and a TODO/FIXME/`as any`/`@ts-ignore` density check (deferred — DISCOVER's build+test results were higher-signal and consumed the time budget).

### Findings

| Item | Score (blast×freq×cost⁻¹) | Status | Link |
|---|---|---|---|
| North Star gate: 14 pinned scenarios now terminate at iter 1 instead of 2 vs the 2026-09-15 committed baseline | 3×3×2=18 | VERIFIED (reproduced via deterministic `test` provider, `gate:explain`) | #207 |
| `effect logger bridge` "status mode stays clean" test fails in full suite but passes in isolation (4/4) | 1×2×2=4 | VERIFIED as a real flake (test-isolation/ordering, not a code defect) — not filed, noted here only | — |
| WS-5b `as unknown as` cast-site ceiling (79 vs 78) | — | already known, see [[feedback_typecheck_vs_build]] / memory — not re-filed | (pre-existing) |

### Sprint 5 (this pass)

1. **#207** — North Star gate iteration-count regression. Score 18, highest of any finding across all 4 passes today. Needs a bisect across the 59 commits since the 2026-09-15 baseline (`c8b8b418`), starting with the entropy-scoring commits (`d43de304`, `6be81534`, `a07277fe`) since composite entropy feeds the termination decision — not yet confirmed as root cause, just the first place to look.

**Skipped/sampled-out:** TODO/FIXME/`as any` density grep (not run — build+test consumed the budget), `architecture-audit`-style dead-code/layer-violation scan, closed-GH-issue history beyond the two searches run for dedupe.
