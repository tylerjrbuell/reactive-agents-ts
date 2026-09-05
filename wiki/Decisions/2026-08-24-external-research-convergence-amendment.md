---
aliases: [External Research Convergence Amendment, 09 Amendment 2026-08-24]
tags: [decision, ratification, north-star, amendment]
date: 2026-08-24
status: RATIFIED (W1-W3 shipped 2026-09-03)
amends: "wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md"
---

# 2026-08-24 — External Research Convergence Amendment (amends 09 §5.3, §6, §7)

**Status:** RATIFIED. All 4 items in §5 are accepted and, as of 2026-09-03, W1-W3
are shipped:

- **W1 (cost instrument truth)** — `LLMRequestCompleted` now has a producer;
  billed-token leg (`inputTokens − cacheReadInputTokens`) lands in the lift
  gate. `RA_STABLE_TOOL_SURFACE` was re-measured under the corrected leg by
  the promotion band directly (n=20 pooled, Sonnet) — **REMOVE**, +66.5%
  billed overhead vs the 15% ceiling. Flag deleted at the root
  (`wiki/Research/Harness-Reports/2026-08-27-stable-surface-promotion.md`).
- **W2 (cache explainability)** — folded into the dead-signal-wiring pass;
  OTel LLM spans now populate.
- **W3 (profile completion)** — `toolDisclosureMode` (F-4) wired via
  `fromDisclosureMode()`; `.withHarness()` ships as the config>env>default
  harness control surface (`wiki/Planning/Implementation-Plans/2026-08-27-harness-control-surface.md`).

**Open:** W4 (harness-quality metrics), W5 (τ-bench run — F-7), W6 (memory
guardrail wiring — F-6), W7 residue (MCP server surface, trace schema — F-8).

**Trigger.** An external research pass (`state-of-ai-agents-2026.md`, reviewed
2026-08-24) was validated against primary sources and then checked against this
codebase. The doc's structural claims hold; several of its numbers do not. The
codebase check produced six findings that change 09's ordering, and one that
invalidates a measurement ruling 09 currently treats as settled.

---

## 1. What the external research actually established

Validated against primary sources. Kept only where a source confirmed it.

