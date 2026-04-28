# Research Discipline & Development Contract

> **Status:** FOUNDATION DOCUMENT — Project operating contract  
> **Authority:** Pinned 2026-04-27. Changes require explicit decision + git commit.  
> **Purpose:** Codify the development methodology so that every harness change is empirically justified, individually attributable, and provably better than the simplest alternative.  
> **Companion to:** `00-VISION.md` (what we're building); this doc covers HOW WE BUILD it.

---

## 1. The Mission

Engineer the **minimum harness** that demonstrably boosts agentic problem solving, reasoning, and learning capabilities — across at least two LLM providers, with developer-overridable hooks for every default behavior.

**Every line of code in the harness must have earned its place by spike-validated empirical contribution.** "Useful in principle" does not qualify. "Was useful when written" does not qualify. Only "spike vs no-spike, measured, replicated, with passing PROMOTION criteria" qualifies.

---

## 2. The Minimum Kernel — what we're converging toward

The harness's reason to exist is to provide capabilities the bare LLM lacks. There are three:

| Capability | What bare LLM lacks | Minimum mechanism |
|---|---|---|
| **Problem solving** | Cannot act on the world | Tool-use loop with bounded iteration |
| **Reasoning** | Generates chains, doesn't verify | Verification gate on terminal output + recovery on rejection |
| **Learning** | No memory across runs | Episodic outcome recording + retrieval as context |

The minimum kernel is roughly:

```
loop until done OR max_iterations:
  think       — model produces thought + (tool_call OR final-answer)
  if tool_call: act → observe → continue
  if final-answer: verify → if rejected, inject reason & retry once → if still rejected, fail
return final answer

(memory write on completion; memory retrieval on next start)
```

That's ~150 LOC of TypeScript. **Anything in the codebase that doesn't fit this kernel, override one of its decisions via hook, or compose cleanly on top of it, is a deletion candidate until proven otherwise.**

This is not a refactor target — it's an empirical claim being progressively tested.

---

## 3. The Methodology Contract — the new operating rules

### Rule 1: No harness change without prior spike validation

**Every proposed harness change** (new mechanism, modified mechanism, new hook) **must be preceded by a spike** that demonstrates empirical contribution against the relevant baseline.

The spike is:
- A single TypeScript file, ~50–200 LOC
- Zero imports from `@reactive-agents/*` packages
- Provider SDKs imported directly (e.g. `import Anthropic from "@anthropic-ai/sdk"`)
- One mechanism toggleable, otherwise identical loop

If you cannot express the mechanism in a single-file spike, the mechanism is too coupled — refactor before integrating.

### Rule 2: Hypothesis-first

Every spike opens with a falsifiable hypothesis in its file header:

```typescript
// HYPOTHESIS: <mechanism> produces <signal> on <task class> across <providers>.
// NULL HYPOTHESIS: <what we'd see if the mechanism doesn't help>.
// MEASUREMENT: <metric>, N=<runs> per cell.
// PROMOTION CRITERIA: <thresholds for "earns harness integration">.
// KILL CRITERIA: <thresholds for "abandon and document">.
```

The hypothesis MUST be locked before running the experiment. Post-hoc hypothesis matching is rationalization, not evidence.

### Rule 3: Cross-provider validation

A mechanism's claim is only as broad as the providers it tested on. Default minimum: **2 providers** (one local — ollama; one frontier — anthropic). Larger claims require larger matrices.

### Rule 4: The frozen judge

Evaluation must use a **pinned judge** — fixed model, fixed prompt, fixed code SHA — that does not share a code path with the system being measured. Today's bench had this exact bug; it is not optional going forward.

### Rule 5: Negative results are mandatory artifacts

Every spike writes a `RESULTS.md` regardless of outcome. Failed spikes are the most valuable artifact in the loop — they prevent re-litigating dead branches in future sessions.

### Rule 6: Promotion or kill — explicit gates, not vibes

After the experiment runs:
- **PROMOTE** → mechanism earns harness integration. The spike becomes a regression test.
- **KILL** → mechanism is abandoned. Add to `RESEARCH_LOG.md` with reason. If a corresponding harness mechanism exists, it gets a deprecation marker.
- **REFACTOR** → mechanism works but the current harness implementation is more complex than necessary; rewrite to match the spike's minimum form.

There is no fourth option. "Interesting, let's revisit" is not a valid outcome — it's how dead branches accumulate.

### Rule 7: Single-mechanism isolation

Each spike tests **exactly one** mechanism. Not "verify-retry plus context compaction plus better prompts." Those are three spikes. This is the rule that makes attribution clean. It is also the rule most teams violate.

### Rule 8: Bottom-up, demand-driven abstraction

Build the first prototype by hand with **NO infrastructure**. Refactor only after copy-pasting twice. The shape of the abstractions you need is unknown until you've felt the pain of not having them. Top-down infrastructure-first is how spike libraries become their own framework — the trap this contract exists to prevent.

### Rule 9: Control pillar inheritance

Every promoted mechanism ships with developer-overridable hooks from inception (per Vision §1). `defaultFoo` preserves baseline behavior; `KernelInput.foo?: FooHookType` is the injection point; types are exported from the public package. Hardcoded harness logic = black box = anti-pattern.

### Rule 10: Public API is unstable until validated

New types added during research-phase work are marked `@internal` or `_unstable_*`. Promotion to stable requires ≥3 external validations (real users, real domains). This protects downstream from breaking changes when mechanisms turn out to need different shapes.

---

## 4. The Signal Taxonomy — what to measure

Tracking quality alone is what makes papers fail to replicate. Track all six:

| Level | Question | Example |
|---|---|---|
| **Behavioral** | Did the mechanism trigger as designed? | Trace event count |
| **Mechanistic** | Did it change what the model did? | Different tools called, different reasoning |
| **Quality** | Did the output improve? | Judge-rated score on rubric |
| **Cost** | At what price? | Tokens, latency, dollars |
| **Robustness** | Across the matrix? | std(provider) and std(task) of the lift |
| **Surprise** | What broke unexpectedly? | Documented interactions |

A mechanism that improves Quality but doesn't move Mechanistic was lucky, not effective.

---

## 5. Tooling State — what we have, what we'll build as needed

### Exists today
- **Diagnostic CLI** — `rax-diagnose` (list / replay / grep / diff). Trace JSONL format is the canonical inter-spike data format.
- **Bench** — `local-models`, `real-world-full`, `regression-gate`, `competitor-comparison` sessions. Use as the integration-layer yardstick (not the mechanism-layer one).
- **Trace event types** — `kernel-state-snapshot`, `verifier-verdict`, `harness-signal-injected`, etc. Spikes write same format.
- **Override hooks (in progress)** — `Verifier`, `VerifierRetryPolicy` injection on `KernelInput`. Pattern continues per Rule 9.

### Build as needed (not preemptively)
- **`prototypes/` directory** — created when the first spike is written, not before
- **Provider wrappers** (`providers.ts`) — extracted after the same wrapper code is copy-pasted twice
- **Task spec format** — extracted after the same task is referenced from two spikes
- **Response cache** — added when same LLM call is made twice during analysis (huge force multiplier; ~30 LOC)
- **Frozen judge container** — set up before the first cross-spike comparison

The order is: write code → feel the pain → extract the abstraction. Never the reverse.

---

## 6. The Loop, Mechanically

```
1. HYPOTHESIS    Falsifiable. Written FIRST in prototype's file header.
                 ↓ PROMOTION + KILL criteria locked before coding
2. PROTOTYPE     ~80–200 LOC, raw provider SDK, ZERO @reactive-agents/* imports
                 ↓ one mechanism, isolated
3. EXPERIMENT    Provider matrix × task matrix × {with-M, without-M} × N seeds
                 ↓ deterministic where possible (temp=0, response cache)
4. MEASURE       SIX signal levels (behavioral, mechanistic, quality, cost, robustness, surprise)
                 ↓ JSONL → existing rax-diagnose CLI
5. INTERPRET     Per-task / per-provider; CIs, not point estimates; surprises documented
                 ↓ written summary, RESULTS.md mandatory
6. PROMOTE/KILL  Explicit gates from step 1 → port to harness OR archive
                 ↓ promoted spikes become regression tests
7. INTEGRATE     Harness implementation, with overridable hook (Rule 9), unstable marker (Rule 10)
```

Steps 1–6 happen **before any harness code is touched**. That is the discipline.

---

## 7. Anti-Patterns To Eliminate

- **Shipping multiple architectural changes per session and validating only at the end.** Each change is its own spike, its own hypothesis, its own promotion gate.
- **Building infrastructure first.** Hand-roll the first instance. Extract abstractions only on demand.
- **Public-API exposure ahead of validation.** `_unstable_*` until proven.
- **Single-model validation as evidence for cross-provider claims.** "Worked on qwen3" ≠ "the mechanism works."
- **Overclaiming small-sample results.** Two-decimal-place agreement on n=15 is a rounding artifact, not signal.
- **Branch hygiene drift.** PRs land via clean branches off main; long-running feature branches accumulating unrelated work are a code-review hazard and a release-notes nightmare.
- **Sunk-cost reasoning.** "We built this, surely it does *something*" is invalid. If the spike says no, the harness mechanism is a deletion candidate regardless of how much work went into it.

---

## 8. The Long-term Outcome

After 4–10 sessions of this discipline, the expected state:

- A `prototypes/` directory with single-mechanism spikes, each with hypothesis + result + recommendation
- A `RESEARCH_LOG.md` with mechanism × provider × outcome matrix
- 2–6 mechanisms PROMOTED to harness based on spike evidence
- 4–10 mechanisms KILLED with written record (so they don't get re-proposed)
- The harness itself **smaller** than today, retroactively trimmed: anything whose spike-equivalent showed no lift carries a deprecation marker, then deletion
- A v1.0 README that writes itself: "the harness provides X, Y, Z — here's the empirical evidence each contributes lift across providers"

**This is the path from "complex framework with vibes" to "simple framework with proof."** The vision document's "control over magic" pillar is best served by a small harness with proven primitives, not a large one with hopeful ones.

---

## 9. Failure modes for THIS discipline (and mitigations)

| Failure mode | Mitigation |
|---|---|
| Research without commitment to ship | Every spike has explicit PROMOTION criteria from day one |
| Spike fidelity gap (works in 80 LOC, not in harness) | Promoted spike becomes regression test against integrated version |
| Novelty bias (chase new mechanisms, ignore validating existing ones) | Priority: validate existing harness behaviors against bare-LLM first |
| "Everything is interesting" | RESEARCH_LOG.md entry mandatory; force discipline of "what was the result?" |
| Demo-coupling (optimize for the bench) | Spike must work on N≥3 unseen tasks before promotion |
| Discipline erosion over time | This document is the contract; changes require explicit commit |

---

## 10. Pinned Decisions

These are locked decisions of the project. To change one, open an explicit discussion + commit:

1. **The minimum kernel sketch** in §2 is the convergence target.
2. **Hypothesis-first, single-file spike, cross-provider validation** is the validation methodology (Rules 1–4).
3. **Promotion / kill / refactor** are the only valid spike outcomes (Rule 6).
4. **Bottom-up, demand-driven abstraction** is the implementation discipline (Rule 8).
5. **Control-pillar override hooks for every mechanism** is the design constraint (Rule 9).
6. **`_unstable_*` until validated** is the API stability discipline (Rule 10).

---

*This contract supersedes ad-hoc development practices. It is the operating document for the harness research and design phase, until v1.0 ship.*
