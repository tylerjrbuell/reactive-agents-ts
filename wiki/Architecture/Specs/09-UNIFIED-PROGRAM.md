# 09 — The Unified Program (Canonical North Star)

**Status:** CANONICAL sequencing + convergence authority for all Reactive Agents work.
**Rewritten in place 2026-08-12** (ratification event). This replaces a 354-line
document whose last ~260 lines were a chronological amendment stack (07-22 → 07-29),
each entry partially superseding the one above it. That structure was the doc-level
instance of the disease this program exists to cure: mechanisms added beside
mechanisms until no reader reaches the bottom. History is preserved in git and in
the cited reports; nothing below is new policy except where marked **NEW 2026-08-12**.

**Supersedes:** 08's arc sequencing (§3). **Governs:** every plan, spec and decision doc.
**Do not write another north-star document. Amend this one.** Three proposals hit this
wall (2026-08-10 ×2, absorbed by
[[../../Decisions/2026-08-11-vet-and-amend-agentic-powerhouse-proposals]]).

---

## 1. The one goal

> **Reactive Agents is the canonical agentic OS whose kernel is a self-aware harness:
> every run is governed by a typed contract, evidenced in one ledger, assessed
> continuously, controlled through one plane, and rendered through one projector — and
> every capability the OS claims is proven by its own instrument before it is claimed.**

Three strands, always shipped as a slice through all three:

| Strand | What it is | Altitude |
|---|---|---|
| **K — Kernel** | Contract → Ledger → Assessment → Control → Actuators → Projector | inside the run |
| **P — Product** | OS arcs: Log+Process+Receipt ✅ → Boundary+Gate → Team → Flywheel (08 v6.0) | around the run |
| **T — Truth** | Bench + lift gate + receipts + replay — how both stay honest | above both |

K makes agents capable. P makes them governable. T keeps both honest.

## 2. Program invariants (law — unchanged)

- **One owner module + one grep-able enforcement script per subsystem. No script → not done.**
- **The lift rule.** Default-on requires **≥3pp accuracy lift AND ≤15% token overhead**,
  cross-tier, per task class. Otherwise opt-in, or removed. `ablation-warden` holds veto.
  The rule is an AND, and the token leg is measured in **tokens**, not USD
  (`gate/types.ts:101`, `gate.ts:286` — the gate has no USD field at all).
- **Honest-claims law** (08 §binding) applies to receipts, forks, replay, and our own headlines.
- The meta-loop DAG is one-directional; control re-enters as ledger entries only.
- Falsified levers stay dead. Non-goals in 08 §9 carried.
- **A surprising measurement indicts the instrument first.** Four findings have been
  retracted to one tool-surface confound; a fifth (§5.1) died on re-measurement.

## 3. Convergence rulings (binding — where documents would collide)

- **C1 — One event store.** RunLedger is the substrate. Trace JSONL, EventBus, `run_events`,
  and `steps[]` are projections. No second store. *Satisfied for reasoning facts
  (Wave C.2); engine lifecycle events and raw LLM exchange are still separate — see §6.5.*
  Raw LLM I/O stays a linked replay record, deliberately **not** ledger data.
- **C2 — One contract.** RunContract is the single typed answer to "what does done mean" —
  read by the terminal gate, the receipt, Arc 2's policy boundary, and the bench.
- **C3 — One trust spine.** evidence (ledger) → decision (gate) → record (receipt).
- **C4 — One instrument.** `packages/eval` and the bench lift-gate are one artifact.
  Exactly one definition of "improvement" in this codebase.
- **C5 — Teams wait for perception.** Arc 3 requires RunAssessment + contract. A parent
  cannot supervise progress that isn't measured. (A2A last-mile wiring is independent.)
  *Forward input, not scope (added 2026-08-19, external research pass): today's `compose`
  package is killswitches only (`budget-limit`, `timeout-after`, `max-iterations`,
  `watchdog`, `require-approval-for`) — no topology/orchestration surface exists yet, so
  there is nothing to "expand" pre-C5. 2026 harness-engineering literature converges on
  patterns worth evaluating once Arc 3 opens: task-adaptive topology selection
  (parallel/sequential/hierarchical/hybrid per task shape, not one fixed pattern),
  subagent isolation with a rebuilt permission context per spawn (not inherited wholesale),
  and a "puppeteer" orchestrator role split (planner/executor/validator) over the A2A
  protocol for inter-agent discovery. None of this is authorized before RunAssessment
  ships — §8's WIP=1 rule still applies.
