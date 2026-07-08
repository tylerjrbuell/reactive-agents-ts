# 06 — Direction Coherence Under New Requirements (A) Deliverable Truth + (B) Long-Horizon (2026-07-08)

**Mandate:** verify the ratified adaptive-harness direction ([[../../Decisions/2026-07-07-adaptive-harness-architecture-ratified|decision]], [[../../Architecture/Design-Specs/2026-07-07-ideal-harness-architecture|9-pillar spec]], [[../../Planning/Implementation-Plans/2026-07-07-adaptive-harness-overhaul|7-phase plan]], Phases 1–3 SHIPPED incl. terminal gate `3e2d3876`) still holds under two NEW first-class requirements (user, 2026-07-08):

- **(A) Deliverable truth** — the harness must KNOW what has and hasn't been delivered, feeding the evidence ledger.
- **(B) Goal-driven long-horizon capability** — research-class tasks: many tool calls, long context gathering, budget-aware pacing, without fast-response/nudge tuning killing them.

**Method:** read-only audit of the 4 direction docs + North Star v6.0 + efficiency-sweep synthesis + capability-gap synthesis, grounded against shipped code (`terminal-gate.ts`, `check-llm-gateway.sh`, `check-termination-paths.sh`, `post-conditions.ts`, `task-classification.ts`, bench task defs, loop tuning defaults).

**Verdict up front: CONTINUE — the plan absorbs both requirements with named amendments (§5). No pillar reordering needed. But (B) exposes one structural blind spot the plan cannot self-detect: the bench that gates every phase has NO long-horizon task class, so the selection pressure itself is biased toward fast convergence. That must be fixed BEFORE Phase 4's merge gate, not after.**

---

## 1. Coverage matrix

### (A) Deliverable truth — 8 sub-capabilities

| # | Sub-capability | Coverage | Where / evidence |
|---|---|---|---|
| A1 | **Deliverable contract declaration** (what SHOULD exist at the end: artifacts, answer requirements) | **PARTIAL** | Three fragments, none unified: `requiredTools` ALL-OF contract (terminal-gate.ts:75 — tool-level, not deliverable-level); `artifactProduced(path)` post-conditions (`kernel/capabilities/verify/post-conditions.ts:65`); plan-execute requirement decomposition (wave-2 "Reqs" fix, capability-gap synthesis). No first-class `DeliverableContract` type spanning strategies. Phase 4 §1 entry types (tool-invocation, claim, verdict, harness-signal, compaction-marker, checkpoint-marker) do NOT include a `deliverable` entry. |
| A2 | **Artifact existence verification (live, deterministic)** | **PARTIAL → MISS on live path** | `post-conditions.ts` judges from the run LEDGER, "NOT from the real filesystem" (its own comment, line 24) — a claimed file-write satisfies it even if the write silently failed downstream. Pillar 7 (spec §7) admits: "Deterministic-verifier-first exists only in the bench (trustworthy-docs), not the live loop." |
| A3 | **Claim→evidence provenance** | **COVERED (planned)** | Phase 4 §1-2 (claim + verdict entries; receipts/honesty labels as queries); North Star §4.3 receipt ("which tool call grounded which claim"). Not yet built — Phase 4 is next. |
| A4 | **Requirement coverage at terminal** | **PARTIAL (shipped, wrong semantics for A)** | Phase 3 terminal gate coverage check SHIPPED (`terminal-gate.ts:174-196`). But documented divergence (b): kernel counts a required tool covered when **ATTEMPTED** (`toolsUsed` written before execution, act.ts:808) — attempted ≠ delivered. Fine for grounding; wrong as deliverable truth. |
| A5 | **Honest labeling of non-delivery** (abstention, ungrounded-delivery marks) | **COVERED** | Abstention first-class terminal in all strategies (Phase 3 §3, shipped); harness give-up terminals get receipt-level "ungrounded delivery" mark (North Star §4.3); `coverageExhaustionPolicy: "abstain"` (terminal-gate.ts:100). |
| A6 | **Mid-run delivery progress tracking** | **PARTIAL** | P6a todo/checklist meta-tool SHIPPED opt-in (`.withMetaTools({todo:true})`, capability-gap synthesis wave 3) — but it is model-maintained state, not tied to the deliverable contract or verified by the ledger. |
| A7 | **Ledger as the record of delivered facts** | **PARTIAL (planned)** | Phase 4 is exactly the right substrate ("post-conditions already calls steps[] 'the run LEDGER'" — sweep §B2), but delivery status would be *derivable*, not *first-class*. Requirement (A) says the harness must KNOW — that needs a queryable deliverable projection, not an inference. |
| A8 | **User-facing exposure** (`result.receipt`, `if (!receipt.grounded)`) | **COVERED (shipped)** | Arc 1 executed + merged (`3c9c15fa`): receipt + signing + replay live; North Star §4.3 graded-evidence discipline binding. Receipt lacks a per-deliverable manifest field — inherits A1/A7 gap. |

