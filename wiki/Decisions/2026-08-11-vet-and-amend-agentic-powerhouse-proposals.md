---
type: decision
status: accepted
created: 2026-08-11
tags: [north-star, architecture, simplification, vetting, amendment]
amends:
  - [[../Architecture/Specs/09-UNIFIED-PROGRAM]]
absorbed-and-deleted:
  # Both content-absorbed into 09 §6/§7 and deleted 2026-08-12 (commit 767c44fd
  # holds them if the originals are ever needed):
  #   Design-Specs/2026-08-10-agentic-powerhouse-simplification-north-star.md
  #   Design-Specs/2026-08-10-run-supervisor-architecture-deep-dive.md
related:
  - [[../Research/Harness-Reports/2026-08-10-new-user-adversarial-review]]
  - [[../../.claude memory/project_move_1_single_loop_2026_08_08]]
---

# Vetting verdict + amendment: the 2026-08-10 "Agentic Powerhouse" proposals

## What this is

Three unstaged documents (`opencode`-authored, 2026-08-10) proposed a large
convergence architecture (`RunSupervisor`, `AgentSpec`, `RunOutcome`, an
8-wave and a 6-wave migration program) built on a root-cause map and an
adversarial Ollama probe. This decision (a) vets the factual claims in those
documents against current source, and (b) rules on what happens to them.

**Ruling: do not commit these as documents #4/#5/#6 of the north-star
lineage.** Per standing guidance, a second instance of "we wrote a new
north-star doc" is itself the defect class this repo keeps re-triggering.
The content is largely accurate and useful — it is **absorbed into this
amendment and into `09-UNIFIED-PROGRAM.md`**, not kept as a standing parallel
authority. The three source files should be deleted from the working tree
after this amendment lands (their evidence is preserved here and in the
harness-report history).

## Fact-check result: 13/14 confirmed

Two Explore agents independently verified every specific `file:line` citation
against current `main`. Verdict per claim:

| # | Claim | File | Verdict |
|---|---|---|---|
| 1 | Stream execution daemon-forked, detached from caller | `execute-stream.ts:811-814` | **CONFIRMED** |
| 2 | `RunController.terminate()` only aborts its own controller, doesn't reach the execution fiber | `run-controller.ts:247-251` | **CONFIRMED** |
| 3 | Kernel parallel-batch path calls `executeNativeToolCall()` directly, bypassing `executeToolAndObserve()` | `tool-observe.ts:362-370`, `act.ts:621-703` | **CONFIRMED** (code comment admits it explicitly) |
| 4 | Path healing silently remaps; healed path diverges from what's verified at delivery | `path-resolver.ts:43-55`, `file-operations.ts:371-386` | **PARTIALLY CONFIRMED** — these are two *independent* confinement mechanisms (one silently remaps, one throws on traversal, using different root config). Real duplication/inconsistency, but not the single continuous "heal-then-verify-wrong-path" pipeline the doc describes. See correction below. |
| 5 | Kernel treats a required tool "covered" on attempt; plan-execute requires completion; `final-answer` exempt from grounding/coverage | `terminal-gate.ts` (path drifted: now `kernel/capabilities/decide/terminal-gate.ts`, not `kernel/loop/`) | **CONFIRMED**, content exact |
| 6 | `buildCalibratedAdapter()` intentionally returns an empty adapter | `calibration.ts:161-184` | **CONFIRMED**, code comment says so explicitly |
| 7 | Build banner prints API key prefix to console | `build-validation.ts:338-347` | **CONFIRMED** |
| 8 | Two independent inline vs. kernel agent loops in one function | `execution-engine.ts:739-861` vs `:862-1100` | **CONFIRMED** — this is the exact defect Move 1 (already in flight, see below) targets |
| 9 | Memory recall computed then discarded (`void iterRecallContext`) | `iterate-pass.ts:630-671` | **CONFIRMED**, comment admits it |
| 10 | Default tool surface changes per iteration; stable full-surface mode is opt-in | `tool-surface.ts:276-375`, `RA_STABLE_TOOL_SURFACE` env flag | **CONFIRMED**, but see classifier-naming correction below |
| 11 | Two live, independently-implemented memory consolidators, both wired | `extraction/memory-consolidator.ts` vs `services/memory-consolidator.ts` | **CONFIRMED**, both real, both wired (one in `packages/runtime`, one in `packages/memory`) |
| 12 | Trace replay does an unchecked `as TraceEvent` cast | `trace/src/replay.ts:15-28` | **CONFIRMED** (JSONL, off-by-one line) |
| 13 | Runtime re-derives tool calls/deliverables/goal-achieved from `reasoningSteps` after the kernel already produced terminal state | `reactive-agent.ts:1458-1522` | **CONFIRMED** |
| 14 | Cost tracking hardcodes `tier: "sonnet"` and `inputTokens: 0` | `cost-track.ts:20-48` | **CONFIRMED**, but see scoping correction below |