- **C6 — The flywheel is the policy compiler grown up.** Arc 4 + Wave G + Phase 7 are one movement.
- **C7 — One terminal truth.** **NEW 2026-08-12.** `run()`, `runStream()`, durable rows,
  trace completion and UI state are projections of one supervisor-owned outcome. No path
  reconstructs completion independently. (Supersedes the old C7 launch-line clause, long discharged.)

## 4. Verified state (2026-08-12)

| Fact | Value | Source |
|---|---|---|
| Released | v0.14.0, 34 packages, live on npm | — |
| Harness overhead, `full` vs `bare` | **+141% tokens / +156% cost** | [[../../Research/Harness-Reports/2026-07-28-corrected-composite-rebaseline]] rung 2, haiku, n=3, T=1 |
| Against this document's own 15% ceiling | fails by **~9.4×** | ibid. |
| Lift measurements attempted / passed | **8 / 0** | ibid. + §5.2 |
| Default path meta-loop reachability | **7 event kinds**; `.withReasoning()` = 12; control plane needs `.withLongHorizon()` | `meta-loop-reachability.test.ts` |
| `_enableReasoning` default | `false` (`builder.ts:360`) — **default users take the inline arm** | verified 2026-08-12 |
| Public builder withers | **83** | verified 2026-08-12 |
| Strategy implementations | 8 files, **7,628 LOC** | verified 2026-08-12 |

The +141% figure replaces an earlier 555–640%, which was computed with a broken
instrument (Anthropic `usage.input_tokens` counts only the uncached remainder; fixed
`2f97ca1e`). **Do not cite 555–640% anywhere.** Scope limits on +141%: one task, one
model, n=3, and `bare` is RA's inline loop rather than a raw API loop — so it is a FLOOR.

## 5. Measurement rulings that close open questions

### 5.1 "Lazy pruning harms small local models" — **DEAD. NEW 2026-08-12.**

The 2026-07-28 re-baseline filed a lead: pruning ON = 2/12 deliverables vs full-surface
11/12, Fisher p ≈ 3.2 × 10⁻⁴, same sign on two local models. It was never acted on
because half the cells were `llm_error`-confounded.

**Re-measured 2026-08-12** (`disclosure-ablation.ts`, same two models, n=2 each):

| mechanism axis | July 2026 | August 2026 |
|---|---:|---:|
| pruning ON (`prune+discover` + `prune-only`) | 2/12 | **7/8** |
| full surface (`no-prune` + `stable-surface`) | 11/12 | **8/8** |

Zero `llm_error` cells. `status` now agrees with `correct` in every cell, where in July
correct deliverables were being reported as failures. **The finding was an artifact of the
filesystem-blind success authority and the `discover-tools` dead end, both fixed in August**
(`92dc591e`, `e1def881`, plus Move 2 disk grounding). The lead is closed, not deferred.
Pruning is now a **token optimization (saves 4–18%, model-dependent), not a correctness
factor.** It belongs in a profile, not in a hidden default.

### 5.2 `discover-tools` is pure cost — **REMOVE. NEW 2026-08-12.**

| evidence | value |
|---|---|
| `discover-tools` invocations across 4 datasets, 3 models, 2 dates, ~35 cells | **0** |
| Token cost, holding pruning constant (`prune+discover` vs `prune-only`) | **+4.9%** |
| Deliverable correctness, same comparison | 3/4 **vs** 4/4 |
| Independent measurement (Move 0 disclosure-ablation) | "buys nothing" |
| Wire cost (Move 1 P2, gemma4:12b native-FC) | ~1,000 chars of schema **per call** |
| Failure mode it creates | F8: 6,691–8,397 tokens burned, `evidenceDelta=0`, fabricated answer |

