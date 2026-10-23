---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-10-20
---

# Hot (Recent Context Cache)

**Purpose:** Quick lookup of last session state. Read this first at session start.

---

## 2026-10-22 — Quality & Scalability Program launched: gates landed (#259 done, #260 open)

Living tracker: `wiki/Planning/Implementation-Plans/2026-10-22-quality-scalability-program.md`
(input: `wiki/Research/Audit-Reports-2026-10-22/decomposition-scale-audit.md`). Phase A shipped:

- **#263 (Task 1, closes #259):** `scripts/check-file-size.sh` — 24 files pinned at wc -l
  ceilings, shrink-only deliberate-ledger law, new-giant-at-birth block, SCAN-EMPTY,
  9 red-on-cut fixtures. Caught its first drift THE SAME DAY: #262's durable-effect
  features (+2 reactive-agent.ts / +32 act.ts) forced the attributed ledger edit —
  the designed friction, working.
- **#269 + #270 (Task 2):** `scripts/check-string-errors.sh` — `new Error(` pool pinned
  (299 capture; 300 after #262's +1 in-src site, attributed). Fixtures parse the ledger
  (no magic numbers).
- **Task 3 (same day):** the gate gained a twin ledger — `instanceof *Error` pool pinned
  at 129 occurrences (43 in runtime+reasoning alone), full site list committed at
  `wiki/Research/Audit-Reports-2026-10-22/instanceof-error-inventory.md`. This IS the
  Phase-2 rejection-identity blast radius, mapped before D3 converts anything.
  Fixtures 7 -> 11 cases, RED-first. Reasoning now 3,193/4todo/0fail/369 files.
- Peer landed **#262** (durable tool-effect records + crash-window resume) mid-program;
  it is the reason both ledgers needed their first edits.
- New giant files filed: #265 plan-execute (1,714), #266 event-bus (1,576), #267
  runtime.ts (1,540), #268 benchmarks/runner (1,599).
- Two CI-ops incidents fixed en route (lessons recorded in execute-backlog v26c +
  memory): `bun install --frozen-lockfile` drift from `bun-types` upstream patch
  killed every job at step 1 for ~2h — resync PR #264 (`66ca4f186`) unblocked;
  Docs Anti-Rot `metrics:check` requires `metrics:sync-readme` in ANY PR touching
  test-file counts.
- Current baselines (post-#262/#263/#269): runtime 1,679 pass / 7 skip / 0 fail
  (310 files); reasoning 3,189 pass / 4 todo / 0 fail (369 files). NOTE for next
  bundles: #262 changed these from the #217-#219 numbers; plan re-captured.

Next: Task 8 (D1 bridge family 2: judgment - apply the Task 6 template: shared runFacadeEffect bridge, defect-channel for incidental throws, shell-path identity pins; judge()'s rejection values must survive byte-for-byte), Task 9 (#222 iterate-pass+runner, kernel-warden), Tasks 10-11 (D1 families 3-4), Task 12 (seam breadth #260). Task 6 shipped (PR #274): skills facade Effect-typed; template findings: runPromise FiberFailure-wraps TYPED failures on effect@3.19 (bridge = catchAllDefect->either->Promise.reject, shared agent/run-facade-effect.ts); both self-gates caught the first iterations (file-size +37 shell growth -> shared module +4; string ratchet 304/130 -> defect fold, net-zero 300/129). Task 7 shipped (PR #275, #220 closed): arbitrator 1,970->850 via 10 verbatim decide/* modules, 31-name re-export shim, script-anchored regions inline per anchor audit.
`pr checks` (poll buckets instead); CI runs queue behind peer concurrency.

---

## 2026-10-20 (c) — #219 think.ts decomposition (execute-backlog)

Third bundle of the window. PR #258 merged (`6330bb92d`), #219 closed.

- `packages/reasoning/src/kernel/capabilities/reason/think.ts`
  **2,445 → 676 LOC** (−1,769; issue cited 2,135 at sweep time). NOT a class —
  one ~2,100-LOC `handleThinking`: decomposed as a 6-stage orchestrator with
  byte-stable signature contract; 10 verbatim modules in `capabilities/reason/`
  (dispatch-think-response 800 largest; helpers byte-identical). Canonical
  request core stays inline by design — grandfathered by enforcement scripts
  (check-projection / check-domain-only-fc / check-volatile-placement). 4th
  script (check-llm-gateway) PASS. kernel-warden via general subagent (0.95),
  verifier exact-baseline green (3,163/4todo/0/366; ceiling 2/2; 0 casts in
  think.ts+10 modules).
- Skill lesson (v26b): grep `scripts/check-*.sh` for the target file BEFORE
  writing a decomposition brief — pins dictate the carve-around. Single-function
  monoliths decompose as stage pipelines, not method facades.
- All three decomp wikis (#217/#218/#219) shipped this window confirm the rule:
  additions to big files land in submodules going forward.

Debrief: `wiki/Research/Debriefs/2026-10-20-reasoning-think-decomp-execution-debrief.md`.

Remaining decomp seeds now p2-only: #221 execution-engine (1,807), #220
arbitrator (1,908, 31 exports), #222 iterate-pass (1,734) + runner (1,703).

---

## 2026-10-20 (b) — #218 builder.ts decomposition (execute-backlog)

Second bundle of the day. PR #257 merged (`878461bac`), #218 closed.

- `packages/runtime/src/builder.ts` **3,348 → 2,222 LOC** (−1,126; was 3,081 at
  sweep time, regrown past its W26-B trim). Verbatim moves: `build()` →
  `builder/build/build-agent.ts` (258), `buildEffect()`+`warnIfImplicitTestProvider`
  → `builder/build/build-effect.ts` (333), 61 `with*` bodies → 7
  `builder/withers/*` family modules (65-247). Thin `applyWithX` delegates over
  per-call `asBuilderState(this)` views. Overloads verified identical
  (`withMCP` 5, `withHarness` 3, `withModel` 3, `withReactiveIntelligence` 3);
  surface bit-identical. runtime-warden via general subagent (0.92), verifier
  green (suite 1,677/7/0 exact baseline, ceiling flat, 0 new casts).
- **Extraction-boundary rule (added):** builder-decomp end-state is "zero
  surface change + LOC cap + zero behavior change", NOT "convert every method" —
  contract-coupled families (`withMCP` dispatch, `withOutputSchema` inline-cast
  return) and compile-time drift guards (`_assertRuntimeStateViewShape`) stay on
  the class by design.
- Builder additions henceforth go in `builder/*` modules, never the class file.
- Micro-debt: `BuilderState` view extended +17 comment-marked fields (live-read
  bag; class fields stay source of truth; drift partially guarded).

Debrief: `wiki/Research/Debriefs/2026-10-20-runtime-builder-decomp-execution-debrief.md`.

Next: #219 think.ts (2,135, kernel-warden) — the only remaining p1. Then p2
seeds #221/#220/#222.

---

## 2026-10-20 — #217 runtime decomposition + CI gates consolidation (execute-backlog)

Bundle: #217 single issue (HS-247). PR #255 (first) then PR #256 merged to `dev`
(merge `b72b302f9`). Main checkout is the live peer's (`dev`, switched 2026-10-19
20:23) — bundle work stayed in worktrees; do not check out branches there.

- #217: `packages/runtime/src/reactive-agent.ts` **3,303 → 2,338 LOC** via 4
  verbatim `agent/*` facades (judgment 350 / skills 181 / durable 459 /
  run-task-effect 547). Thin deps-object delegates; exports still 4; surface
  bit-identical. runtime-warden via general subagent (standing deviation).
  Verifier: typecheck 24/24, runtime suite 1,677/7/0 exact baseline ×3, cast
  ceiling 39 flat. Review 7/9 applicable categories; `JudgeInput` canonicalized
  on `agent/judgment-facade.ts` (`f8b1e604f`, removed type-only back-cycle).
- PR #255: `regression-gate.yml` rewritten — GitHub rejects `secrets` in ANY
  `if:` (runs 39347272779/39356471098), guard is now bash `env` + test. Phantom
  Regression Gate runs gone from every push.
- CI test flake root-caused (3 datapoints, 0 local): CI-only PHANTOM
  double-invocation of the shared-mock `fetchJsonTool` handler ate even (4) and
  odd (3, floater never completed) hit spans. Outcome-contract rewrite + exact
  one-retry pin on a `node:http` live server. **Do NOT re-add count/parity pins
  on shared mock closures; pin exact contracts on real in-process servers.**
- Docs: metrics-cache 10,428 snapshot; debrief
  `wiki/Research/Debriefs/2026-10-20-runtime-reactive-agent-decomp-execution-debrief.md`;
  plan `wiki/Planning/Implementation-Plans/2026-10-20-runtime-reactive-agent-decomp.md`.
- Micro-debt: `safeParseJson` duplicated in durable-facade + run-task-effect.

Next seeds: #218 builder.ts (3,081) · #219 think.ts (2,135) · #221
execution-engine.ts (1,807). Same warden flow: verbatim-move mandate, deps-object
delegates, verifier bar = exact-baseline suites + flat cast ceiling.

---

## 2026-10-19 — #238 gemini thought streaming + #240 closeout (execute-backlog, providers bundle)

Pass: SCAN (31 open) → #240+#238 picked → cross-package gate descoped → #240 found
ALREADY FIXED on dev (71a5d4f1, 2026-10-17 bundle never closed its issue → closed with
evidence comment) → #238 shipped as the code bundle.

- #238 fix: gemini stream loop no longer drops thought:true parts. Routes through the
  shared `thinking_delta` StreamEvent (parity with local/anthropic) + accumulates
  `content_complete.thinking`. Gate = model CAPABILITY (`resolveCapability`/supportsThinkingMode),
  NOT consent — Gemini's `thinkingBudget:0` is advisory (gemini-2.5-class can leak thought
  parts on non-opted-in streams), so the anthropic consent-gate shape would keep swallowing.
  Thought text never joins fullContent. `packages/llm-provider/src/providers/gemini.ts`
  (+31/-2), tests `gemini-stream-thinking.test.ts` (4 cases; 2 native-RED pre-fix).
- Verification: llm-provider 536 pass/0 fail (baseline 533), build green, typecheck green,
  cast-ceiling green.
- PR #253 open against dev (merge = human decision). Plan:
  wiki/Planning/Implementation-Plans/2026-10-19-providers-gemini-thought.md; retro:
  wiki/Research/Debriefs/2026-10-19-providers-gemini-thought-execution-debrief.md
- SCAN lesson (applied to M-SCAN in this skill): `git log --all --oneline --grep=<issue#>`
  before planning — GH issues can sit open after their fix merges to dev.

---

## 2026-10-17 — #240 classifier-skip gate (execute-backlog singleton bundle)

Executed `execute-backlog` on open issue #240 (area:reasoning, p3 chore). Grounded the premise
on `origin/main`: `adaptive.ts:219` and `decompose.ts:118` each call
`gatewayComplete({purpose:"classify"})` ungated; the `shouldSkipClassifierEvaluation` gate
primitive did NOT exist on this base (it lives only on `dev`, which is 174 commits ahead).
Created the shared primitive (`CLASSIFIER_SKIP_RELIABILITIES = ["low","skip"]` +
`shouldSkipClassifierEvaluation`) in `strategy-evaluator.ts` and gated both named sites.
Behavior for trusted/absent reliability unchanged.

Commit `71a5d4f1` on branch `bundle/reasoning-classifier-skip-gate` (off origin/main).
- reasoning suite: 2945 pass / 0 fail; typecheck green; cast ceiling green (0 new `as unknown as`)
- Tests: new `shouldSkipClassifierEvaluation` predicate cases; `shouldDecompose` classifierReliability
  cases; `adaptive-classifier-skip.test.ts` (low skips the LLM call with no classify response
  provided; high still consults the LLM)
- Not on this base: strategy-evaluator.ts's OWN classify call (line 165) remains ungated — a
  disclosed follow-up (already done on dev; needs calibration threaded from iterate-pass).
- Plan: wiki/Planning/Implementation-Plans/2026-10-17-reasoning-classifier-skip-gate.md

---

## 2026-10-15 — W567 live verdict captured (W5 PASS / W6 PASS / W7 PASS+gap)

Second true-0 capture (`fixtures/post-w567/`, 11 live + 5 spots, scoreboard
POST-W567 section): W5 honesty 0/11 fabricated (S1 3/3 abstain, S2 3/3 '3052',
terminate 3/3 abstain; S3 r2 under-claim filed — correct report.md on disk but
final-answer success=false on stale read tallies — safe direction, N=2, no
regression claimed); W6 spots 3/3 (gateway 0 exec, guardrail clean, timeoutAfter
386 ms); W7 tier1 checks present, shadow 0 events live (structural — site behind
unwired InteractionService; suites 8/8 green; non-gating). No-regression vs
post-w4-fixed HOLDS. Spot runner `scripts/lift/w567-spots.ts`. Report:
`.superpowers/sdd/.../w567-verdict-report.md`.

---
