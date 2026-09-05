# Harness Report: `_enableMemory` / `_enableMemoryConsolidation` default-on ablation

**Date:** 2026-09-03
**Warden:** ablation-warden
**Trigger:** W6 (memory hygiene), the last open item in
[[2026-08-24-external-research-convergence-amendment]]. F-6 (memory writes
unguarded) has since been fixed (`a6ff634b`, same-day). This report answers
the amendment's explicit assignment: *"then measure defaulting
`MemoryService.bootstrap()/flush()` on"* — for **both** flags gating the
memory stack (`_enableMemory`, `packages/runtime/src/builder.ts:346`;
`_enableMemoryConsolidation`, `builder.ts:451`).

## Verdicts

| Flag | Verdict | Basis |
|---|---|---|
| `_enableMemory` | **REWORK** — stay opt-in (`.withMemory()`/`.withLearning()`) | +80.6%/+120.9% billed-token overhead vs 15% ceiling, cross-tier divergence — both independently REWORK-triggering |
| `_enableMemoryConsolidation` | **REWORK** — stay opt-in (`.withMemoryConsolidation()`) | 0.0pp lift on both tiers tested (no-lift clause); also inherits its prerequisite's REWORK since it is only user-visible when memory recall is also on |

Neither flag clears the lift rule. Recommendation to the amendment owner:
**close W6 without flipping either default.** The guardrail/dedup/provenance
work already shipped (F-6, `a6ff634b`) stands on its own merits (closes a
real vulnerability class) independent of this default-on question, and
should not be read as evidence for defaulting the mechanism on.

---

## 1. `_enableMemory` — MemoryService bootstrap()/flush()

**This flag was already measured** in
[[../Ablations/2026-08-21-memory-bootstrap-flush-default-on.md]]
(`packages/benchmarks/src/memory-bootstrap-ablation.ts`, 2-session
same-`agentId` protocol, cogito:14b n=4 / qwen3:14b n=3, manipulation-checked
via direct SQLite row counts, 0/7 `BROKEN-NO-OP`). Verdict then: **REWORK**.

| Tier | Lift | Token overhead |
|---|---|---|
| cogito:14b | +100.0pp | +80.6% |
| qwen3:14b | +66.7pp | +120.9% |

Real, large, cross-tier-consistent-in-direction lift — but both tiers blow
through the >30% unconditional-REWORK overhead threshold by 3–8×, and the
lift/overhead pair itself diverges enough between tiers (100pp/80.6% vs
66.7pp/120.9%) to independently trip the "cross-tier divergence = unstable
mechanism" clause. Overhead is dominated by `memory-flush.ts`'s post-run LLM
extraction pass (`MemoryExtractor.extractFromConversation`), not the
recall-injection itself.

**Why this was not re-run for this report.** The only code change to the
`_enableMemory` write path since 2026-08-21 is F-6
(`packages/runtime/src/memory-guardrails.ts`, `a6ff634b`, 2026-09-03same day),
which wraps `storeSemantic`/`logEpisode` with `detectInjection`/`detectPii`
before persist. Both detectors are confirmed by direct source read to be pure,
deterministic, non-LLM:

```
packages/guardrails/src/detectors/injection-detector.ts:30:
  export const detectInjection = (text: string): Effect.Effect<DetectionResult, never> =>
packages/guardrails/src/detectors/pii-detector.ts:18:
  export const detectPii = (text: string): Effect.Effect<DetectionResult, never> =>
```

`Effect<_, never>` — no LLM call is possible on this path (an LLM-backed
detector would carry a provider-error channel, not `never`). F-6 therefore
cannot move the token or accuracy axes that the 2026-08-21 ablation measured;
re-running it would burn live-model budget to reconfirm a number the code
proves cannot have changed. The REWORK verdict for `_enableMemory` stands.

## 2. `_enableMemoryConsolidation` — MemoryConsolidatorService REPLAY→CONNECT→COMPRESS

### Mechanism (code-level, verified 2026-09-03)