It exists only to rescue tools that pruning hid, and it never fires. Removing it passes
the §2 lift rule on both legs (token leg −4.9%, accuracy leg no regression) — **the first
mechanism decision in nine attempts backed by a clean measurement, and it is a removal.**
Scope limit: n=2 per model, one task shape, 10-builtin surface, local tier only; the
zero-invocation record is the load-bearing fact, not the n=2 correctness delta.

### 5.3 `RA_STABLE_TOOL_SURFACE` — stays opt-in

Fails the token leg on every tier (+33.3% vs default at haiku, +92.0% granite4, +221.4%
vs inline) against a 15% ceiling. Accuracy leg not established cross-tier: rung 2 cannot
measure it (every arm at ceiling 3/3). The rule is an AND. **§2 was not reinterpreted to
fit the result** — it costs 4.4% *less money* and is the only arm that caches by
construction, and it still fails, because the rule says tokens. A proposed amendment is
filed ([[../../Decisions/2026-07-29-lift-rule-cost-vs-tokens-amendment]]); **it is not in
force, and ratifying it would promote nothing.**

### 5.4 The measurement ladder (ratified 2026-07-28)

**Rung 1** deterministic replay over the golden corpus — does the machinery fire, at zero
tokens. **Rung 2** haiku composite — fast, cheap, directional. **Rung 3** fast local
tool-callers, non-reasoning. Cross-tier promotion needs rungs 2 and 3 to **agree in sign**.

Rung 1's blind spot is now known and must be stated with every INERT verdict: the corpus's
`builtins` sets are too small for pruning to hide anything, so `RA_LAZY_TOOLS` and
`RA_TOOL_DISCOVERY` bucket INERT for a corpus reason, not a mechanism reason. **Grow the
corpus before reading INERT as "dead."**

## 6. The architecture smells (the actual debt — **NEW 2026-08-12**)

One disease: **boundary multiplicity.** The same concept is represented and reinterpreted
in more than one place, so a fix at one site silently fails at another. Every item below
was verified against source on 2026-08-11/12 (13 of 14 citations confirmed; full
fact-check in [[../../Decisions/2026-08-11-vet-and-amend-agentic-powerhouse-proposals]]).

**6.1 Two agent loops.** `execution-engine.ts:739-861` (kernel path) and `:862-1100`
(inline think/act/observe). `_enableReasoning` defaults `false`, so **the default user
gets the inline arm**, which is filesystem-blind on success and sits outside
`check-success-authority.sh`'s fence. Every correctness fix shipped to the kernel misses
the majority population. *Owned by Move 1.*

**6.2 Terminal truth reconstructed, not projected.** The kernel produces terminal state;
`reactive-agent.ts:1458-1522` then re-derives tool calls, deliverables and goal-achieved
from `reasoningSteps`, and `execute-stream.ts:535-814` does it a third time. *C7.*

**6.3 Stream execution detached from its caller.** `execute-stream.ts:811-814` uses
`Effect.forkDaemon` for correctness-critical work; `run-controller.ts:247-251` aborts only
its own controller. Cancelling a stream does not stop the run — measured: a second run
overlapped the first while its model request was still completing.

**6.4 Tool execution has two boundaries.** `executeToolAndObserve()`
(`tool-observe.ts:246-484`) owns policy, approval, observation, ledger and events; the
kernel parallel batch bypasses it and calls `executeNativeToolCall()` directly
(`act.ts:621-703`) — the code comment says so.

**6.5 Evidence semantics differ by caller.** `terminal-gate.ts:26-35` documents it: the
kernel counts a required tool covered when **attempted**, plan-execute when **completed**.
`final-answer` is exempt from grounding and coverage entirely (`:241-246`).

