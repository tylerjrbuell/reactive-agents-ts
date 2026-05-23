---
tags: [mission, vision, north-star-companion, guiding-statements]
date: 2026-05-23
status: draft (data + community signal still to land)
companion: 00-VISION.md, 05-DESIGN-NORTH-STAR.md, 02-FAILURE-MODES.md
purpose: positive, measurable, falsifiable statements of how the harness IS at full realization
---

# Mission Statements — How the Harness Functions at Full Realization

> **Vision** says WHY. **North Star** says WHAT. **This document says HOW the system behaves when it works** — the day-to-day signature of the harness running as designed.
>
> Every statement is **positive** (declares what is, not what isn't), **measurable**, and **falsifiable**. If the runtime stops matching a statement, that statement is broken.

---

## The North — One Sentence

**The harness produces reliable, observable, composable agent behavior across any model tier, with every decision auditable to its source signal, and every advertised capability backed by a live wired runtime.**

If a user runs an agent and cannot answer: "Why did it do that? What signal caused it? What surface could I have changed?" — the harness has failed its mission.

---

## Mission Statements by Vision Pillar

### Pillar 1 — Control

**Mission:** Every harness emission — prompts, nudges, tool schemas, observations, decisions, terminations — is reachable, overridable, and observable through a single typed surface.

**Success metric:** ≥95% of injection points (`02-FAILURE-MODES.md` audit count: 24) have a Compose-API tag with a live emit site. Zero "scaffold without caller" surfaces.

**Manifestation:** A user wanting to swap any framework default does it in ≤3 lines of code without forking. A user wanting to inspect any framework default does it in ≤1 line. A future-tag never needs a new API call site.

### Pillar 2 — Observability

**Mission:** Every state transition, every decision, every intervention, every LLM exchange, every tool call has a typed trace event. The trace tells the complete narrative — no parallel "hidden" channels.

**Success metric:** 100% of `state.status` transitions emit `kernel-state-snapshot`. 100% of LLM round-trips emit `llm-exchange`. 100% of intervention decisions (RI + Compose + verifier + healing + killswitch) emit through the same observation pipe. Trace events are sufficient to replay any run deterministically.

**Manifestation:** `rax-diagnose replay <runId>` reproduces full agent narrative without reading source. Strategy-bypassing-kernel pattern (F1) is impossible — emit lives at capability boundary.

### Pillar 3 — Flexibility

**Mission:** Strategies are declarative compositions of capabilities, not parallel loop reimplementations. New algorithmic shapes (BFS, critique, plan-revision) are first-class primitives; new strategies are array literals.

**Success metric:** A new strategy adds ≤200 LOC including tests. Capability instrumentation (snapshots, verifier, RI hooks, llm-exchange) is inherited, not re-wired.

**Manifestation:** Adding a 6th reasoning strategy is a code review, not a 1,500-LOC pull request. The capability set is the framework; strategies are recipes over it.

### Pillar 4 — Scalability

**Mission:** Agent count and concurrency grow without compounding state-mutation hot paths. State is owned by the Loop Controller; capabilities are pure; effectors are isolated.

**Success metric:** `state.status=` assignment outside the canonical `transitionState()` helper = lint failure. ≤10 mutation sites total across the kernel. Per-run state cost is O(steps), no global mutation.

**Manifestation:** Spawning N agents in parallel produces N independent traces with zero cross-leakage. State invariant `status=failed → output=null` holds across every termination path without per-path enforcement.

### Pillar 5 — Reliability

**Mission:** Termination is decided by exactly one Arbitrator per iter. Five signal sources (entropy, verifier, healing, killswitch, strategy-evaluator) feed one Verdict (`continue | exit-success | exit-failure | escalate`). No parallel deciders.

**Success metric:** Single function `Arbitrator(signals, state) → Verdict`. Loop Controller is sole consumer. ≥99% of probe corpus terminates through Arbitrator. Zero out-of-Arbitrator termination paths in non-test code.

**Manifestation:** "Why did the agent stop?" answers from one trace event with one origin file. No "agent appeared to succeed but actually failed because system X overrode system Y" failure modes.

### Pillar 6 — Efficiency

**Mission:** The harness intervenes only when its intervention has measurable lift on outcome. Mechanisms that add tokens without adding accuracy ship as opt-in or get pruned.

**Success metric:** Every mechanism (M1–M14) has empirical lift evidence ≥ +3pp success rate OR ≥ +10% token efficiency on its target failure mode. No mechanism stays in default-on after a 2-quarter no-lift ablation. Pruning Principle (`05-DESIGN-NORTH-STAR.md §9`) gates additions.

**Manifestation:** `withLeanHarness()` produces near-equivalent outcome to default config on simple tasks at significantly lower token cost. Default config is justified by failure-mode coverage, not "more is better."

### Pillar 7 — Security

**Mission:** Every tool call passes through an explicit risk/approval gate. Identity, guardrails, and cost limits are enforced at boundary, not advisory. Verdicts respect those gates as inputs, not afterthoughts.

**Success metric:** 100% of tool dispatches read through a uniform `executeToolCall()` capability — including plan-execute's direct dispatch path. 100% of `riskLevel: "high"` tools require explicit approval (configurable). No tool bypass routes around guardrails.

**Manifestation:** A new tool inherits framework-wide safety semantics by virtue of being registered. The "I forgot to enforce X for this strategy" failure mode is structurally impossible.

### Pillar 8 — Speed

**Mission:** Token cost, wall-clock latency, and intervention latency are first-class measurements visible per iter. Slowness is observable; nothing waits for post-run analysis.

**Success metric:** Per-iter latency budget visible in trace. `provider.thinking-mode-active` detected within first 5s when active. RI dispatcher decision latency ≤ 5ms per iter. `provider.tier-routing` decision latency ≤ 2ms per iter.

**Manifestation:** Users see slow phases in real-time via stream events. A 78-second think (F8) surfaces with a structured event, not as wall-clock dread.

---

## Mission Statements by Capability (the 10)

### Sense
**Statement:** Observation sensors are pure functions; same inputs produce same observations; observations carry trust labels.
**Metric:** Zero side effects in `kernel/capabilities/sense/`. Every observation has a `trustLevel` field populated at source.

### Attend
**Statement:** ContextCurator is the single owner of prompt assembly. All other potential prompt-modifying systems emit advisory signals the curator consumes.
**Metric:** One author for `prompt.system` content; zero competing mutations to `state.messages` outside curator.

### Comprehend
**Statement:** TaskComprehender returns a typed task representation at run start. Soft requirements (named tools, format hints) are extracted and queryable for downstream capabilities.
**Metric:** Every task produces a `ComprehendResult` with required-tools, soft-required-tools, format-hints, complexity-class fields. F4/F5-class failures (named tool ignored) become structurally impossible.

### Recall
**Statement:** Memory queries are first-class capability calls, not implicit retrieval. The agent asks; memory answers; both are traced.
**Metric:** Every `recall` invocation emits `memory-recall` event. Memory state is observable per iter (`state.memoryContext`). Cross-session persistence is opt-in but works when on.

### Reason
**Statement:** LLM exchanges happen through one capability boundary that emits `llm-exchange` for every round-trip. Provider quirks are encapsulated; capability semantics are uniform.
**Metric:** 100% of LLM calls trace through `reason/think.ts` or `reason/structured-output.ts`; both emit `llm-exchange`. No provider-direct calls bypass.

### Decide
**Statement:** One Arbitrator integrates all signals into one Verdict per iter. Strategy switching, early stop, retry, escalate are Verdict shapes, not parallel mechanisms.
**Metric:** Single function in `capabilities/decide/arbitrator.ts`. Five signal types reach it. Loop Controller is sole caller. (Pillar 5 detail.)

### Act
**Statement:** Tool execution flows through one capability regardless of caller. Diagnostics, healing, and guardrails fire from the capability — not the strategy.
**Metric:** Single `executeToolCall()` entry point. Plan-execute's direct dispatch routes through it. Healing wired at capability `onError`. Approval gates wired at capability `before`.

### Verify
**Statement:** Verifier emits per-check severity ladder, not single boolean. The Arbitrator interprets severity into a Verdict. Soft-failed checks surface as warnings; hard-failed checks block terminal output.
**Metric:** `VerifierVerdict` shape extends from `{verified:bool}` to `{checks: {name, severity, reason}[]}`. Severity ∈ `{pass, warn, reject, escalate}`. Output gate respects severity, not boolean collapse.

### Reflect
**Statement:** ReflectionEngine is one entry point. Loop-detector, reactive-observer, strategy-evaluator are sub-components feeding it. Reflection emits structured signals, never directly mutates state.
**Metric:** Single `reflect()` call site in runner. Subcomponents are pure; state mutations are deferred to Arbitrator/Loop Controller.

### Learn
**Statement:** Each iter ends with a Learn step writing to calibration, memory, and skill registry. Within-session learning is immediate; cross-session learning is durable.
**Metric:** `kernel/capabilities/learn/` directory exists. Every iter emits `learn-write` event with N targets. Cross-session repeat measurable lift ≥ +5pp on M6/M10 gate corpus.

---

## Mission Statements by Trait (the 5)

| Trait | Mission (positive) | Observed by user as |
|---|---|---|
| **Comprehension** | The agent understands its task accurately and stays oriented. | Sticks to task scope; respects nominated tools; flags ambiguity. |
| **Strategic intent** | The agent has a chosen approach and terminates intentionally. | Termination is justified by one clear signal, not by accident. |
| **Effective action** | The agent's actions land — they execute, they verify, they progress. | Tool calls succeed or fail loudly; output is grounded in observation; success is not faked. |
| **Self-monitoring** | The agent notices when it's stuck and changes approach. | Loops are detected fast; recovery is visible; "stuck silently" is impossible. |
| **Compounding intelligence** | The agent gets better the more it runs — within session and across. | Session 2 outperforms session 1 on repeat tasks; calibration tightens with usage; skills accumulate. |

---

## Success Metrics Ladder

Three altitudes. Each must hold for the harness to claim its design.

### L1 — Structural (always green, automated)
- `bun test` workspace pass rate ≥ 99%
- Type-checks clean across all packages
- ≤10 `state.status=` mutation sites
- 100% of declared TagMap entries have ≥1 emit site
- 100% of capability dirs match North Star §4.3 list (currently missing: `learn/`, `recall/`)

### L2 — Observability (every run, automated)
- Every probe trace passes `rax-diagnose validate` (TBD: new tool that checks event coverage by strategy)
- Trace duplication rate ≤ 1% (E5)
- Trace-to-replay determinism: identical inputs → ≥99% byte-identical replays via `@reactive-agents/replay`

### L3 — Outcome (gate corpus, quarterly)
- Failure-corpus AUC ≥ 0.95 for entropy-driven decisions
- Phase-1 mechanism verdicts (M1–M14): no regression to "REMOVE" from "KEEP"
- Cross-tier benchmark: ≥90% success on frontier (claude-haiku-4-5), ≥70% on local large (qwen3:14b), ≥50% on local mid (cogito:14b) for gate scenarios
- Pruning Principle: no default-on mechanism without empirical lift evidence
- Trust differentiator (FM-E1): `status=failed → output=null` invariant 100% across all runs

---

## Anti-Mission — What the Harness Explicitly Is NOT

These define the boundary. Useful precisely because they're tempting failure modes.

1. **NOT a magic black box.** Every decision traces to a signal traces to a source line. "It worked, don't know why" is a bug.

2. **NOT a frontier-only framework.** Local tier (cogito:14b, qwen3:14b) is a first-class target. If a feature only works on frontier, it ships behind a `requiresTier: "frontier"` flag.

3. **NOT a config menu.** 24 named override methods is the failure mode. One composition surface with tag-based pattern matching is the design.

4. **NOT a system that hides failure.** Honest-fail (`status=failed → output=null`) is the trust differentiator. We never paper over verifier rejection with synthesized fallback text.

5. **NOT an instrumentation-late framework.** Every shipped capability emits a trace event in the same commit. "We'll add traces later" is a permanent debt.

6. **NOT an advertised-surface-without-callers framework.** A declared tag, a typed decision variant, a calibration field — each MUST have a live emit/consumer site in the same commit. The "scaffold without caller" anti-pattern (R2/R3/R4) is rejected.

7. **NOT a framework that owns the application loop.** RunHandle exposes pause/stop/terminate. The user owns the agent; the framework offers the loop. Hijacking control is a bug.

8. **NOT a unitary intelligence.** No single Strategy / single Model / single Verifier monopolizes decisions. Composition is the substrate; primitives are replaceable.

---

## How To Use These Statements

- **For a code review:** does this PR move us toward any L1/L2/L3 metric? If neutral or negative, is the reason documented?
- **For a new feature:** which capability mission does it serve? Which anti-mission does it risk violating?
- **For a roadmap item:** which pillar mission has the largest gap to its success metric today? Work there first.
- **For a debrief:** did the shipped change improve its target metric? Empirically, by how much?
- **For a refactor:** does the refactored code make a mission statement easier to enforce structurally? If not, it's polishing.

---

## Drift Detection

This document is paired with the empirical reports under `wiki/Research/Harness-Reports/`. Every quarter, audit:

- L1 metrics → automated check (CI lint candidate)
- L2 metrics → harness sweep probe (this skill's loop)
- L3 metrics → gate-corpus run

If any metric drifts > 5% in a quarter, the corresponding mission statement is amended OR the drift is fixed. **Documents bend to reality OR reality bends to documents** — never both silently.

---

## Provenance

- Drafted: 2026-05-23, harness sweep session
- Empirical basis: `wiki/Research/Harness-Reports/sweep-2026-05-23-qwen3-14b.md`, `architecture-drift-analysis-2026-05-23.md`, `capability-mapping-2026-05-23.md`, `event-coverage-diff-2026-05-23.md`, `elegance-robustness-intelligence-audit-2026-05-23.md`
- Cross-strategy matrix run in flight at draft time — metrics may sharpen post-data
- Companion to (not replacement for): `00-VISION.md`, `05-DESIGN-NORTH-STAR.md`

---

## Living Document Convention

Every change to a mission statement requires:
1. Empirical evidence the statement is wrong OR aspirational target has changed
2. Reference to the failure mode or capability gap that motivates the change
3. Updated success metric — declarative, not aspirational fog

Statements get **stricter over time, not vaguer**. The framework's promise compounds.