| Claim | Verdict | Source |
|---|---|---|
| Agent design patterns = Cognitive Function × Execution Topology, 7×6 = 28 patterns, five pattern-selection laws | **Real, but a taxonomy** validated by descriptive coverage over 4 domains — not production telemetry. Do not cite its "laws" as measured. | [arXiv 2605.13850](https://arxiv.org/abs/2605.13850) |
| Harness engineering is a named discipline; 70-system study over 5 dimensions (subagent architecture, context management, tool systems, safety, orchestration) | Real | [arXiv 2602.14690](https://arxiv.org/pdf/2602.14690) |
| Microsoft Agent Framework 1.0 GA (2026-04-03); AutoGen → maintenance mode; MAF is successor to AutoGen + Semantic Kernel; native MCP + A2A | Real | Multiple, incl. [AutoGen sunset](https://agentmarketcap.ai/blog/2026/04/13/microsoft-autogen-maintenance-mode-agent-framework-sunset-2026) |
| Compaction is the 2026 convergence answer to context rot; safety constraints can be silently erased by summarization | Real, and **directly relevant** — see §3 C-2 | [arXiv 2606.22528](https://arxiv.org/pdf/2606.22528) |
| EU AI Act enforcement powers land 2026-08-02, driving demand for an agent control plane | Real | [Trussed AI](https://trussed.ai/resources/eu-ai-act-enforcement-august-2026-guide) |
| Compact-model agentic RAG via distillation-guided policy optimization at ~0.5B | Real, but the doc **misnames it** ("Direct and Dual-Guided"); actual = *Distillation*-Guided | [arXiv 2508.20324](https://arxiv.org/abs/2508.20324) |

**Rejected — do not let these drive a decision:**

- **"Classification-head fine-tuning gives +25pp on tiny models."** Inflated
  roughly 10×. The actual paper reports **+2–3pp** at 0.6B/1.7B on verifiable
  multiple-choice ([arXiv 2607.03801](https://arxiv.org/abs/2607.03801)).
- **"4.5M production executions, 56.6% end-to-end success"** and **"harness
  accounts for up to 30pp of variance."** No source located. Directionally
  plausible, unsourced. Not admissible under 08's honest-claims law.
- **The benchmark table.** Understates current frontier agents (doc: SWE-bench
  agent ~70–75%; April 2026 actual: 87.6%). More importantly it omits the
  decisive 2026 fact: UC Berkeley RDI (2026-04-12) demonstrated an automated
  scanner reward-hacking **all eight** major agent benchmarks, and leaderboard
  scores carry 5–15pp of contamination/scaffolding inflation.

**Consequence of that last point, and it is a strategic one.** The field's
benchmark layer just lost credibility at the exact moment enterprises started
buying on it. RA already ships the antidote — deterministic replay, receipts, a
lift gate with a promotion band, and a written rule that a surprising measurement
indicts the instrument first. That is currently RA's least-marketed and most
defensible asset. §4 W5 makes it legible.

---

## 2. Codebase findings (the decisive signals)

Every row verified against source on 2026-08-24.

### F-1 — `LLMRequestCompleted` has nine consumers and zero producers

The per-call LLM cost/token event is **dead**. Declared at
`packages/core/src/services/event-bus.ts:184-205`. Consumed by:

- `packages/benchmarks/src/runner.ts:163-165` (bench token/cost accumulation)
- `packages/observability/src/metrics/metrics-collector.ts:152`
- `packages/observability/src/telemetry/telemetry-collector.ts:101` (builds `RawRunData`)
- `packages/runtime/src/runtime.ts:924`
- `packages/observe/src/tracer.ts:122`
- `apps/cortex/server/services/ingest-service.ts:59`, `apps/cortex/server/db/queries.ts:401`
- `apps/cortex/ui/src/lib/stores/{agent,signal,trace}-store.ts`

Producers, across `packages/**` and `apps/**`, excluding tests and `dist/`:
**none**. A repo-wide grep for `_tag: "LLMRequestCompleted"` outside `event-bus.ts`
returns only test fixtures.

This is 09 §6.7's "work paid for and discarded" at its most expensive site: the
bench's `cumulativeTokens` accumulator never increments, Cortex's live token and
cost readouts never populate, and the telemetry collector's per-call metrics are
structurally empty. Bench totals survive only because `runner.ts:237` falls back
to `agentResult.metadata.tokensUsed`.

### F-2 — Cache accounting reaches the trace and dies there

`cacheReadInputTokens` is produced correctly by the Anthropic adapter
(`packages/llm-provider/src/providers/anthropic.ts:497,820`) and lands in the
kernel exchange as `cacheReadTokensIn`
(`packages/reasoning/src/kernel/observable-llm.ts:172-173`).

Consumers of that field anywhere downstream: **one**, and it is a standalone
bench script (`packages/benchmarks/src/disclosure-ablation.ts:196`) that
re-reads it out of trace JSONL. It never reaches `AgentResult.metadata`, the
RunLedger receipt, `packages/cost`, or the lift gate.

### F-3 — The lift gate's token leg is cache-blind by construction

`packages/benchmarks/src/gate/gate.ts:206-208`:

```ts
const baseTokens = mean(pairedBase.map((r) => r.meanTokens));
const candTokens = mean(pairedCand.map((r) => r.meanTokens));
const tokenOverheadPct =
  baseTokens === 0 ? 0 : ((candTokens - baseTokens) / baseTokens) * 100;
```

`meanTokens` is `runner.ts:1010` — a plain sum of `tokensUsed`, which counts a
cached prefix read at full weight even though the provider bills it at ~0.1×.

**This is why 09 §5.3 reads the way it does.** `RA_STABLE_TOOL_SURFACE` is the
only arm that caches by construction, costs **4.4% less money**, and fails the
gate at +33.3% tokens against a 15% ceiling. 09 §5.3 says, correctly and
honourably, "§2 was not reinterpreted to fit the result." The finding here is
different and stronger: **the rule was not mismeasured against its own
definition — its definition stopped tracking cost when prompt caching shipped.**
Raw tokens were a sound cost proxy in a world without a 10× price step between
fresh and cached input. They are not one now.

The already-filed [[2026-07-29-lift-rule-cost-vs-tokens-amendment]] proposed USD
and was correctly not ratified — USD imports vendor pricing into a gate that must
stay comparable across providers and across time. §4 W1 takes the third option
that neither doc considered: keep the leg in **tokens**, but count **billed**
input tokens (`inputTokens − cacheReadInputTokens`) rather than raw. Provider-
neutral, no pricing table, and it restores the proxy's fidelity.

### F-4 — `toolDisclosureMode` is a declared, documented, unconsumed field

`packages/reasoning/src/context/context-profile.ts:93` declares
`toolDisclosureMode: "full" | "discover" | "index" | "hybrid"`, with 25 lines of
JSDoc, and states it "resolves from the per-tier default in `CONTEXT_PROFILES`."

- No entry in `CONTEXT_PROFILES` (`context-profile.ts:107-158`) sets it.
- No consumer reads `profile.toolDisclosureMode` anywhere in the repo.
- Only its sibling `toolIndexMaxEntries` is read
  (`kernel/capabilities/reason/think.ts:874,936`), and the mode that field
  belongs to is gated on the env flag `toolIndexEnabled()` instead.

09 §7 Step 4 describes profiles as future work. They are not — `ContextProfile`
already carries eight live per-tier fields across four tiers, with a tier
resolver (`profile-resolver.ts`) that handles provider-scoped disambiguation.
Step 4 is **finishing a seam that is 70% built and has one dead field in it**,
not a greenfield step. That materially raises its priority and lowers its cost.

### F-5 — Two 09 §6 debt items are stale (ratchet may go down)

- **§6.11 API-key prefix leak: FIXED.** `packages/runtime/src/build-validation.ts:353-363`
  now emits `(set)` / `(missing)` / `(not required)` / `(set via .withProvider config)`.
  No key material reaches the log.
- **§6.8 two memory consolidators: FIXED.** `packages/memory/src/extraction/`
  contains only `memory-extractor.ts`. `packages/memory/src/services/memory-consolidator.ts`
  is the sole implementation.

**§6.9 partially addressed, still open.** `packages/trace/src/replay.ts` now
rejects malformed lines via `isTraceEvent`, but its own JSDoc states this "only
checks that `kind`/`runId` are present — it is not a full per-kind schema check."
The instrument still admits any payload shape.

### F-6 — Memory writes bypass the guardrail layer entirely

`packages/guardrails/src/detectors/` ships `injection-detector.ts`,
`pii-detector.ts`, `toxicity-detector.ts`. A repo-wide grep for
`guardrail|Guardrail` under `packages/memory/src` returns **zero hits**.

Memory persistence therefore has no injection screening, no dedup gate, and no
provenance check on the write path, while `_enableMemory` defaults `false`
(`packages/runtime/src/builder.ts:345`). The 2026 literature names memory
poisoning a primary agentic vulnerability. RA has the detectors and does not
point them at the store.

### F-7 — τ-bench is built and has never been run

`packages/benchmarks/src/tau-bench/` contains `adapter.ts`, `loader.ts`,
`pass-k.ts`, and vendored airline + retail task sets with checksums. Ratified as
the external gate 2026-07-28 (`wiki/Hot.md`).

Reports in `wiki/Research/Harness-Reports/` referencing τ-bench: **zero**. The
only mentions in the vault are two planning documents. RA has an external gate
it has never walked through.

### F-8 — Cache hits are unexplainable; MCP is client-only

- Repo-wide grep for `prefixHash|surfaceHash|promptHash`: **zero hits**. When a
  cache read is 0 there is no artifact that says which prefix segment moved.
- `packages/tools/src/mcp/` contains `mcp-client.ts` and nothing else. RA
  consumes MCP servers; it cannot be one. `packages/a2a/` ships both
  `client/` and `server/` — the asymmetry is unintentional.

---

## 3. Convergence assessment (for the record)

**Where RA is already ahead of the 2026 literature** — these are strengths to
defend and market, not work items:

- **C-1. Trust spine.** Contract → ledger → gate → receipt → replay (09 C2/C3).
  The literature describes context governance and observability; nobody ships a
  falsifiable record. Reinforced by the benchmark reward-hacking crisis (§1).
- **C-2. Compaction that does not lie.** `packages/reasoning/src/assembly/compaction.ts`
  re-projects rather than rewrites, declares protected entry classes, and
  replaces dropped exchanges with stubs that enumerate resolvable refs. This is
  a direct, already-shipped answer to the governance-decay result in
  [arXiv 2606.22528](https://arxiv.org/pdf/2606.22528).
- **C-3. In-process control plane.** `packages/guardrails` + `packages/identity`
  + `kill-switch.ts` + `scripts/check-control-plane.sh`. The literature's
  position is that frameworks *lack* internal policy enforcement and need an
  external proxy. RA does not.
- **C-4. Deterministic purpose→tier model routing.**
  `packages/reasoning/src/kernel/policy/purpose-routing.ts`. LangGraph, MAF and
  CrewAI ship no equivalent.
- **C-5. Measurement discipline.** The lift rule, the ablation-warden veto, the
  three-rung ladder. 8 lift attempts, 0 passes, one clean deletion — RA measures
  where the field ships.

**Where RA diverges from the field** — these become §4:

| Divergence | Evidence | Workstream |
|---|---|---|
| Cost instrument is cache-blind end to end | F-1, F-2, F-3 | **W1** |
| Cache hits/misses are unexplainable | F-8 | **W2** |
| Per-tier profile seam is 70% built with a dead field | F-4 | **W3** |
| No harness-quality metrics (`packages/eval` = accuracy, completeness, cost-efficiency, relevance, safety) | §4 W4 | **W4** |
| No external, replayable benchmark number | F-7 | **W5** |
| Memory writes unguarded; memory default-off, unmeasured | F-6 | **W6** |
| MCP client-only; trace schema shallow | F-8, F-5 | **W7** (residue) |

---

## 4. Proposed amendment to 09 §7

09 §7's axis stands unchanged: *how much the harness spends per model turn and
how much it hides from the model.* The amendment changes **what measures that
axis, and in what order**, on the strength of §2.

### The rule change

**Amend 09 §2's lift rule token leg** from raw tokens to **billed input tokens**:

> Default-on requires ≥3pp accuracy lift AND ≤15% **billed-token** overhead,
> cross-tier, per task class, where billed input tokens =
> `inputTokens − cacheReadInputTokens` (falling back to `inputTokens` when a
> provider reports no cache figures). Output tokens are billed in full. The leg
> remains denominated in tokens, never USD.

Rationale in F-3. This supersedes neither leg of the AND, changes no threshold,
and imports no pricing table. `meanTokens` (raw) is retained on every receipt so
that no historical figure becomes unreadable and no prior verdict is silently
rewritten.

**Explicit consequence, stated before the work rather than after:** under the
corrected leg, `RA_STABLE_TOOL_SURFACE` may pass where it previously failed. That
is the point, and it is also the risk. The re-measurement in W1 must be run by
`ablation-warden` under the standard promotion band, and if it still fails, it
still fails. §2's "a surprising measurement indicts the instrument first" cuts
both ways: this amendment indicts the instrument, so the instrument's next
verdict must be earned, not assumed.

### Revised ordering

Step 0 residue and Steps 1–3 of 09 §7 are unchanged in intent; the amendment
inserts the instrument fix ahead of them, because every remaining step is
scored by it.

| # | Workstream | Why here | Gate |
|---|---|---|---|
| **W1** | **Cost instrument truth.** Fix F-1 (produce `LLMRequestCompleted`), F-2 (thread cache fields to metadata + receipt), F-3 (billed-token leg). Re-run the disclosure ablation under the corrected leg. | Every subsequent decision is scored by this instrument. Fixing it first is 09 §2's own doctrine applied to 09 §2. | Deterministic (rung 1) for the plumbing; `ablation-warden` for the re-measurement. |
| **W2** | **Cache explainability.** Stable-prefix hash + tool-surface hash on every exchange and receipt, so a `cacheRead=0` is attributable to a named segment. | Without it, W1's verdicts are unactionable — you learn *that* the cache missed, never *why*. Same slice as W1; ships with it. | Deterministic. |
| **W3** | **Profile completion.** Wire or delete `toolDisclosureMode` (F-4); set per-tier defaults; promote iteration budget, disclosure policy, context allocation and purpose→tier routing into the named profile; expose `.withProfile()`. | 09 §7 Step 4, repriced by F-4 — the seam exists. This is where "controllable harness" and "small-model support" become a *product surface*, not an env flag. | `ablation-warden`, per tier, per §2 as amended. |
| **W4** | **Harness-quality metrics in `packages/eval`.** Context Efficiency Ratio, Verification Cost Overhead, Trajectory Recovery Rate, Memory Hygiene Index. | The RunLedger already holds every input; this is projection, not instrumentation. C4 extension. No other framework can compute these at all. | Deterministic over the golden corpus. |
| **W5** | **τ-bench score, published with a replayable receipt.** (F-7) | One external number with a replay artifact is worth more than a ninth internal ablation — and it is the honest-claims answer to the benchmark-integrity crisis in §1. | External gate, ratified 2026-07-28. |
| **W6** | **Memory hygiene.** Point the existing guardrail detectors at the memory write path; dedup + provenance on write; temporal-decay reranking on read; then measure defaulting `MemoryService.bootstrap()/flush()` on. (F-6) | Highest-severity unaddressed vulnerability class in the 2026 literature, and RA already owns the parts. | `ablation-warden` for the default-on question only. |
| **W7** | **Residue.** Per-kind trace schema validation (F-5); MCP server surface (F-8); close 09 §6.8/§6.11 as stale. | Cheap, unblocked, no gate needed. | None. |

### What this amendment does *not* authorize

- **No topology/orchestration surface.** 09 C5 gates it behind RunAssessment and
  that ruling stands. `packages/compose` remains five killswitches. The
  literature's six execution topologies are noted as forward input only.
- **No RL / distillation / fine-tuning pipeline.** GRPO, DGPO, SRPO and RLKD are
  model-vendor work. RA's job is to *consume* tuned small models well — which is
  W3 — not to train them.
- **No implementation of the 28-pattern catalog.** It is a taxonomy. It may
  inform naming in docs. It is not a capability.
- **No new north-star document.** 09 §8 stands. This is an amendment.
- **WIP = 1.** W1+W2 ship as one slice. W3 does not start until W1+W2 merge.

---

## 5. Decision requested

1. Ratify the §4 token-leg change to 09 §2 (billed input tokens, not raw, not USD).
2. Ratify the §4 workstream ordering as an amendment to 09 §7.
3. Accept F-5's two stale-debt closures against the DEBT-REGISTER §1 ratchet.
4. Authorize W1+W2 as the single WIP item.

Implementation plan for W1+W2:
[[../Planning/Implementation-Plans/2026-08-24-cost-instrument-truth]].
