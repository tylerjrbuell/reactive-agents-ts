---
tags: [design-spec, architecture, simplification, canonical-proposal]
date: 2026-07-28
status: PROPOSAL — awaiting owner ratification
governs: the target shape of Reactive Agents
consumes: "[[../Specs/08-AGENTIC-OS-NORTH-STAR|08 v6.0]] §0 §1 §2 · [[../Specs/00-VISION|00 Vision]] · [[../DEBT-REGISTER|DEBT-REGISTER]] · [[../../Planning/Implementation-Plans/2026-07-27-simplification-and-feedback-loop|the simplification program]]"
---

# The Ideal Shape of Reactive Agents

**Thesis in one sentence:** Reactive Agents was built as a *compensation engine* for weak
models; the models caught up, the compensation layer became an unconditional tax, and the
thing that did **not** get solved by model progress — *can you trust what the agent just
told you?* — is exactly what RA already has the best assets for and should now become.

This is not a rewrite. It is a **subtraction plus a re-centring**. Every asset named in
§2 below already exists and is verified live.

---

## 1. Why the surface grew (and why that reason expired)

The mechanisms were rational when they were built. Sub-7B and 8B models genuinely could
not hold a tool loop together, so the harness held it for them: guards to stop runaway
loops, strategies to structure planning the model couldn't do, entropy sensing to detect
incoherence, budget flags to survive small context windows.

**08 §0 already recorded the expiry**, and it is the single most consequential line in the
canon:

> *"The 14B tool-calling gap closed at the model level (Qwen3 14B ≈ GPT-4 on agent-loop
> evals). The unmet need shifted to a harness that makes any model reliable."*

Two things follow, and only the first was acted on.

1. The *frontier* of the weak-model problem moved down to sub-7B / untrained / unknown
   fine-tunes. RA still wins there — the competitor bench receipt (best-of-6 on hard
   execution tasks vs Mastra/LangGraph/Vercel on local models) is real.
2. **The compensation layer is still applied unconditionally, to every model, on every
   run.** That is the 555–640% token overhead against our own 15% ceiling. We are charging
   frontier models the weak-model tax and calling it a harness.

The mechanism count is the fossil record of a premise that has expired.

### The measured state, so nothing here rests on impression

| Fact | Number |
|---|---|
| Lift measurements in 2 months / cleared the bar | 6 / **0** |
| Harness token overhead vs bare LLM | **555–640%** (ceiling: 15%) |
| Withers / with any lift evidence | 83 / **~7** |
| Env flags LIVE on the replay corpus | **1 of 19** |
| Heavy search strategies (ToT/LATS/GoT) | **no lift, 3–15× cost** — falsified, anchored dead |
| Guards that can terminate a run / measured misfire rate | 6 / **1 of 1** |
| `pass^8` on the canonical baseline | **0%** on all three real-world tasks |
| Meta-loop (Waves B/D/E/F) on the default path | **dark** (`_enableReasoning` defaults false) |

`pass^8 = 0%` is the one to sit with. **Reliability, not capability, is the binding axis** —
and reliability is a verification problem, not a planning problem. We have been adding
planning machinery to a reliability failure.

---

## 2. What we actually do well (non-negotiable, keep)

From 08 §2, verified-live. These are the assets, and none of them are the reasoning zoo:

- **The durable run rail** — 5-table SQLite RunStore, journaled SSE, cross-process attach,
  pause/resume. *Best-in-class among TS frameworks.*
- **The trust spine** — receipt, grounding, honesty taxonomy, verification, Ed25519
  provenance. **08 §0: "Verification is the #1 unmet need — nobody owns in-runtime
  verification/receipts."** This is the moat.
- **The run ledger** — one evidence substrate, one enforced write path (Wave C, shipped).
- **3-tier calibration + community flywheel** — live, default-on, 309 samples on one model.
- **Deterministic replay** — real agent, recorded table, zero tokens. Now also our
  measurement instrument.