### (B) Goal-driven long-horizon — 9 sub-capabilities

| # | Sub-capability | Coverage | Where / evidence |
|---|---|---|---|
| B1 | **Horizon-scaled iteration budgets** | **PARTIAL** | Defaults tuned short: context-profile maxIterations 8–12 (`context-profile.ts:84-119`), config default 10. Phase 6 HarnessPlan sets budgets — but its task-classification input has NO horizon axis (see B2). |
| B2 | **Task classification recognizes long-horizon** | **MISS** | `task-classification.ts` vocabulary = complexity (trivial/moderate/complex) + intent + shape. No research/long-horizon class → the policy compiler (Phase 6 §2) cannot compile a long-horizon profile even in principle. |
| B3 | **Nudge/guard profiles safe for long gathering** | **PARTIAL** | `maxConsecutiveThoughts = 3` (runner.ts:343); loop-detector `maxSameTool`/`maxRepeatedThought` are **absolute counts** — over a 60-iteration research run, legitimate repeated searching (pagination, per-entity queries) reads as a loop. ICS urgency fires at ≤2 iterations left (`ics-coordinator.ts:63`) — with default cap 10 that's 20% of the run spent in "wrap up now" mode. Phase 6 §1 includes "guard thresholds" in HarnessPlan → mechanism exists, profile absent. |
| B4 | **Context capacity over long gathering (compaction)** | **COVERED (planned, Phase 4 §5)** | Single compaction path, protected classes, post-compaction self-check, ledger-backed lossless re-projection — precisely the long-horizon mechanism. Acceptance criteria lack a *scale* test (100+ tool results; recall of iteration-10 evidence at iteration 80). P6c-e open. |
| B5 | **Many tools visible across a long run** | **COVERED (shipped)** | Phase 2 tool-surface resolver + property-tested invariants (`required ⊆ visible`, meta floor) killed the rw-9 visibility-loss class (`c102489a`). |
| B6 | **Sub-goal decomposition + long-horizon progress structure** | **PARTIAL** | Plan type locked in plan-execute (A4 finding); todo meta-tool opt-in; Phase 7 makes planning a policy of the one loop. No milestone/goal-tree primitive tied to ledger verdicts. |
| B7 | **Mid-run recomposition on evidence** | **COVERED (planned)** | Phase 6 §3 recompile-mid-run ("repeated failure → deepen scaffold; clean trajectory → stay lean") — the right shape for pacing a long run. |
| B8 | **Long-run durability** (checkpoint/resume/crash) | **COVERED (shipped)** | Durable rail (North Star §2.4), Phase 4 checkpoint-marker entries, Arc 1 inspect/fork/replay. |
| B9 | **Bench evidence for long-horizon** | **MISS — the structural one** | `packages/benchmarks/src/tasks/real-world.ts`: per-task maxIterations = {20,15,15,15,20,15,25,25,15,10,8,5,5} — nothing requires >25 iterations *by design*. Every fix wave, every `rax eval gate` verdict, and Phase 6's acceptance test (`ra-adaptive ≥ max(ra-minimal, ra-full)` on rw tasks) select for fast convergence. A nudge that kills 60-iteration research runs is **invisible to the entire evidence loop**. |
| B10 | **Budget enforcement graded for long runs** | **PARTIAL → Phase 5** | Sweep Disease 1: budget guard fires ONLY on arbitrator exits — stall/loop/oracle terminations bypass it. Phase 5 makes budget a proposal actor (covered); pacing *signals to the model* (fraction-of-budget consumed) exist only as `iterationsRemaining` (think.ts:1172) end-game urgency. |

**Matrix summary:** (A) = 3 covered / 5 partial / 0 hard-miss — the ledger direction is correct, but deliverable truth needs to be a *first-class entry type + live deterministic verification*, not a derivable inference over attempted tool calls. (B) = 4 covered / 3 partial / **2 misses (B2 horizon class, B9 bench blindness)** — and B9 undermines the plan's own verification discipline for everything else in (B).

