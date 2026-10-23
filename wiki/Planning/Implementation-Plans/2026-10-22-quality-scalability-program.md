---
type: plan
status: active
created: 2026-10-22
tags: [quality-program, gates, decomposition, modernization-bridge, execute-backlog]
---

# Quality & Scalability Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: repo `execute-backlog` (bundle loop), `mission-brief` + `upward-report` (warden I/O), `agent-tdd` + `effect-ts-patterns` (implementation discipline), `review-patterns` (per-bundle review). Steps use checkbox (`- [ ]`) syntax; the plan file is the living tracker and gets updated in the same commit as each task's closeout.

**Goal:** Make the framework's structure self-enforcing: gates that prevent regrowth, decomposition completed for every giant file, seam-level tests, and a type-bridge that converts the public Promise boundary into a single thin layer so a later Effect/Context.Tag modernization becomes consumer rewiring rather than redesign.

**Architecture:** Three lock mechanisms ride the existing auto-globbed `scripts/check-*.sh` CI lane (file-size, string-errors, instanceof-error new-sites), shrink-only baselined exactly like `check-orphans.sh` and `console-ceiling.test.ts`. Decomposition bundles continue the #217/#218/#219 verbatim-move pattern under domain wardens. The bridge (Task 6/8/10/11) moves `runPromise` OUT of the extracted modules UP to the class shell so module functions return `Effect<A, E, R>` with precise error unions; public API stays Promise-identical.

**Tech Stack:** TypeScript, Effect 3.19, Bun ≥1.1, bash (CI scripts), turbo, GitHub Actions.

**Input artifact (no separate spec):** `wiki/Research/Audit-Reports-2026-10-22/decomposition-scale-audit.md` + user-approved design in-session 2026-10-22. Related issues: #259 (size ratchet), #260 (seam tests), #261 (hygiene), #220/#221/#222 (remaining giants).

## Global Constraints (every task inherits these)