`MemoryConsolidatorServiceLive` (`packages/memory/src/services/memory-consolidator.ts`)
is instantiated at its sole runtime call site, `packages/runtime/src/runtime.ts:731-734`,
**without** an `onConnect` callback:

```ts
const memoryConsolidationOptLayer = options.enableMemoryConsolidation
  ? MemoryConsolidatorServiceLive(options.consolidationConfig).pipe(
      Layer.provide(memoryLayer),
    )
  : Layer.empty;
```

That makes `connect()` (the CONNECT phase) an unconditional no-op
(`memory-consolidator.ts:119-122`: `onConnect ? ... : Effect.succeed(0)`).
REPLAY (`replay()`) is a `COUNT(*)` over `episodic_log`. COMPRESS
(`compress()`) is an `UPDATE ... importance = importance * ?` decay pass plus
a `DELETE` for anything below `pruneThreshold`. **Zero `LLMService.complete`
or `.embed` calls anywhere in `consolidate()`** — this is a pure-SQL
background hygiene job. This means the mechanism's billed-token overhead is
**architecturally 0% by construction**, not merely measured-low; the only
open empirical question is whether decay/prune materially help or hurt
cross-session **recall accuracy**.

A second finding, not previously documented: despite `withMemoryConsolidation()`'s
JSDoc stating "Requires `.withMemory()`", the code does not enforce that —
`_enableMemoryConsolidation` alone trips `memoryStackNeeded` in
`runtime.ts:587-590` independent of `_enableMemory`. In practice this is
inert without memory: bootstrap/recall-injection (`bootstrap.ts`,
`reasoning-think.ts`) reads from `MemoryService`, which is wired only when
`_enableMemory` is true, so a consolidation-only agent has nothing in the
prompt to consolidate visibly. Flagged for the domain owner as a doc-accuracy
item (out of ablation-warden's edit scope); not fixed here.

### Protocol

New script (typechecks clean,
`bunx turbo run typecheck --filter=@reactive-agents/benchmarks`):
`packages/benchmarks/src/memory-consolidation-ablation.ts`. Same
2-session/same-`agentId`/same-`dbPath` fact-recall protocol as the
`_enableMemory` ablation (fresh fact triple: codename `Wrenshadow-9`, region
`ap-southeast-1`, contact `Marco Diallo`; session 1 forces exactly 3
`note-fact` tool calls → `classifyComplexity` = `complex` → blocking flush;
session 2 asks for recall without restating facts).

Both arms have memory ON (isolating consolidation's **marginal** effect,
since consolidation is inert without memory per above):

- **Arm A (`memory-only`)** — `.withLearning({ tier: "standard", dbPath })`.
- **Arm B (`memory-plus-consolidation`)** — same, plus
  `.withMemoryConsolidation({ threshold: 1 })`. `threshold: 1` overrides the
  default of 10 pending runs so a single non-trivial session actually
  triggers a `consolidate()` cycle within this short protocol (default
  threshold would never fire in a 1–2 session test).

**Manipulation check:** after session 1 in arm B, `consolidation_state.total_runs`
is queried directly from the SQLite file. A cell is flagged `BROKEN-NO-OP` if
`total_runs < 1`. **Result: 0/6 broken** — all 6 arm-B cells across both
tiers show `total_runs: 1, semanticRows: 3`, confirming `consolidate()`
genuinely ran.

**Tiers:** `ollama/cogito:14b`, `ollama/qwen3:14b` (both locally reachable,
confirmed via `ollama list`). n=3 per arm per tier, all 12 cells completed
clean (no throws, no `BROKEN-NO-OP`).

### Results

```
ollama/cogito:14b: memory-only acc=100% (3/3) memory+consolidation acc=100% (3/3)
  lift=0.0pp | tok base=6661 cand=6243 overhead=-6.3% | brokenPlus=0/3
ollama/qwen3:14b:  memory-only acc=100% (3/3) memory+consolidation acc=100% (3/3)
  lift=0.0pp | tok base=7816 cand=8008 overhead=+2.5% | brokenPlus=0/3
```

Full per-cell JSON (12 cells, both tiers) captured in the script's stdout;
representative cell (qwen3, run2, arm B): session-2 output —
*"(a) This project's codename is **Wrenshadow-9**. (b) Its primary deployment
region is **ap-southeast-1**. (c) The on-call contact is **Marco Diallo**.
These details were retrieved from verified memory entries with a confidence
score of 0.76 and corroborated by recent episodic records."* — recall
correct, and the entropy-decay reranking is visibly surfacing in the model's
own phrasing ("confidence score", "corroborated by recent episodic
records"), so the mechanism is doing something, just not something this
protocol can detect as a correctness delta.

### Lift-rule application

| Tier | Lift | Token overhead |
|---|---|---|
| cogito:14b | 0.0pp | -6.3% (noise, well within ceiling) |
| qwen3:14b | 0.0pp | +2.5% (noise, well within ceiling) |

Token overhead clears the ≤15% PASS ceiling on both tiers by a wide margin,
consistent with the code-level zero-LLM-call finding above (the ±2–6% is
run-to-run token noise in the LLM's own response length, not a consolidation
cost). **But lift is 0.0pp on both tiers — the no-lift clause of the REWORK
rule applies unconditionally**, independent of how cheap the mechanism is.

**Honest limitation, stated rather than smoothed over:** both arms saturate
at 100% recall on this task — memory-only already answers all 3 facts
correctly every time, so there is no headroom left for consolidation to show
incremental lift, regardless of whether consolidation's decay/rerank
mechanics are doing anything useful. This is a ceiling-effect confound, not
proof the mechanism has zero value in general. Consolidation's actual value
proposition (per its own docstring: keep the semantic-memory store from
becoming an unbounded, noisy landfill across dozens of sessions) is not
something a 2-session single-fact-triple protocol can exercise — that would
require a long-running multi-session corpus with fact churn/contradiction,
which is out of this report's scope and budget. Recorded as the honest
reason the REWORK verdict here is weaker evidence than the `_enableMemory`
verdict above (that one failed on hard cost data; this one fails on a
lift-rule technicality against a task that can't discriminate).

## 3. Recommendation

1. **Do not flip either `_enableMemory` or `_enableMemoryConsolidation` to
   default-on.** Both remain opt-in via `.withMemory()`/`.withLearning()` and
   `.withMemoryConsolidation()`.
2. **Close W6** in the 2026-08-24 amendment on this basis — the guardrail
   screening (F-6) is already shipped and independently justified (closes a
   real memory-poisoning vulnerability class per the 2026 literature), the
   default-on question it was gating has now been measured for both flags,
   and both come back REWORK.
3. If a future pass wants to re-test `_enableMemoryConsolidation` for lift, it
   needs a protocol that isn't already at 100% ceiling for the base memory
   mechanism — e.g. a longer multi-session run (10+ non-trivial sessions, the
   real default `threshold`) with intentionally noisy/contradictory
   semantic-memory writes, measuring whether consolidation's decay/prune
   improves recall precision (fewer stale/contradictory facts surfaced) or
   downstream token cost (smaller `semanticContext` block on later
   bootstraps) relative to an unconsolidated store of the same age. That is a
   materially larger ablation than this report's budget and is flagged here
   as a possible future item, not run.
4. `builder.ts`'s `withMemoryConsolidation()` JSDoc ("Requires
   `.withMemory()`") is descriptive of the *useful* configuration, not an
   enforced constraint — flagged as a minor doc-accuracy item for the domain
   owner, not fixed here (out of ablation-warden's edit authority).

## Artifacts

- Prior ablation (reused, not re-run):
  `wiki/Research/Ablations/2026-08-21-memory-bootstrap-flush-default-on.md`,
  script `packages/benchmarks/src/memory-bootstrap-ablation.ts`
- New script (this report):
  `packages/benchmarks/src/memory-consolidation-ablation.ts`
  (typechecks clean via `bunx turbo run typecheck --filter=@reactive-agents/benchmarks`)
- F-6 guardrail commit cited: `a6ff634b`
  (`packages/runtime/src/memory-guardrails.ts`,
  `packages/memory/src/services/memory-service.ts`)