**6.6 Two path-confinement authorities.** `healing/path-resolver.ts:43-55` silently remaps
an out-of-root absolute path to a working-dir basename; `skills/file-operations.ts:371-386`
independently **throws** on traversal, against a different root (`getFileRoot()`). Symptom
F9: `file-write` and `file-read` both succeed, terminal verification checks the original
path, run fails after successful execution. *Fix = pick one authority, delete the other —
narrower than the "canonical argument identity everywhere" the 08-10 proposals asked for.*

**6.7 Work paid for and discarded.** `iterate-pass.ts:630-671` computes recall context and
skills, then `void`s both — the comment admits it. `volatile-tail.ts` reads a `goal_state`
that has no live producer.

**6.8 Two memory consolidators.** `memory/src/extraction/memory-consolidator.ts` and
`memory/src/services/memory-consolidator.ts` are independent implementations, both wired,
both live (`memory-flush.ts:29-71` acquires both).

**6.9 The measurement substrate is unvalidated.** `trace/src/replay.ts:15-28` casts
arbitrary parsed JSONL to `TraceEvent` with no schema check. This is the instrument.

**6.10 Configuration has seven representations.** Builder private fields → `BuilderState`
→ `BuilderRuntimeStateView` → `RuntimeOptions` → `ReactiveAgentsConfig` → `AgentConfig`
schema → hand-written serializer. 83 withers on the public surface. Full and light runtimes
use separate layer graphs. *Real debt, but DX debt — see §7's ordering.*

**6.11 Leaks and stubs.** `build-validation.ts:338-347` prints the first 8 characters of the
API key to console on every build. `cost-track.ts:20-48` hardcodes `tier:"sonnet"` and
`inputTokens: 0` (scoped: only runs under `.withCostTracking()`, default off).
`calibration.ts:161-184` returns a deliberately empty adapter.

## 7. The ordered path

**The axis is how much the harness spends per model turn and how much it hides from the
model.** That is what must become explicit, measurable and per-tier — a frontier model with
prefix caching and a 4GB local tool-caller want opposite settings, and today both get one
hidden default. Profiles are that axis made explicit; ownership convergence is what makes
profiles enforceable. Order follows cheapness and measurability, not architectural elegance.

**Step 0 — forced fixes.** No lift gate needed; each is deterministic or a pure removal.
Remove the API-key prefix (6.11). Validate trace JSON at load (6.9). Delete `discover-tools`
(§5.2). Add no-progress termination for repeated no-evidence discovery/meta-tool loops (F8).
Fix `cost-track` tier/input tokens (6.11).

**Step 1 — one loop.** Finish Move 1: land P2 (gate meta-tool schemas on actual need — the
measured +73–100%/call wire tax), then merge Step 1 and delete the inline arm (6.1).
`check-single-loop.sh` red-on-cut. **P2 remains the abort gate.**

**Step 2 — one terminal outcome.** C7. Make `run()`/`runStream()`/receipt/durable projections
of one outcome (6.2), and remove correctness-critical `forkDaemon` (6.3). Red-on-cut:
terminate a stream, assert no subsequent provider call.

**Step 3 — one execution boundary.** Batch-capable scheduler with `executeToolAndObserve()`
as its single-call adapter (6.4); one ledger-backed `RequirementEvidence` replacing
attempted-vs-completed (6.5); one path authority (6.6).

**Step 4 — profiles.** Promote tool-surface policy, iteration budget, strategy cost ceiling
and context allocation into named per-tier profiles. Pruning becomes a profile knob (§5.1),
not a hidden default. This is where "dynamic harness per model tier" actually lands, and it
is only honest after Steps 1–3 give it one place to apply.

**Step 5 — context and cost economy.** One allocator; stable prefix vs dynamic tail;
surface/prompt hashes so every cache hit is explainable; compaction before the window is
consumed; inject recall or don't compute it (6.7).

