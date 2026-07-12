---
tags: [audit, state-of-framework, synthesis, process]
date: 2026-07-12
status: canonical-snapshot
audience: any agent or human orienting to the repo
supersedes: wiki/Architecture/Specs/04-PROJECT-STATE.md (empirical-state role)
---

# State of the Framework — 2026-07-12

Comprehensive map + health audit synthesized from four parallel read-only audits
(program completion vs git, built-never-wired code sweep, docs/authority accuracy,
226-commit churn analysis). Every claim below was spot-checked against code or git;
commit hashes are the evidence trail.

**Ground truth:** VERSION `0.13.6` (released 2026-07-06). Local `main` is **226 commits
ahead of origin/main** (2026-07-05 → 07-12). 36 packages (2 private), 6 apps.
Canonical direction: `09-UNIFIED-PROGRAM` (sequencing) → `08-AGENTIC-OS-NORTH-STAR v6.0`
(arc content) → `Design-Specs/2026-07-11-harness-north-star-architecture.md` (RATIFIED).

---

## 1. Verdict

**The framework is substantially healthier than two weeks ago, but the process that
got it here is expensive and the repo's self-description has rotted.**

- The July harness program genuinely closed most of its targets: the meta-loop
  (Contract → Ledger → Assessment → Control → Projector → Policy Compiler) shipped
  in full, the measurement instrument was rebuilt to deterministic/graded, ~40
  "built-never-wired" instances were fixed, and the probe fleet now provides
  class-level prevention.
- Cost: ~14% of the 226 commits redid same-week work, ~42% were meta-overhead
  (50 memory-sync commits alone), the bench instrument was rebuilt 4 times
  invalidating 3 baselines, and 3 "canonical direction" documents were written in
  6 days.
- The docs a cold session is told to read first are the most wrong: 04-PROJECT-STATE
  is 76 days stale, Hot.md was 10 days stale, and five documents gave five different
  authority hierarchies (fixed this session).
- v0.14 launch boundary (Wave A/B, per 09 §4) passed on 2026-07-08. v0.14 is uncut.

---

## 2. Program scoreboard (what shipped / what's open)

| Program | Plan doc | Status | Evidence |
|---|---|---|---|
| Arc 1 (Log/Process/Receipt) | 07-05 plan | ✅ SHIPPED (merge `3c9c15fa`) | Launch-gate 1–4 done; **item 5 (published bench receipts) OPEN; v0.14 uncut** |
| Adaptive harness overhaul (9-pillar) | 07-07 plan | ✅ SHIPPED, 1 gate unmet | P1 `60b805fc`, P2 `c102489a`, P3 `3e2d3876`, P3.6 `7bb5afdb`; Phase-6 exit gate unmet — ablation INCONCLUSIVE n=1 (`e232c0ab`), re-cut = task #36 |
| Meta-loop Waves A–G | 07-08 plan | ✅ SHIPPED IN FULL same day | A `36f66dee`, B `6db0bf71`, C `c7a836da`, D `14351866`, E `5c5fb778`, F `a33409d5`, G `99527ed8`+`bab0758b`, Phase 7 `66c5d1b3`; 6 enforcement scripts exist |
| Capability measurement wave | 07-09 plan | ◐ PARTIAL | P0/P1 done (`8407e955`, `e16053cf`, `fa88ce35`/`fc1713b2` canonical baseline); open: 7 llm-judge→graded tasks, more `horizon:long` tasks |
| Goal-reliability + feedback loop | 07-10 plan (active) | ◐ PARTIAL | `c4e964e8`, `269996fb`, `ef3cc3d6`, Wave 3 `51e6182e`/`031e5d26`/`170d9926`, spec RATIFIED `1c928a77`, #40 `88a8356a`; open: #44 spine, #39 per-entity, #38 thought-continuity ablation, B4 |
| Harness root-cause closure | 07-10 plan (active) | ◐ PARTIAL | Items 1–8 closed (`517075ef`, `8b97ad9a`, `50942fb3`, `93c4739b`; item 8 by `88a8356a`); Tier 1–3 open list is the canonical backlog (§5) |
| Probe fleet QA | 07-11 debrief | ◐ PARTIAL | Fleet `f65722f6` + same-day fixes `309a5c3a`/`ed5caa07`/`d4623073`/`b1755ff4`; verifier-at-boundary `b6745426`; open: success+empty-output, ToT cost floor, reflexion budget collision |
| Strategy ledger / receipt truth | 07-11 debrief | ✅ SHIPPED (core) | `a4c5154d`, `e247e6b8`, `02e5d12b` |
| Stream events + guard reachability | (no plan; 07-12) | ✅ SHIPPED | `61f05489`, `e41006e9`, `68bcb046`, `b6745426`, dual API `5579663a`/`166c7a54` (spec `a0eb5755`) |
| Subagents + unified logging | 07-11 plan | ⬜ DRAFT, unimplemented | Only adjacent slice landed: Effect-logger bridge `311bce38`. Boundary itself untouched (§4.1) |