- **Gateway + durable daemons** — `apps/advocate` runs 24/7 in production.
- **Cortex + UI kit** — 21-tag wire protocol, capability manifest auto-sync.
- **Local-first reliability** — calibration consumers, healing pipeline, tier-adaptive
  prompting. *The competitor-bench win.*

The vision's pillars — Control, Observability, Reliability, DX, Type Safety, Composition —
are all served by **this** list. None of them require nine strategies.

---

## 3. The reframe

> **Old:** a harness that makes weak models *behave*.
> **New:** a harness that makes any model's work *checkable* — and that spends effort in
> proportion to measured need.

Verification is the one job model progress does not delete. A better model produces better
answers *and* more plausible wrong ones; the need for evidence goes **up**, not down.

This keeps the local-model advantage rather than discarding it — see §5.

---

## 4. Target architecture

### 4.1 The core — five nouns, always on, small

| Noun | What it is | Status |
|---|---|---|
| **Loop** | one ReAct loop: sense → act → observe → verify | exists (`reactive`) |
| **Contract** | the typed answer to "what does done mean" | exists (RunContract) |
| **Ledger** | the run's evidence, one enforced write path | **shipped** (Wave C) |
| **Terminal authority** | one owner of "stop, and why" | exists but **contested by 6 guards** |
| **Receipt** | graded evidence out; provenance-signed, never a truth certificate | exists |

That is the whole kernel. It is roughly what the good harnesses converged on, plus the
receipt — which is the part nobody else has.

### 4.2 Extension points — few, real, composable

Everything that is currently a strategy, a guard, or a flag becomes one of these:

1. **Tools** — the syscall boundary, enforced at one chokepoint. Sub-agents are a tool.
2. **Policy** — approval / forbidden / budget / recursion, declared once, enforced once.
   (Already derived-once as of the approval-policy fix — that is the pattern.)
3. **Context strategy** — how the window gets filled: compaction, recall, projection.
4. **Verifiers** — pluggable checks that feed the receipt. **This is where RA's identity
   lives, and it should be the most extensible surface in the framework.**
5. **Observers** — trace / telemetry / UI. Read-only, never steering.

**Test for any future addition:** if it is not one of these five, it does not go in. A new
idea is a tool, a policy, a context strategy, a verifier, or an observer — or it is a
research spike that lives behind a dated experiment and dies on schedule (§6.3).

### 4.3 Variation moves from code to data

This is the structural change that stops the surface regrowing.

| Today (code paths) | Target (data) |
|---|---|
| 9 strategy classes | prompt + tool + policy configurations |
| entropy sensors → dispatcher patches | calibration profile fields |
| 43 env flags | dated experiments, or nothing |
| tier-adaptive prompting hard-coded | calibration profile (already data, already flywheel-backed) |

We already have the data plane: **calibration profiles, fetched from the commons, refined
by local observation.** It is live and default-on. The strategies are the same knowledge,
frozen into classes.

---

## 5. The keystone: intervention scales with measured need

**This is the single most important idea in the document, and it is what lets us simplify
without abandoning the local-model advantage.**

Today the harness applies everything, always. The 640% overhead is what "always" costs.

Instead, the calibration tier — which we **already compute, already ship, and already
default on** — selects how much harness a run gets:

| Tier | Harness applied | Rationale |
|---|---|---|
| **Frontier / strong** | core only: loop, contract, ledger, terminal, receipt | model holds the loop itself; verification is the value |
| **Mid** | + context strategy, + repair on verified failure | needs help finishing, not planning |
| **Weak / unknown** | + the full compensation set (guards, structure, tighter budgets) | the population the mechanisms were built for — where they *earn* it |

The mechanisms do not get deleted. **They get a precondition.** Every one of them becomes
a claim of the form *"this helps models of tier T on task class C"* — which is exactly the
form 09 §6's per-task-class lift rule already demands, and exactly what the ablation
sweep can now decide cheaply.

Consequences:

- Frontier users stop paying a tax built for a model they are not running.
- Local users keep the thing that wins the competitor bench.
- **"Model-adaptive intelligence" (Vision §117) stops being a slogan and becomes the
  scheduling principle of the whole framework.**

Notably this is also the honest reading of our own competitor result: RA won on *local*
models. We never had evidence the same machinery helps frontier ones, and 640% is evidence
it hurts.

---

## 6. What changes

### 6.1 Collapse the guards — 6 → 1 (highest-value, best-evidenced)

Six terminating guards are six independent chances to kill a working run, coordinating
only by accident. Measured misfire rate: **1 of 1** (`low_delta_guard`, graded accuracy
`0.000` on rw-7 — worse than no harness).

One terminal authority, one policy, one place to reason about "should this run stop." The
existing single-owner `terminate.ts` is the right home; the guards become *proposals* to it,
not independent actuators.

### 6.2 One loop; the zoo becomes configuration

`reactive` is the workhorse. ToT/LATS/GoT are already falsified and anchored dead;
`adaptive` is INCONCLUSIVE at n=1. `plan-execute` / `blueprint` / `reflexion` / `code-action`
are re-expressed as prompt+tool+policy configurations over the one loop, or retired.

Retire on evidence, not taste — the replay sweep decides, and it is free.

### 6.3 Flags get a lifecycle

**No permanent flags.** A flag is a deferred decision, and 43 of them means 43 decisions
deferred because measurement was unaffordable. It is affordable now.

Two states only: **EXPERIMENT** (dated, owned, must resolve) or **GONE**. An unresolved
experiment past its date is deleted, not inherited. Enforced by a `check-*.sh` gate, like
every other invariant here.

### 6.4 Verification becomes the most extensible surface

Invert the current emphasis. Today verification is one capability among ten and the
strategy registry is the showcase extension point. It should be the reverse: a documented,
composable verifier interface is the thing users plug into, because it is the thing nobody
else offers.

---

## 7. What this does NOT change

Guarding against over-correction — subtraction has its own failure mode:

- **The durable rail, gateway, Cortex, UI kit, telemetry, calibration flywheel** — untouched.
- **The receipt's honesty law** — graded evidence, never a truth certificate; signature
  certifies provenance, not correctness. Unchanged and now more central.
- **Local-model support** — *strengthened*, because the compensation set stops being diluted
  across a population that does not need it and can finally be measured where it applies.
- **The composable/fluent API** — the public surface stays; §4.2 is about what sits behind it.
- **The gates** — every subsystem keeps one owner module + one grep-able enforcement script.

---

## 8. Sequencing (each step gated by the one before)

| # | Step | Gate |
|---|---|---|
| 1 | **Composite ablation** on HEAD: `bare` vs `core` vs `full`, ≥2 tiers | **This licenses everything else.** If `core` ≈ `full` at a fraction of the tokens, the subtraction is evidenced, not asserted |
| 2 | **Guard collapse** 6 → 1 | red-on-cut test per absorbed guard; replay corpus green |
| 3 | **Tier-scaled intervention** (§5) — calibration selects the harness | per-tier lift, cross-tier arms |
| 4 | **Strategy retirement** on replay evidence | sweep verdict + corpus growth |
| 5 | **Flag lifecycle gate** | `check-*.sh`, red-on-cut |
| 6 | **Verifier interface** as the headline extension point | docs + example + receipt round-trip |

**Step 1 is not optional and must not be skipped.** This document is a *hypothesis with
strong priors*. The project's own history — a structural conclusion published off one
un-controlled probe, an ablation sweep whose first pass produced 18 false INERT verdicts —
says an architecture argument is worth exactly what its measurement is worth.

If the composite shows `full` decisively beating `core` on frontier models, **this spec is
wrong and should be rejected.** That is the honest bar, and it is cheap to run.

---

## 9. The one-line summary

> Keep the kernel small and the evidence total. Make the harness **earn** every intervention
> against the model actually in front of it. Be the framework that can tell you whether to
> believe the answer — because that is the problem model progress does not solve, and it is
> the one we are already closest to owning.
