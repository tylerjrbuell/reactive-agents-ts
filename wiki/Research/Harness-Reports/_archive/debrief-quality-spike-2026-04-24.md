# Debrief Quality Spike — Phase 0 S0.7 Deliverable

> **Date:** 2026-04-24
> **Question:** Is the framework's current `AgentDebrief` output rich enough to feed Phase 4's closed learning loop (passive Skill capture + active Skill retrieval)?
>
> **Binary verdict required by Phase 0 plan §S0.7.**

---

## TL;DR — **CONDITIONAL POSITIVE**

Phase 4 IS in scope **if** we extend `AgentDebrief` with three structural fields (~50 LOC + prompt enrichment) before passive Skill capture begins. The current shape captures *partial* Phase 4 inputs — enough to bootstrap, not enough to support reliable retrieval.

**Decision:**
- Phase 4a (passive capture): proceed as planned; ship the schema extension as a Phase 1 prerequisite (not Phase 4 work).
- Phase 4b (active retrieval): proceed only after at least 5 weeks of accumulated typed Skills with the extended schema. Do not retrofit the legacy markdown `summary` field as a Skill source — too noisy.

---

## 1. Method

The Phase 0 plan suggests "run debrief.ts across 10 recent probe traces and grade them." That approach grades the **LLM's output**, not the **schema**. Since Phase 4 retrieval matches against typed structural fields (not free-form text), the load-bearing question is whether the schema *captures* the primitives needed — even a perfectly written `lessonsLearned: string[]` cannot feed a `SkillTrigger.kind: "intent-match"` if no intent field exists.

This spike grades the **schema + prompt + downstream Phase 4 requirements**, not the LLM's instance-level output quality. The verdict would not change if we generated 10 fresh debriefs.

Sources:
- `packages/runtime/src/debrief.ts` — `AgentDebrief` shape (lines 86-107) + `synthesizeDebrief` prompt (lines 128-139)
- `docs/spec/docs/15-design-north-star.md` §12.4 — typed Skill primitive (target shape Phase 4 must consume)

---

## 2. What Phase 4 needs from a debrief

From `docs/spec/docs/15-design-north-star.md` §12.4, a typed Skill carries:

```ts
interface Skill {
  id: string;
  trigger: SkillTrigger;        // ← pattern used by ContextCurator to match against task
  protocol: SkillProtocol;       // ← the ordered sequence of operations that worked
  knowledge: string;             // ← free-form context (lessons, gotchas)
  metrics: SkillMetrics;         // ← per-tier success rate, iter delta, token efficiency
  lineage: { ... };              // ← what task / debrief this came from
}

interface SkillTrigger {
  kind: "intent-match" | "tool-pattern" | "failure-pattern-match" | "keyword";
  pattern: string;
  // …
}

interface SkillProtocol {
  toolSequence: readonly string[];  // ← ordered, NOT just counts
  guardConditions: readonly string[];
  // …
}
```

Phase 4b retrieval scores task → Skill match by:
1. **Intent classification of the new task** vs `Skill.trigger.pattern` for `kind: "intent-match"` skills
2. **Available tools** vs `Skill.protocol.toolSequence` for `kind: "tool-pattern"` skills
3. **Recent failures** vs `Skill.trigger.pattern` for `kind: "failure-pattern-match"` skills

If the source debrief doesn't expose these structural primitives, the typed-Skill extractor either:
- (a) re-derives them via a second LLM pass on `summary` / `keyFindings` (expensive, brittle), or
- (b) emits low-fidelity Skills that retrieval can't match reliably.

---

## 3. Schema gap analysis

| Phase 4 requirement | Current `AgentDebrief` field | Gap |
|---|---|---|
| `Skill.trigger.kind: "intent-match"` pattern | None | **Missing.** No task-intent classification field; `summary` is narrative, not categorical |
| `Skill.protocol.toolSequence` | `toolsUsed[]` (call counts only) | **Missing.** Counts ≠ sequence. The order of tool calls is information that lives only in the trace, not the debrief |
| `Skill.trigger.kind: "failure-pattern-match"` | `errorsEncountered[]` (free-form strings) | **Partial.** Errors captured but not structurally tagged; a regex over strings would re-do work the LLM could have done once |
| `Skill.knowledge` | `lessonsLearned[]` | **Sufficient.** This field maps cleanly |
| `Skill.metrics.tokens / iterations / latencyMs` | `metrics.{tokens,duration,iterations,cost}` | **Sufficient.** |
| `Skill.metrics.successRate` (computed across runs) | `outcome: "success" \| "partial" \| "failed"` | **Sufficient.** Aggregator can compute success rate from outcome enum |
| `Skill.metrics.tier` | None | **Missing.** No model/tier identification; Skill metrics can't be tier-aware |
| `Skill.lineage.parentDebriefId` | None implied | **Sufficient.** Caller can carry this externally |