---

## 3. Built-never-wired register (verified 2026-07-12)

### Now FIXED (do not resurface)
- context-engine dead text-assembly: deleted in Phase 1b `279b61fb` (227 LOC remain, all live callers)
- KernelState.meta: fully typed `KernelMeta`; reasoning pkg has ~0 `as any`
- Two-path context building: `project()` is sole prompt pipeline; RA_ASSEMBLY flag flipped+dead
- `StreamCompleted.abstention`, `deliverables[]` verdict read, `gate:"in-loop"` writer — all wired
- Kernel `Effect.log*` discard: effect-logger-bridge wired in execution-engine + tested
- Tool events on public stream (`61f05489`); START/COMPLETE pairing (`e41006e9`)

### LIVE unwired/debt items (ranked; the wire-or-delete queue)
| # | Item | Location | Risk |
|---|---|---|---|
| 1 | **Subagent detached-runtime boundary** — fresh root fiber per spawn; parent EventBus/Trace/Logger dropped, no cancellation | `runtime/src/builder/build-effect/spawn-handlers.ts:140,163`, `local-agent-tools.ts:141,157` | H |
| 2 | **3/7 adapter hooks orphaned** (regression by APC deletion `279b61fb`): `taskFraming`, `toolGuidance`, `systemPromptPatch` have zero call sites; `calibration.ts:160-177` writes overrides nothing reads; `llm-provider/index.ts:227` still advertises "7 hooks" | `llm-provider/src/` | H |
| 3 | **CompletionEnvelope not consumed by blueprint + code-action** — the two strategies in the file's own DISEASE comment; can still upgrade partials to `completed` | `kernel/state/completion-envelope.ts` | H |
| 4 | **RA_RECITE ablation measures nothing** — both arms byte-identical after revert `034d28de`; running it manufactures a fake finding | `benchmarks/src/sessions/recitation-ablation.ts:39` | M |
| 5 | **RunLedger `requirement` kind: zero writers** (reader workaround at `standing-frame.ts:135`); `handoff` same; delete `contract-amended`/`checkpoint-marker`/`deliverable-commit` unless writer+reader ship together | `run-ledger.ts:97` | M |
| 6 | **runtime pkg: 67 `as any`** (runtime.ts 12, telemetry-emit.ts 7, execution-engine.ts 6) — violates clean-types rule; reasoning is clean | `packages/runtime/src/` | M |
| 7 | `verifierTier`: 4 tiers declared, 1 impl, 0 dispatch | root-cause item 5 | M |
| 8 | Adaptive-plan dead fields (`scaffoldingLevel`, plan `maxIterations`, `memoryPosture`, `toolSurface`) — DEEPEN/LEAN recompile behaviourally no-op | root-cause item 6 | M |
| 9 | Compaction never fires (threshold ≈ whole window); failed tool results pinned | root-cause item 9 | M |
| 10 | Misleading stale comments: `arbitrator.ts:1140` (RA_POST_CONDITIONS gate actually unconditional), `context-utils.ts:9` (buildStaticContext deleted) | — | L |