**6.7 recall half: MEASURED, DON'T COMPUTE IT. NEW 2026-08-20.** Issue #129 Phase 1
(`RecallService` seam) shipped 2026-05-23, Phase 2 (writers) never dispatched. Spike this
date: retrieval itself works (rung-1 zero-token differential probe, 4 task shapes, 62.5%
divergence rate — bootstrap-only query genuinely misses facts a per-iter query would find).
But **injecting that content never changed model output**, tested 3 ways, n=5 replicates ×
2 local tiers (gemma4:12b, granite4:latest), real kernel wire (not simulated): raw fact
dump, bare fact as a user turn, filesystem-pointer + imperative instruction. **0.0pp lift,
all three, both tiers.** The filesystem-pointer variant was worse — models never called
`file-read` on the referenced note despite the explicit instruction. Same disposition class
as §5.2 (`discover-tools`): clean measurement, negative, → **park `RecallService` Phase 2,
do not build the writers.** Leave the Phase 1 seam as dead scaffold (same acceptance as the
unwired `loadProfile` method already gets). Untested: frontier-tier models (haiku/sonnet+)
on the same harness — if a future need justifies it, that is the one gap left, not more
local-tier phrasing attempts.

**The actual filesystem-memory answer is the boundary that already works.**
`MemoryService.bootstrap()`/`flush()` + `MemoryFileSystem` already do Manus-style
compression (full detail off to `memory.md`, short reference loaded once) at the **run**
boundary, not per-iteration — this is proven-live plumbing, just default-off since v0.12.
The open question worth measuring is whether defaulting it on clears the lift rule — a
separate, untested question from per-iter recall, and the more promising one given per-iter
injection's flat result.

*Alternate hypothesis, not yet tested (added 2026-08-19, external research pass).* This
step assumes the lever is **pruning** — hide surface, shrink the tail. MIT's RLM
(recursive language models, Aug 2026) is the opposite bet: don't hide context, let the
model **recurse over it programmatically** — decompose long input, spawn sub-calls over
slices, recombine — reporting inputs handled "two orders of magnitude beyond context
window" and +28.3% avg over a vanilla baseline on long-context tasks (RLM-Qwen3-8B).
These are not mutually exclusive — recursion is expressible as a strategy variant
(`src/strategies/`) that trades tokens for coverage on tasks where pruning would hide the
answer — but Step 5's allocator design should not assume pruning is the only lever before
this is measured. Do not build it speculatively; log it as an open alternate hypothesis for
whoever designs the allocator, gated by the same §2 lift rule as any other mechanism.

**Step 6 — config and memory convergence.** One spec compiled once; one consolidator (6.8);
retire builder-state mirrors (6.10). **Last, deliberately** — 83 withers is real debt with
no measurable performance leg, and doing it early would re-plumb every boundary above.

Then, and only then: Arc 2 (boundary + gate), Arc 3 (teams, gated by C5), Arc 4 + Phase 7 (C6).

## 8. What is NOT the path

- **A new north-star document.** Three attempts; all absorbed here.
- **A parallel multi-wave migration program** started before Move 1 merges. WIP = 1.
- **`RunSupervisor` / `AgentSpec` as a greenfield seam.** The diagnosis behind them is
  correct and is recorded as §6; the cure is Steps 1–3 done incrementally, each with its own
  abort gate. Their published estimates ("20–40% lower latency", "15–35% fewer tokens") are
  the authors' own directional hypotheses and **must not be promoted to expectations.**
- **Strategy merging as near-term work.** 7,628 LOC across 8 strategies is real duplication,
  but it is lifecycle duplication that Steps 2–3 remove structurally. Merging first would
  hand-edit code that convergence deletes.
- **Promoting a mechanism because it is elegant.** Eight lift attempts, zero passes. The one
  clean result to date (§5.2) is a deletion.

## 9. Authority hierarchy

1. **This document** — sequencing, convergence rulings, release slicing.
2. **08 v6.0** — product-arc content, exit gates, honest-claims law, non-goals.
3. **[[../Design-Specs/2026-07-11-harness-north-star-architecture]]** — kernel architecture (RATIFIED).
4. **[[../DEBT-REGISTER]]** — canonical debt ledger; §1 ratchet counts only go down.
5. **Active plans**, then **bench reports / improvement ledger** — the evidence record.

Conflict rule: lower documents defer upward. Changing a higher document is a ratification
event (decision doc), not an edit in passing.