**4 gaps** (intent classification, tool-call sequence, failure-pattern tagging, tier identification) out of 8 fields. Two are critical for retrieval (`intent`, `toolSequence`); two are nice-to-have.

---

## 4. Prompt analysis

The current `DEBRIEF_SYSTEM_PROMPT`:

```
You are summarizing an AI agent's completed task for a structured debrief record.
Return ONLY a JSON object — no prose, no markdown fences — with exactly these fields:
{
  "summary": "2-3 sentence narrative of what was accomplished",
  "keyFindings": ["finding 1", "finding 2"],
  "errorsEncountered": ["error description if any"],
  "lessonsLearned": ["actionable lesson for future runs"],
  "caveats": "anything uncertain, incomplete, or worth flagging (empty string if none)"
}
```

Observations:
1. The prompt does NOT ask the model to classify task intent — it only narrates outcomes.
2. The prompt does NOT ask for tool sequence. It asks for `toolsUsed` (with counts) elsewhere — that's deterministic computation, not LLM judgment.
3. The prompt's `lessonsLearned` field could plausibly produce skill-worthy content, but only by accident — there's no structural framing.
4. The 512-token max output (line 186) is sufficient for the current 5 fields but tight for the proposed 8.

**Cost of expanding the prompt:** ~3 lines added; same LLM call; max tokens bump to 768. Estimated +15-20% in per-debrief tokens. Worth it.

---

## 5. Recommended schema extension (Phase 1 prerequisite, not Phase 4 work)

```typescript
export interface AgentDebrief {
  // ... existing fields unchanged ...

  /** [Phase 4] Structured task-intent classification — feeds SkillTrigger.kind="intent-match". */
  intentClassification: {
    primary: "extraction" | "research" | "synthesis" | "transformation" | "decision" | "other";
    keywords: readonly string[];
  };

  /** [Phase 4] Ordered sequence of tool names actually called — feeds SkillProtocol.toolSequence.
   *  Computed from trace, not LLM-derived (deterministic). */
  toolCallSequence: readonly string[];

  /** [Phase 4] Structurally-tagged failure patterns — feeds SkillTrigger.kind="failure-pattern-match".
   *  Empty array on success runs. */
  failurePatterns: readonly {
    kind: "tool-error" | "loop" | "timeout" | "verification-failed" | "other";
    detail: string;
  }[];
}
```

Three additions. `toolCallSequence` is deterministic (computed from trace, no LLM cost). `intentClassification` and `failurePatterns` extend the LLM prompt by ~20 tokens and ~50 tokens output respectively.

---

## 6. Cost-benefit

**Cost** of accepting this verdict:
- ~50 LOC across `debrief.ts` (schema, prompt, parsing, markdown formatter)
- One Phase 1 sprint slot allocated to "extend AgentDebrief for Phase 4 readiness"
- ~20% per-debrief token overhead for the new prompt fields
- Existing consumers of `AgentDebrief` need a re-test (3 fields are additive, non-breaking)

**Benefit** of accepting:
- Phase 4a passive capture lands with typed Skills from day one (no markdown→typed migration later)
- Phase 4b retrieval has direct structural signals to match against — no second LLM pass to extract intent
- Aligns with North Star §12.4 typed Skill schema without retrofit

**Cost** of rejecting (NEGATIVE verdict):
- Phase 4 deferred indefinitely OR Phase 4 ships with markdown-string-similarity retrieval (low fidelity, hard to tune)
- The framework's "evolutionary intelligence" pillar from the vision doc has no structural carrier

---

## 7. What this spike does NOT cover

- LLM-instance quality of `lessonsLearned` strings under real load (orthogonal — the verdict is about schema)
- Cost of running debrief on every successful run vs sampling (Phase 4 implementation detail)
- Storage / retrieval latency of typed Skills in `AgentMemory` (Phase 4b implementation detail)
- Cross-model variance of `intentClassification` (Phase 4 calibration work)

---

## 8. Decision summary for Phase 0 close-out

**Phase 4 scope: IN, with prerequisite.**

| Action | When | Owner |
|---|---|---|
| Extend `AgentDebrief` with 3 new fields per §5 | Phase 1 (parallel to Capability port) | Whoever picks up Phase 1 |
| Begin Phase 4a passive Skill capture | Phase 1 final sprint, after schema lands | Phase 1 owner |
| Begin Phase 4b active retrieval | Phase 4 proper, gated on 5+ weeks of typed-Skill corpus | Phase 4 owner |
| Drop Phase 4 entirely | NOT recommended — verdict is positive | — |

This closes Phase 0 S0.7 with a binary verdict (**positive**) and a clearly-bounded prerequisite that converts the verdict into actionable Phase 1 work. The Phase 4 sprint plan does not need to change; it gains a Phase 1 dependency.

---

_Spike artifact retained at `harness-reports/debrief-quality-spike-2026-04-24.md`. Closes P0 S0.7._