Layering: clean (reasoning does not import runtime). One smell: `llm-provider/calibration.ts:17` type-imports from memory.

---

## 4. The mistakes — process failure patterns (226-commit analysis)

Numbers: 62 fix / 62 feat / 90 docs (50 = memory syncs, 22% of ALL commits) / 12 other.
Estimate: **~44% forward progress, ~14% same-week rework, ~42% meta-overhead.**

1. **Instance-level whack-a-mole on "built, never wired."** Four audits in 5 days
   (07-07, 07-09, 07-10, 07-11) each re-found the same disease class; ~40 instance
   fixes landed before the class-level prevention (probe fleet with receipt-vs-disk
   cross-checks, `f65722f6`) arrived on the last day. The `wire_and_verify` rule
   existed as memory but not as machinery.
2. **Fix verified by a test that can't fail.** Archetype `241e7efe`: abstain-seam
   fixes shipped inert twice in one day because seam tests set values production
   caps below the trigger. Also `f36f4887` (test asserting on an execution that
   never happened), two claim retractions (`abaf486c`, `fe193a2e`).
3. **Instrument churn destroying measurements.** Bench scoring changed on 4 separate
   days; every baseline/gate run was obsolete within 48h (3 gate re-runs on 07-07
   alone; 3 "canonical baselines" in 3 days). Deterministic gate + replay goldens
   should have been built FIRST.
4. **Per-site fixes for cross-cutting bugs.** llmCalls, tool ledger, toolUsed pairing,
   terminal authority each fixed seam-by-seam across 2–4 commits/days; the boundary-
   level fix (e.g. CompletionEnvelope `88a8356a`, verifier-at-result-boundary
   `b6745426`) always arrived after the per-site pass and obsoleted part of it.
5. **Fixing by deletion without re-wiring consumers.** APC deletion (`279b61fb`)
   silently orphaned 3 adapter hooks whose only callers lived in the deleted stack
   (§3 item 2). Deletion needs the same wire-check as addition.
6. **Meta-overhead at wrong granularity.** 50 memory-sync commits (1 per 2.6
   substantive commits; 12 on 07-07 alone); 3 overlapping canonical-direction docs
   in 6 days, the third needing `e9d2266d` to reconcile contradictions among them;
   two same-day "active" programs (07-10) listing the same items in different order.