---

## 2. Sequencing check — is Phase 4 still the right next move?

**Yes — Phase 4 (ledger) remains the correct next structural move, for BOTH requirements:**

- (A) depends on the ledger directly: claim/verdict entries, receipt-as-query, honesty-label merge (sweep §D Phase 4 row) are the substrate deliverable truth projects from. Building deliverable tracking before the ledger would create another parallel record — the exact Disease-2 pattern the plan exists to kill.
- (B)'s binding constraint for long context gathering is compaction, and the plan already folds compaction into Phase 4 §5 (ledger-backed re-projection, protected classes, shrink self-check). Long horizons are *enabled* by the ledger, not blocked by it.

**But two (B) items are cheaper AND must land BEFORE Phase 4's merge gate:**

1. **The long-horizon bench task (lh-1) is a measurement instrument, not a feature.** It does not depend on ledger evidence — it *produces* the evidence every subsequent phase gate needs. Phase 4 is "the big one" (plan effort table: L) and rewires compaction; merging it through a gate that cannot see long-horizon regressions is exactly the trap re-run #1 fell into with visibility (grounding contract ≠ visibility floor — "incidental coverage" discovered only because the bench happened to exercise it). Days of work; do it first.
2. **Horizon-aware guard scaling** (loop-detector thresholds and ICS urgency as *fractions of maxIterations* rather than absolute counts) is a small parameterization with no ledger dependency. It can ship any time — but it is **unverifiable until lh-1 exists**, so the ordering is: lh-1 → guard scaling → Phase 4 gate includes lh-1.

Everything else in (B) — horizon task class (B2), pacing profiles, per-class lift evaluation — correctly lands in Phase 6 (policy compiler), which the plan already sequences after 2+3+4. No reordering of pillars/phases required. Insert a **Phase 3.5** (see §5).

---

## 3. Contradiction hunt — where plan assumptions conflict with (A)/(B)