- Behavior-neutral: no public API, signature, overload, rejection-identity, or event-shape changes anywhere in this plan. Every bundle verified against EXACT pre-bundle package-suite baselines.
- Effect-TS patterns per `CODING_STANDARDS.md` / `effect-ts-patterns`: no `throw` in new code, no `any` (test mocks exempt with comment), `Data.TaggedError` for anything minted new, `.js` extensions on all relative imports, kebab-case files, JSDoc on every exported symbol.
- New gates must be proven red-on-cut with a fixture test (precedent: `packages/reasoning/tests/kernel/ledger/declaration-orphans.test.ts`) and must fail vacuously on empty scan roots (precedent: `check-cross-cutting.sh` SCAN-EMPTY).
- Ratchet law: baselines may only SHRINK; a shrinking file failing the guard until the baseline edit is deliberate (same law as `check-orphans.sh`).
- Kernel Cat-9 rules: no per-turn logic in `kernel/loop/runner.ts` main loop; `(state, context)` phase signatures byte-stable; single termination owner untouched.
- Decomposition briefs MUST first grep `scripts/check-*.sh` for pins on the target file and name the carve-around in the MissionBrief (skill rule v26b, from #219).
- Warden routing per AGENTS.md team-ownership contract; scripts/tests work outside warden tables runs parent-direct with a pilot-log YAML entry (`warden: none (parent-direct)`).
- Isolated worktrees only (main checkout is user-owned); `ln -s` node_modules root + per-package before builds; commits with explicit paths only; no AI co-author trailers; `--timeout` flags on test runs; no piping long-running commands.
- Every bundle: `bun run build` + package suite + `as-unknown-as-ceiling` + PR to `dev` + CI 5/5 green + merge + branch/worktree cleanup + issue close + plan-tracker update.

## Review Focus (inputs no task's tests cover directly; each gets pinned in the owning task)

1. **Vacuous ratchet:** a ceiling script whose scan root matches nothing must FAIL, not pass silently (Task 1/2/3 fixtures).
2. **Shrink-only inversion:** a file that shrinks below baseline WITHOUT a baseline edit must fail (forces decomposition reviews to touch the ledger) (Task 1/2 fixtures).
3. **Rejection identity through the bridge:** after D1 conversion, a shell-level caller catching a rejection must receive the same value the pre-bridge code produced; fiber interruption must not appear where Promise rejection was observable (Tasks 6/8/10/11 pin tests).
4. **Overload/type surface:** any signature shrink that package tsc misses is caught by downstream turbo typecheck (mandatory gate on all D1 tasks).
5. **Warden-brief test-seam:** behavioral pins must hit the real module export, not a re-simulated copy (skill rule v18; Tasks 5/12).

---

## Phase A — Locks

### Task 1: File-size ratchet gate (`check-file-size.sh`) — closes #259

**Files:**
- Create: `scripts/check-file-size.sh`
- Create: `packages/reasoning/tests/enforcement-scripts-file-size.test.ts` (red-on-cut fixture, sibling to existing `enforcement-scripts.test.ts`)

**Interfaces:**
- Produces: `SIZE_BASELINE` associative array mapping `packages/**.ts` (non-test) path → integer ceiling. CI lane auto-globs it (`ci.yml:85` loop); `enforcement-scripts.test.ts` discovers it automatically.

- [x] **Step 1: Capture baseline** — `find packages/*/src -name '*.ts' ! -name '*.test.ts' | xargs wc -l` filtered `>=1000`; 23 files pinned at their exact current values (2,338 reactive-agent.ts … 1,046 console-exporter.ts). Type-declaration files (`*/types.ts`, `runtime-types.ts`) are pinned but marked `# type-file: shrink allowed, decomposition not required` in the array comment.
- [x] **Step 2: Write failing fixture** — fixture runs the script against a temp tree copy where one baselined file grew +1 line: expect exit 1; where a baselined file shrank 10 lines with no baseline edit: expect exit 1 (shrink-only law); where scan root is empty: expect exit 1 (SCAN-EMPTY). Run: `bun test packages/reasoning/tests/enforcement-scripts-file-size.test.ts --timeout 30000`. Verify RED before implementing.
- [x] **Step 3: Implement script** — bash, POSIX-safe, no process substitution beyond bashisms already used by `check-orphans.sh`; counts via `wc -l`; error format `::error:: <path> LOC <n> > ceiling <cap>` (or shrink variant). Exit 0 green.
- [x] **Step 4: Green fixture + real run** — fixture PASS; `bash scripts/check-file-size.sh` PASS on real tree.
- [x] **Step 5: Full gates** — `bun run build`, `bunx turbo run typecheck` unaffected; commit, PR → dev, CI green, merge, close #259, pilot-log entry (parent-direct).
- [x] **Step 6: File the untracked giants** (design item B4) — create issues for `strategies/plan-execute.ts` (1,714), `core/services/event-bus.ts` (1,576), `runtime.ts` (1,540), `benchmarks/runner.ts` (1,599) using the HS template (LOC, exports count, package precedent); label `type:chore,priority:p2,health-sweep`. Bundling deferred — the ratchet already contains them.

### Task 2: String-errors ceiling ratchet (`check-string-errors.sh`)

**Files:**
- Create: `scripts/check-string-errors.sh`
- Create: `packages/reasoning/tests/enforcement-scripts-string-errors.test.ts`

**Interfaces:**
- Produces: count of `new Error(` occurrences in `packages/*/src/**/*.ts` excluding `*.test.ts` and `*_` comment-stripped lines is NOT required; metric = plain `grep -rEn "new Error\("` on non-test src files (comments count; documented honestly — same tradeoff `console-ceiling` avoided by AST; text metric chosen for bash portability, comment inflation documented in header).

- [x] **Step 1: Pin baseline** — measured 2026-10-22: **299** (raised to 300 same day: +1 in-src site from #262 08458a4f3, attributed ledger edit, PR #270). Script header records date + value + the metric definition.
- [x] **Step 2: Failing fixture** — copy a src file into fixture temp tree with +1 `new Error(` (expect red); −1 without baseline edit (expect red, shrink-only); empty root (expect red).
- [x] **Step 3: Implement** — same skeleton as Task 1 script.
- [x] **Step 4: Green + merge** — full gate cycle as Task 1; issue: create `ci: string-errors ceiling ratchet` on the fly (p1, area:harness) and close it in the PR.

### Task 3: `instanceof Error` inventory + new-sites gate

**Files:**
- Modify: `scripts/check-string-errors.sh` (add second counter)
- Modify: `wiki/Architecture/DEBT-REGISTER.md` (inventory table appended)
- Test: extend Task 2 fixture file.

**Interfaces:**
- Produces: second shrink-only baseline: `grep -rEn "instanceof (Error|[A-Za-z]*Error)"` across `packages/*/src` non-test (measure full-repo; runtime+reasoning alone = 43). Inventory table lists every site + one-line identity classification (framework-internal catch vs public-facing rejection path).

- [x] **Step 1: Produce inventory** — DEVIATION (recorded): shipped as a dedicated artifact `wiki/Research/Audit-Reports-2026-10-22/instanceof-error-inventory.md` (129 sites + per-file distribution + Phase-2 relevance) referenced from the DEBT-REGISTER §6 row, instead of a §5 subsection — keeps the 585-line register slim and puts the full list beside the audit that demanded it.
- [x] **Step 2: Gate the count** — `INSTANCEOF_BASELINE=129` occurrences twin ledger in check-string-errors.sh (collect-FAIL dual verdict); fixtures 7 -> 11 cases (both ledgers patched + parsed, grow/shrink/edit-pass/test-exempt per counter).
- [x] **Step 3: Full gate cycle + merge.** No site conversions in this task (conversions ride D3). Measured: real tree 300/129 green; 11/11 fixtures; lane 24/24; reasoning suite 3,193 pass / 4 todo / 0 fail / 369 files; tsc rc=0.

## Phase B — Structural completion (warden bundles)

### Task 4: #221 `execution-engine.ts` decomposition (runtime-warden)

- [x] **Step 1: Pre-brief pin check** — done: only `check-file-size.sh` references execution-engine.ts (its ceiling, not a carve-around pin). — `grep -l execution-engine scripts/check-*.sh` → name any pins in the MissionBrief (v26b rule).
- [x] **Step 2: Baseline** — runtime 1,679/7/0/310 files; execution-engine.ts measured 1,976 (issue cite 1,807 — regrown). — runtime suite exact numbers; execution-engine.ts LOC (1,976; note regrowth from issue's 1,807).
- [x] **Step 3: Dispatch** — runtime-warden completed 0.92, retries 0/2: 1,976 -> 991 LOC via 11 verbatim engine/execute-* modules; tag/interface/Live export bit-identical; inline-retentions documented. MissionBrief: end-state LOC ≤1,200, verbatim stage/cluster moves into `engine/*` following the W24 bootstrap/finalize precedent; surface bit-identical; zero new casts; success-criteria = exact baseline + `check-file-size.sh` shrink + ceiling test flat. Retries 2.
- [x] **Step 4: Parent verifier** — tsc rc=0 + downstream 29/29; suite exact baseline; ceiling 2/2 (0 casts in new modules); zero new throw/as-any; .js imports; verbatim line-set proof 0 divergences. (typecheck, suite, ceiling, scope, review-patterns). 
- [x] **Step 5: PR → CI → merge → close #221 → baseline edit in check-file-size.sh (shrink law) → pilot log → debrief.** Update this plan's tracker section in the closeout commit.

### Task 5: Seam-test seeds (#260 partial)

**Files:** Create `packages/runtime/tests/seam-builder-withers.test.ts`, `packages/runtime/tests/seam-agent-facade.test.ts`, `packages/reasoning/tests/kernel/seam-think-stage.test.ts`.

- [x] **Step 1: One direct-import behavioral pin per family** — SHIPPED (PR #273): seam-builder-withers (4 pins incl. #9 invariant + chaining identity), seam-agent-skills-facade (3 pins, array-identity pass-through + wiring spy, zero-cast ManagedRuntime stubbing via GenericTag key interning), seam-resolve-think-surface (pressure-gate refuse + narrow contrast arms, stage composed directly for the first time). — withers: call `applyWithBudget` on a state view constructed from the real builder, assert slot writes + chaining semantics observable through the view; facade: call one `agent/*` export with a minimal deps object, assert outcome without instantiating `ReactiveAgent`; think stage: call `resolveThinkToolSurface` with a required-tools-pending + pressure-critical fixture, assert the gate REFUSES to narrow (subtlest logic). Review-Focus #5 applies: real exports only.
- [x] **Step 2: RED-on-cut spot-check** — PROVEN all three: forced spend-object reds the withers invariant; renamed store tag key reds pass-through+resilience; short-circuited pressureCritical reddens ONLY the contrast arm (refuse arm independence confirmed); sources restored clean. for each pin (mutate the guarded behavior in a temp copy; test goes red; restore clean diff) — per v21 precedent.
- [x] **Step 3: Full gate cycle + merge (PR #273); #260 stays open** (breadth in Task 12). BONUS discharged in same branch: 17 emitErrorSwallowed site strings re-anchored to true files (Task 4 follow-up; grep-verified no test pinned stale strings; agent-loop W23 files' own convention untouched). (breadth comes in Task 12).

### Task 6: D1 bridge, family 1: `agent/skills-facade.ts` Effect-ization

**Interfaces:**
- Consumes: existing `SkillsFacadeDeps` object surface (4 public functions behind `agent/skills-facade.ts`).
- Produces: the pattern for every D1 family. Each module function changes from `Promise<A>`-returning (with `runPromise` calls inside the body) to `Effect.Effect<A, E, never>`-returning, where `E` is the exact union of errors the body can produce; when the body currently fails with a raw `Error` that only framework-internal code inspects, mint `class <Domain>Error extends Data.TaggedError("<Domain>Error")<{ readonly message: string }>` in the same file (D3 may convert more later; this task converts only what the structural change forces). The class-shell method becomes the ONLY `deps.runtime.runPromise(...)` call site for the family. Public methods keep `async`, the same resolved value, the same rejection value (Review-Focus #3), the same EventBus emissions.

- [x] **Step 1: Baseline pin test** — #273 seam pins were the swap-net (three assertions kept semantically identical through the conversion). — extend Task 5 facade seam test with skills-family success + failure outcomes recorded pre-conversion (value-identity assertions).
- [x] **Step 2: Convert** — done via defect channel (see template finding below): incidental throws/rejections -> Effect.sync/Effect.promise defects carrying the ORIGINAL value; E = only the two deliberate rejections (byte-identical messages); the loadSkill inner runPromise stays for FiberFailure-value identity; shell bridge lives in the SHARED agent/run-facade-effect.ts. module body to `Effect.gen` composition, removing intermediate `runPromise` calls; keep body statements verbatim-equivalent (this is a re-expression, not a rewrite: each `await x.runPromise(e)` becomes `yield* e` against the same runtime handle; where a global `Effect.runPromise` was used mid-body, it becomes `yield*` in the existing fiber context and MUST be noted in the commit body if the fiber-parent changes — that is the only semantic risk).
- [x] **Step 3: Verify** — tsc rc=0; ratchets exactly 300/129 (net-zero); seam 5/5 incl. TWO new shell-path identity pins; runtime suite Ran 1,695 = baseline + 2 pins exact; full check-*.sh lane green; merged PR #274. — seam pin test PASS byte-identical outcomes; runtime suite exact baseline; tsc rc=0; downstream turbo typecheck (Review-Focus #4); ceiling + Task 1/2/3 scripts green; commit/PR/CI/merge; plan tracker update.

### Task 7: #220 `arbitrator.ts` decomposition (kernel-warden) — SHIPPED (PR #275, #220 closed)

Same protocol as Task 4. Result: 1,970 -> 850 LOC, 10 verbatim decide/* modules + 31-name re-export shim; every script-anchored region stayed inline (anchor audit in the PR + pilot log); six enforcement scripts green; reasoning suite 3,195/4todo/0 exact; ceiling 2/2; file-size ledger shrunk as its own commit. Pre-brief: grep check-* pins; single-termination-owner invariant named in authority-bounds out-of-scope. End-state ≤1,200 LOC, 31 exports re-homed behind the same import path. Baseline edit follows.

### Task 8: D1 bridge, family 2: `agent/judgment-facade.ts`

Same protocol as Task 6. Special: judge body's `Effect.fail(new Error('agent.judge() requires .withJudgment()...'))` sites — DO NOT retag here (public rejection identity); convert only the runPromise structure. Tagging is D3's job once Task 3's inventory classifies consumers.

### Task 9: #222 `iterate-pass.ts` + `runner.ts` decomposition (kernel-warden)

Same protocol. Cat-9 hard rule restated in the brief: `kernel/loop/runner.ts` main loop may only gain pure delegate lines; every extracted stage into `kernel/loop/*` modules with `(state, context)`-style signatures preserved.

### Task 10: D1 bridge, family 3: `agent/durable-facade.ts`

Same protocol as Task 6. Mixed-boundary note: durable body uses BOTH `deps.runtime.runPromise` and global `Effect.runPromise` (7 sites) — each global→`yield*` conversion is a fiber-parent change and must be individually justified in the commit body + flagged in the upward seam test (Review-Focus #3).

### Task 11: D1 bridge, family 4: `agent/run-task-effect.ts`

Same protocol; largest family (547 LOC). If fiber-parent changes cannot be proven identity-safe by tests, STOP that site, keep it as `runPromise` in the module, document the exception, and continue — no forced conversions.

### Task 12: Seam-test breadth (#260 closes)

- [ ] Direct-import pin per remaining shipped family (durable, run-task, build/*, all withers families, think stages not yet seeded); RED-on-cut spot-check per v21; close #260.

### Task 13: D2 hygiene (#261 closes)

- [ ] `ManagedRuntime<any, never>` → precise R unions in the three deps interfaces; `safeParseJson` internalized at `agent/_json.ts`; withers `BuilderState` drift guard (extend `_assertRuntimeStateViewShape` pattern). Zero behavior change; exact-baseline cycle; close #261.

### Task 14: D3 internal error tagging

- [ ] Using the Task 3 inventory, convert framework-internal-only catch sites from string `new Error` to `Data.TaggedError` (new classes ride existing `errors.ts` unions), one package per commit, riding Task 2's ratchet down. Public-identity sites are NOT touched in Phase 1. Target: string-count strictly below 299 and dropping; every conversion covered by the site's existing test + a `_tag` assertion.

### Task 15: Phase-2 readiness checkpoint (deliverable: decision doc, no code)

- [ ] With Tasks 1-14 shipped: write `wiki/Architecture/Design-Specs/2026-XX-XX-effect-facade-modernization-readiness.md` — remaining blast radius (instanceof public sites, docs/examples counts), per-family Effect seam inventory, service-tag candidates from D4, and the semver decision. Gates for that phase: ablation lift rule + ≥2-tier probe before any default-on mechanism ships.

---

## Verification Protocol (cross-cutting, every task)

- Package suite at EXACT recorded baseline (post-#262/#263/#269/#270: runtime 1,679/7/0/310 files; reasoning 3,189/4/0/369 files; others recorded at task start — the #217-era 1,677/309 and #219-era 3,163/366 numbers are retired, durable-effect work moved them)
- `bunx tsc --noEmit -p <pkg>` rc=0; downstream turbo typecheck for anything touching builder/agent surfaces
- `as-unknown-as-ceiling` 2/2, counts flat
- `bash scripts/check-file-size.sh` + `check-string-errors.sh` green (or with committed shrink edits)
- PR → CI 5/5 → merge dev → delete branch + worktree → close issue → pilot-log YAML → this file's Execution Log updated

## Execution Log

- 2026-10-22: Plan created (approved design, spec stage waived by user). Awaiting go.
- 2026-10-22: **Task 1 SHIPPED** (PR #263, closed #259): `check-file-size.sh` 24-file shrink-only ledger + 9-case red-on-cut fixture. Review finding caught pre-merge and fixed: ledger-size floor removed (a floor would fail exactly when decompositions land). Gate earned keep same day: forced attributed edits for #262 feature growth (+2 reactive-agent.ts, +32 act.ts). Step 6 done: giants filed #265/#266/#267/#268.
- 2026-10-22: **Task 2 SHIPPED** (PR #269 + ledger fix PR #270, both merged): `check-string-errors.sh` pool pinned 300 (299 capture; +1 attributed #262 in-src site), 7 fixtures, echo-test parses the ledger (no magic numbers survives legitimate edits).
- 2026-10-22: **Incidents resolved en route** (lessons in execute-backlog v26c/v26d + MEMORY): (a) frozen-lockfile drift (bun-types 1.4.3→1.4.4) killed every job at step 1 ~2h — resync PR #264 + rebases; (b) `metrics:check` requires `metrics:sync-readme` in any PR touching test-file counts — README sync commits added to #263/#269, re-synced after dependency merges; (c) docs-sync `capabilities-manifest` drift from #262 (act.ts touched, CAPABILITIES.md untouched) is tree-wide and blocked #270 — audited honestly (registry parity green, #262 registered no handler), sanctioned `--ack` re-baseline shipped as its own commit d43f4a25f.
- 2026-10-22: **Baselines re-measured post-A2** (replaces #217/#219-era numbers throughout): runtime 1,679 pass / 7 skip / 0 fail / 310 files; reasoning 3,189 pass / 4 todo / 0 fail / 369 files; `check-string-errors` 300/300; `check-file-size` 24 entries at ceiling; enforcement lane 24/24.
- 2026-10-22: **Task 3 SHIPPED** (PR #271): twin `INSTANCEOF_BASELINE=129` ledger + inventory artifact (`wiki/Research/Audit-Reports-2026-10-22/instanceof-error-inventory.md`); fixtures 11 cases; reasoning 3,193/4todo/0/369.
- 2026-10-22: **Task 4 SHIPPED** (PR #272, closes #221): execution-engine.ts 1,976→991 via 11 verbatim `engine/execute-*` modules (runtime-warden 0.92, retries 0/2). First decomposition landed WITH its lock: ceiling shrunk 1976→991 as a deliberate-ledger commit ordered after the refactor commit (bisect-clean). Debrief: `wiki/Research/Debriefs/2026-10-22-runtime-engine-decomp-execution-debrief.md`. Follow-up captured: emitErrorSwallowed site-string re-anchoring tranche rides Task 5.
- 2026-10-22: **Task 5 SHIPPED** (PR #273): 3 seam files (7 pins, 0 casts), RED-on-cut all proven, site-string re-anchor tranche (17 sites), README metrics +3 files. runtime 1,693/0 fail; reasoning 3,199/0 fail.
- 2026-10-23: **Task 9 SHIPPED** (PR #277, closes #222): runner.ts 1,903->953 + iterate-pass.ts 1,896->1,266 via 14 verbatim kernel/loop seam modules; seven content-anchored scripts green UNEDITED (anchor audit governed placement — main-loop spine Cat-9, all counter writes, policy/contract/control-plane seams, every terminal WRITE site stayed inline; single-termination-owner + loop-detector untouched); 10 documented break/continue->driver-honored returned-flag adapters per existing precedent; export census net-zero via shims; suite 3,195/4/0/370 exact; ceilings shrunk 1903->953 / 1896->1266 as deliberate ledger commits with edit-history. ALL >=1,500-LOC files in runtime+reasoning are now decomposed or pinned shells.
- 2026-10-23: **Task 10 SHIPPED** (PR #278 merged): D1 bridge family 3 (durable facade). Identity audit: 17/17 inner boundaries caller-observable -> ALL preserved via Effect.promise wrapping, zero folds, zero fiber-parent changes; getDurableInfo kept sync (accepted deviation, pure accessor); deliberate arms raw pre-bridge (no wrapped->raw delta this family); template empirics refined (FiberFailure cause identity lives in .name). Ratchets exactly 300/129; shell net-zero; suite Ran 1,702 = pristine + 3 shell-path pins exact; README synced in-branch.
- 2026-10-23: **Task 11 SHIPPED** (PR #279 merged — **D1 COMPLETE**): D1 bridge family 4 (run-task-effect) — buildRunTaskEffect was ALREADY Effect-native at the seam since #217; the boundary audit converted 2 sections (debrief-fiber join + dispose tracker — both discard every rejection arm by construction, so raw-vs-wrapper identity unobservable) through the shared bridge, PRESERVED the receipt-signing boundary, and KEPT 3 awaits under the STOP rule with per-site documentation (killswitch AbortSignal — bridge can't carry options; runDurable pipeline await — #278's shipped wrapper-identity contract; runEffect — already Effect-typed seam, inner round-trip preserves its historical wrapper instance). Shell diff-zero. 4 new deterministic seam pins + README sync. Suite Ran 1,706 = baseline + 4 exact. **D1 COMPLETE at merge: all four facade families Effect-native at the module boundary, one Promise boundary per family in the shell — Task 15's precondition.**
- NEXT: Task 12 (seam breadth #260 — remaining families: durable/run-task/judgment/skills breadth + withers + build/*), Tasks 13-14 (D2 hygiene #261, D3 internal error tagging riding the 300-ratchet + Task 3 inventory), Task 15 (Phase-2 readiness checkpoint).