7. **Docs/authority rot as a system.** The mandated cold-start reads were the most
   wrong docs in the repo; plan status blocks freeze at write time ("everything
   below is OPEN" while everything had shipped); Planning-Index missed ~15 July
   plans; internal task IDs (#36–#58) collide with unrelated GitHub issue numbers,
   so commit messages auto-link to wrong issues.

## 4b. Corrective doctrine (how to move canonically)

1. **Probes are the regression gate.** Any new mechanism ships with a probe-fleet
   or graded-bench cell that fails when its wiring is cut — mutation goes red or
   it's not done. (Machinery now exists; use it instead of scheduling audit #5.)
2. **Boundary-first fixing.** On the second instance of a defect class, stop and
   fix the boundary (one authority, one ledger, one envelope), not the third site.
3. **Deletion checklist.** Removing a subsystem requires grepping for consumers it
   was the sole caller of; orphaned declarations get deleted or re-wired in the
   same commit.
4. **Measurement freeze.** No bench-scoring change while a baseline or gate run is
   in flight; metric change ⇒ immediate re-baseline (declared rule, now enforced
   by the drift gate — keep it).
5. **Memory sync per wave, not per commit** (~15–20 syncs instead of 50). Plans get
   a status block updated at wave close, or none at all.
6. **One direction doc.** 09-UNIFIED-PROGRAM governs sequencing; changes to it are
   ratification events. No new north-star documents — amend 09.
7. **Namespace internal tasks** (e.g. `T-36`) so they stop auto-linking to GitHub
   issues.
8. **Push cadence.** 226 unpushed commits is a single-point-of-failure risk and
   hides the work from CI/origin. Push main (or slice releases) at wave boundaries.

---

## 5. Canonical open-work list (deduped across all programs)

Ordered by leverage; sources: root-cause program Tiers 1–3, goal-reliability plan,
probe-fleet debrief, this audit's fresh findings.

1. **v0.14 launch line** — cut v0.14 (Arc 1 + meta-loop foundations already merged),
   publish bench receipts (launch-gate item 5), Show-HN. The Wave A/B boundary
   passed 2026-07-08; this is 4 days overdue and blocks nothing else. Includes
   pushing main to origin.
2. **Wire-or-delete sweep from §3** — items 2 (adapter hooks), 3 (CompletionEnvelope
   in blueprint/code-action), 4 (RA_RECITE ablation), 5 (ledger dead kinds),
   7 (verifierTier), 8 (adaptive-plan fields). Each: consumer reads it, mutation
   goes red, or it's deleted.
3. **Per-entity requirements primitive** (#39) — closes nudge-vs-abstain fight,
   receipt target blind spot, dead `cardinality:"per-entity"` in one primitive.
4. **Kernel→engine signal unification** (#44) — `ctx.toolResults`/`lastResponse`
   empty on kernel path; memory extraction erratically reachable.
5. **Thought-continuity ablation** (#38) — flag shipped, never measured; prereq:
   Ollama provider discards `thinking` field (inert on local tier).
6. **Subagents + logging program** — RATIFY or reject the 07-11 DRAFT plan; the
   detached-dispatch boundary (§3 item 1) is the single root cause of invisible/
   uncancellable/unattributable workers.
7. **Bench P2 remainder + P3** — 7 llm-judge tasks → deterministic graded
   (sd 0.50→≤0.30), then immediate re-baseline; add `horizon:long` tasks.
8. **#36 adaptive-ablation re-cut** on the new instrument (Phase-6 exit gate;
   never claim "adaptive hurts" — prior verdict INCONCLUSIVE n=1).
9. **Probe-fleet residue** — success:true+empty-output, ToT trivial-task cost floor
   (19 calls), reflexion empty-generate budget collision, content-fabrication
   output⊆observations check.
10. **B4 recitation default** (`showOutstanding=false`) — ablation or owner decision.
11. **Compaction wiring** (root-cause Tier 3) + tool-roster consolidation (two
    terminators, three memory tools, superseded-yet-exported tools).
12. **runtime `as any` cleanup** (67 casts) — mechanical, high hygiene value.

---

## 6. Docs/authority state (fixed this session where cheap)

- **Authority chain (now canonical, single answer):**
  `09-UNIFIED-PROGRAM` (sequencing) → `08-AGENTIC-OS-NORTH-STAR v6.0` (arc content) →
  `2026-07-11-harness-north-star-architecture.md` (kernel architecture, RATIFIED) →
  active plans → evidence (ledger/bench reports).
- Fixed this session: Hot.md rewritten to 07-12; 04-PROJECT-STATE banner-deprecated;
  AGENTS.md read-order + point fixes (8 providers, tag-driven release, 36 pkgs);
  DOCUMENT_INDEX updated; Planning-Index July rows added; stale plan status blocks
  patched; memory corrected (HS-34/35 were already cleared in Running Issues Log —
  the memory claim was the stale one).
- Still pending (small): `metrics-cache.json` 7190→7671 write-back before next
  `metrics:sync-readme` (else README regresses); README "33 published"/apps-count
  recount; `.agents/MEMORY.md` at 407KB needs archive split.

---

*Method note: four parallel read-only agents (plans-vs-git, code sweep, docs accuracy,
churn analysis), synthesized by the main session. Agent claims spot-checked; where an
agent contradicted memory, code won (e.g. HS-34/35).*