1. **The bench gates everything, and the bench is horizon-blind (the big one).** Execution rule: "full-session bench + `rax eval gate` + ledger entry before merge-to-default." All 13 rw tasks cap at ≤25 iterations. Phase 6 acceptance (`plan §6.4`) is defined *entirely* over this bench. The plan's own selection pressure therefore optimizes for the failure mode (B) names: fast-response tuning. The rw-2 pattern is already suggestive — the surviving red-herring failure is an analysis-depth task where more gathering/deliberation would help, and it has stayed red through three fix waves that moved every execution task.
2. **The lift rule's ≤15% token-overhead bar structurally rejects long-horizon machinery.** Re-run #2: +20.8pp lift ruled OPT-IN at 640% token overhead; re-run #3 same shape. Any mechanism that succeeds *by gathering more evidence* raises tokens by design. Evaluated on short tasks in aggregate, long-horizon capability can never pass default-on. The rule needs per-task-class evaluation (or a cost-per-success form) once lh tasks exist — otherwise Phase 6's compiler will learn "lean is always better" from a biased corpus.
3. **"Efficient = no dead exchanges" (decision doc axis 3; A2's 113k wasted-token finding) vs research work where exploratory dead-ends ARE the work.** A ledger that classifies every non-contributing exchange as waste will mislabel legitimate exploration. The ledger needs to distinguish *retry-failure waste* (byte-identical retries — genuinely dead) from *exploration* (novel queries that returned nothing useful). Without that tag, Phase 6's mid-run recompiler ("clean trajectory → stay lean") reads a healthy research trajectory as a dirty one.
4. **Phase 5 single-action-per-iteration vs long gathering stretches.** One resolved control action per iteration is fine — but the loop-detector's *inputs* are absolute repeat counts. In a 60-iteration run the detector will (correctly, per its tuning) propose switch/stop during legitimate sustained gathering, and under the documented total order it competes every iteration. The P5 regression test (plan §5) covers abstain-vs-switch racing but has NO false-positive case for legitimate repetition at horizon. Proposals need horizon-normalized inputs, not just ordered resolution.
5. **Terminal-gate coverage semantics contradict deliverable truth.** Divergence (b) (terminal-gate.ts:26-35): kernel accepts ATTEMPTED as covered. Under (A) the gate's "coverage" check can pass while nothing was delivered; the PostCondition spine (the actual "deliverable-existence authority", terminal-gate.ts:14-16) verifies from ledger claims, not the filesystem (post-conditions.ts:24). Two soft layers stack where (A) demands one hard one.
6. **ICS urgency + oracle nudge assume short runs.** Urgency at ≤2 iterations remaining is 20% of a default-10 run but appropriate; at maxIterations 60 it's fine — the contradiction is that defaults (8–12) were tuned on the same short bench, and nothing in Phases 4–7 revisits them as horizon functions. Phase 6 HarnessPlan must own them.
7. **One-shot redirect budgets at horizon.** `redirectsSpent` grounding/coverage budgets are 1 for the *whole run* (terminal-gate.ts:90-94). Reasonable at 10 iterations; at 60+, a single early spent redirect leaves the entire back half of the run ungated. Minor, but Phase 6 should make redirect budgets plan-compiled, not constant.
8. **Doc drift already flagged and still relevant:** Decision Index still names North Star v3.0 as arbiter (sweep §A7) — with two new first-class requirements arriving by user fiat, the amendment trail must be clean or the next audit re-litigates this one.

---

## 4. Durability — invariants and enforcement scripts

**The pattern that works:** grep-able single-owner invariants enforced by CI shell scripts. Shipped: `scripts/check-llm-gateway.sh` (zero raw `.complete(`/`.stream(` outside `kernel/llm-gateway.ts` — Phase 1) and `scripts/check-termination-paths.sh` (zero `status:"done"` outside terminate/arbitrator + zero gate-decision literals outside `terminal-gate.ts` — Phase 3, already extended per plan §3.4). These survive personnel/session churn because they fail loudly at the exact regression site. **Phases 2 and 4–7 have no equivalent** (Phase 2 has property tests, which verify the resolver's internal logic but do not stop a new call site from bypassing the resolver).

Proposed, one per remaining (or unguarded) phase:

| Phase | Script | Grep invariant |
|---|---|---|
| 2 (retrofit) | `check-tool-surface.sh` | Zero reads of `allowedTools`/`focusedTools`/`forbiddenTools`/lazy-disclosure state outside the tool-surface resolver module; zero calls to legacy `computePromptSchemas`/`buildToolSchemas` outside it. |
| 4 Ledger | `check-ledger-writes.sh` | Zero direct `state.steps.push(`/scratchpad `Ref.update(` writes outside the RunLedger module — every fact enters via `ledger.append(`; zero readers of raw `steps[]` in packages that should consume projections (curator, receipts, finalize). |
| 5 Control plane | `check-control-plane.sh` | Formalize the plan's own exit criterion ("grep-zero direct control-flow mutation outside the resolver"): zero dispatcher-patch application / strategy-switch / `pendingGuidance` writes outside the resolver; control actors export `propose*` functions only. |
| 6 Policy compiler | `check-policy-compiler.sh` | Zero reads of capability table / calibration / `profile.thinkingModel` / tier tables at composition time outside the compiler; every `with*` builder flag resolves to a named `HarnessPlan` field (no orphan `config.x` conditionals in kernel/loop). |
| 7 Strategy→Policy | `check-single-loop.sh` | Zero iteration-loop constructs, zero synthesis-prompt string literals, zero `gatewayComplete(` calls inside `strategies/` — strategies are data + policy hooks only. |
| NEW A-amendment | `check-deliverable-truth.sh` | Every terminal accept path consults the deliverable projection: zero constructions of receipt `delivered:` fields outside the ledger's deliverable projection module; `artifactProduced` verification routed through the deterministic verifier, grep-zero ledger-only shortcuts. |

Second durability leg (already binding, keep): per-phase bench gate + ledger entry. Third leg (missing, added in §5): the bench itself must contain the task classes the requirements name — an invariant is only as durable as the instrument that measures it.

---

## 5. Verdict: **CONTINUE** — with the following exact amendments to `2026-07-07-adaptive-harness-overhaul.md`

The 9 pillars absorb both requirements: (A) is a strengthening of pillar 4 (ledger) + pillar 7 (verification) + pillar 5 (terminal authority); (B) is a strengthening of pillar 6 (policy compiler) + pillar 8 (control plane) + the verification protocol itself. Nothing contradicts the centralization thesis — both requirements *depend* on it. Proposed amendment text, verbatim insertable:

> ### Phase 3.5 — Long-Horizon Instrument + Guard Scaling (NEW; days, before Phase 4 merge gate)
> Requirement (B) forcing function: the bench has no task requiring >25 iterations, so every gate verdict is blind to long-horizon regressions.
> 1. Add bench task class `lh` with `lh-1`: multi-source research+synthesis task requiring by design ≥40 iterations / ≥25 substantive tool calls across ≥3 sources, with a deterministic deliverable verify (artifact on disk + required-entity coverage) and NO single-source shortcut. Optional `lh-2` (long execution chain) later.
> 2. Horizon-normalize guards: loop-detector `maxSameTool`/`maxRepeatedThought`/`maxConsecutiveThoughts` and ICS urgency become fractions of `maxIterations` (defaults preserve current behavior at maxIterations ≤ 15 exactly).
> 3. From Phase 4 onward, `lh-1` is part of every phase's merge-gate bench matrix.
> **Exit:** ra-full completes lh-1 without guard-forced termination during legitimate gathering; guard-scaling change is behavior-identical on rw-1..9.

> ### Phase 4 — scope additions (Deliverable Truth, requirement A)
> 6. New first-class entry type `deliverable`: declared from a `DeliverableContract` (artifacts + answer requirements; sources: user config, plan-execute requirement decomposition, post-condition derivation) with lifecycle `declared → claimed → verified | unverified | missing`. Verification writes a `verdict` entry linking evidence; **artifact verification is deterministic (filesystem/environment) on the live path**, not ledger-claim-only — closes post-conditions.ts:24.
> 7. Receipt projection gains a deliverable manifest: `receipt.deliverables[] = {id, status, evidenceRef}`; `delivered:false` on any missing/unverified declared deliverable.
> 8. Ledger exchange entries carry an outcome tag `{progress | exploration | retry-waste}` so efficiency accounting (A2-class metrics) and the Phase 6 recompiler distinguish legitimate exploration from dead retries.
> **Added acceptance:** a run that claims success while a declared artifact is absent from disk MUST ship `receipt.deliverables[i].status: "missing"` and `delivered:false`. Terminal-gate divergence (b) unifies on COMPLETED-verified semantics behind this gate (attempted ≠ delivered).
> **Added enforcement:** `scripts/check-ledger-writes.sh`, `scripts/check-deliverable-truth.sh`.

> ### Phase 5 — additions
> 5. Proposal inputs are horizon-normalized (rates/fractions, not absolute counts); regression suite adds a long-gathering false-positive case: sustained legitimate tool repetition at iteration 40+ of lh-1 must NOT win the resolution over continue.
> **Added enforcement:** `scripts/check-control-plane.sh`.

> ### Phase 6 — additions
> 5. Task classification gains a `horizon` axis (`short | standard | long`); `HarnessPlan` gains `horizonProfile`: iteration ceiling, guard-scaling factors, pacing signals (budget-fraction guidance at 25/50/75%, replacing end-game-only urgency), compaction cadence, redirect budgets.
> 6. Acceptance matrix extends to lh tasks; the lift rule is evaluated **per task class**, with the token-overhead bar interpreted per class (long-horizon classes judged on cost-per-verified-deliverable, not aggregate token delta).
> **Added enforcement:** `scripts/check-policy-compiler.sh`.

> ### Phase 7 — added enforcement
> `scripts/check-single-loop.sh` (no loops/synthesis prompts/gateway calls inside strategies/).

> ### Execution rules — addendum
> - `lh-1` joins the standing gate matrix at Phase 4 (Phase 3.5 exit).
> - Retrofit `scripts/check-tool-surface.sh` for Phase 2 (property tests verify the resolver; the script stops bypasses).

**What is explicitly NOT amended:** phase order (1→7 stands; 3.5 is an instrument insertion, not a reorder), the 9 pillars, the no-big-bang/evidence-gated/warden-veto rules, the North Star arcs. Requirement (A) lands as Phase 4 scope (+ terminal-gate semantics unification); requirement (B) lands as Phase 3.5 (instrument + guards) + Phase 5/6 scope. Both requirements make the ledger MORE central, not less — the ratified direction survives contact with them.

---
*Audit: read-only; evidence = 6 direction docs + code cites (`terminal-gate.ts`, `post-conditions.ts:24,65`, `task-classification.ts`, `context-profile.ts:84-119`, `runner.ts:343`, `ics-coordinator.ts:63`, `real-world.ts` maxIterations caps, `scripts/check-*.sh`). Author: direction-coherence audit session 2026-07-08.*