This is unusually high-quality fact-finding for an unvetted doc — treat the
architectural reasoning built on top of it as credible, not as a document to
discard.

## Three corrections to the source documents

**F9/R4 (path healing) — the mechanism is wrong, the defect class is right.**
The docs describe one heal→execute→verify pipeline that disagrees with
itself. What's actually there is two *separate* confinement implementations
(`healing/path-resolver.ts` silently remaps against `workingDir`;
`skills/file-operations.ts`'s own check throws against `getFileRoot()`) that
happen to produce the same class of symptom (F9's `/tmp/...` remap). The fix
is narrower than "canonical argument identity everywhere": **pick one path
confinement authority and delete the other**, then make delivery
verification consume whatever that one authority actually did.

**R3 (progressive disclosure) — "classifier" conflates two different
mechanisms; project memory is not stale.** Project memory states the LLM
tool-relevance classifier (`classifyToolRelevance()`, gated by
`config.requiredTools.adaptive === true` or `config.adaptiveToolFiltering
=== true` in `runtime/src/engine/phases/agent-loop/setup/classifier.ts:117-127`)
is opt-in as of 2026-07-28. **Confirmed still true** — it defaults to
`false`, backed by a 6-cell cross-tier ablation showing 0pp lift at
+25%..+167% token cost. The new docs' R3, however, is about a *different*
default-on mechanism: `tool-surface.ts`'s heuristic-based "lazy disclosure"
stage, which narrows the visible/callable tool set per iteration using a
free keyword heuristic (not the paid LLM classifier) and is on by default.
Both things are real; they are not the same thing; the docs' prose uses
"classification pruning" for both and that's what produced the apparent
contradiction. The underlying claim R3 makes — default tool surface churns
per iteration and this is coupled to discovery-loop failures (F8) — **stands
independent of the classifier question**.

**R7/matrix row "cost tracking" — real bug, but scoped, not universal.**
`cost-track.ts`'s `tier: "sonnet"` / `inputTokens: 0` only executes when
`config.enableCostTracking === true`, which defaults to `false`
(`builder.ts:358`). It does not contaminate the token/step numbers used
throughout the adversarial-review report or the harness's bench instrumentation
— those come from a separate path (`harness-cost-attribution.ts` / trace
token counts), not `CostService`. It is still worth a one-line fix for
anyone using `.withCostTracking()` for real budget/compliance tracking, but
it is not the "every measurement is suspect" finding it could have been.

## The load-bearing finding: this program mostly already exists, in flight, already measured

R1/R5 in the north-star doc and Wave 3 of the run-supervisor doc both target
`execution-engine.ts:741`'s inline-vs-kernel fork. **This is not a new
finding.** `refactor/move-1-single-loop` (branch, not yet merged) already:

- Diagnosed the identical defect with more precision than either new doc
  (including *why* it matters: the inline arm is filesystem-blind on success
  and sits outside `check-success-authority.sh`'s enforcement fence — so the
  default/majority-population path gets none of the correctness work already
  shipped to `.withReasoning()` users).
- Already implemented Step 1 (`f0955987`: always provision `ReasoningService`,
  routing the default builder through the `reactive` kernel strategy) — **on
  the branch only; NOT merged to `main`.** `builder.ts:360` on `main` still
  reads `_enableReasoning: boolean = false`, so every default-path user today
  still takes the inline arm and the 7-vs-12 meta-loop reachability gap is
  live in shipped v0.14.0.
- Already falsified its own v1 premise with code facts (direct's iteration
  cap truncates multi-turn tasks; the contract compiles unconditionally
  inside `runKernel`, so "minimal phase count" isn't reachable via strategy
  choice) — exactly the kind of self-correction the new docs' "Verification
  Corrections" section models, but already done, with commits.
- Already has a measured, named abort gate: P2, the per-call token tax
  (+73–100% at the wire level on a `gemma4:12b` native-FC probe), root-caused
  to `discover-tools` and `final-answer` schemas being flattened into the FC
  array unconditionally rather than gated on actual need — this is
  "dialect-blindness #1," independently confirmed by the new docs' R3/R4
  finding about tool-surface churn under a different name.

**Ruling: do not open a new 8-wave or 6-wave program for this. Finish Move
1.** The remaining work is P2 (gate `discover-tools`/`final-answer` schemas
on actual need — cuts the wire-level tax) and Steps 2–4 (delete the inline
arm, `check-single-loop.sh` enforcement). That is a bounded, already-scoped,
already-partially-shipped unit of work, not a new program. Executing it *is*
"a real change that moves the needle in the north-star direction" — it is
the single highest-overlap item between what the new docs propose and what
is already true, tested, and measured in this codebase.

## Impact triage: what to actually do, sequenced

Two separate axes were conflated in the source docs and must stay separate
in execution: **citation accuracy** (verified above, high) and **behavioral
impact** (unverified — this repo has retracted 4+ "improvement" findings to
one instrument confound, and 6 of 6 recent lift measurements cleared 0pp).
Nothing here ships default-on without the existing lift gate
(`evaluateLiftGate` / `rax eval gate`, ≥3pp lift AND ≤15% token overhead,
≥2 model tiers).

### Forced — ship without a lift gate (deterministic, no accuracy risk)

1. **Remove the API-key prefix from build output** (`build-validation.ts:338-347`).
   Security fix, zero behavioral risk, one line.
2. **Validate trace JSON at load** instead of `as TraceEvent`
   (`trace/src/replay.ts:15-28`). This is the measurement substrate itself —
   fix it before trusting anything replay-derived, per "instrument before
   conclusion."
3. **No-progress termination on the discovery loop** (F8): repeated
   `discover-tools` calls returning "No tools registered" with
   `evidenceDelta=0` for the whole run is a case where the harness *cannot*
   regress accuracy by stopping early — the run already fails at
   `max_iterations` with zero evidence. This is the rare change where the
   lift gate is trivially satisfiable because there is no accuracy to trade
   away. Best near-term candidate for a real, defensible, measurable win.
4. **Fix `cost-track.ts`'s hardcoded tier/zero input tokens** — one-line,
   scoped to `.withCostTracking()` users, no default-path risk.

### Correctness fix — needs a red-on-cut test, not a lift gate

5. **`execute-stream.ts` `Effect.forkDaemon` → supervisor-scoped fiber.**
   Testable deterministically: terminate a stream, assert no subsequent
   provider call fires. This is F1 from the adversarial review, independently
   confirmed, and is a real correctness/resource issue (GPU/cost/concurrency)
   regardless of any performance claim.
6. **Pick one path-confinement authority** (see correction above) and make
   delivery verification consume its output. Testable deterministically: a
   healed path must be byte-identical across execution, ledger record, and
   terminal verification.

### In flight — finish, don't restart

7. **Move 1** (P2 token-tax fix + Steps 2-4, inline-arm deletion,
   `check-single-loop.sh`). Already scoped, already has an abort criterion,
   already has Step 1 shipped. Next action on this branch is P2.

### Hypothesized — needs the cross-tier lift gate, do not default-on

`RunSupervisor` as a full runtime seam, `AgentSpec` config unification,
strategy convergence/merging, the unified context allocator, stable
tool-surface-as-default. The source docs are honest that their own
percentage claims ("20-40% lower latency," "15-35% lower tokens") are
directional hypotheses — that framing must be preserved; it must not survive
into any future summary as an expectation. Given this repo's actual track
record (6/6 recent lift measurements at 0pp, 4 retracted findings collapsing
to one tool-surface confound), these should stay opt-in explorations behind
`ablation-warden`, not scheduled work.

## What NOT to do

- Do not start a parallel "Wave 0-8" or "Wave 0-6" migration program while
  the Simplification Program (2026-07-27) is still the active program and
  Move 1 is mid-flight and unmerged.
- Do not promote the supervisor doc's percentage estimates to any public or
  planning document as expected results.
- Do not treat "13/14 citations confirmed" as "the redesign is validated" —
  it means the *symptoms* are real. Whether the proposed *cure* (a large new
  `RunSupervisor`/`AgentSpec` seam) beats the cheaper, already-scoped cure
  (finish Move 1 + the forced fixes above) is not yet measured and should
  not be assumed.

## Next action

Resume `refactor/move-1-single-loop`: land P2 (gate `discover-tools` /
`final-answer` schema inclusion on actual need), then Steps 2-4. In
parallel, the four forced fixes above are each under an hour of work and
can land on `main` independently, with the discovery-loop no-progress
termination (item 3) as the one with real user-facing signal.
