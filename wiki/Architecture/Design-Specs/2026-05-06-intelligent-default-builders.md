# Intelligent Default Builders: Context-Aware Harness Primitives

**Date:** 2026-05-06
**Status:** Draft — pending review
**Author:** TB + harness team
**Targets:** v0.10.x (catalog + first 3-5 migrations); v0.11 (full integration with `.compose()`)
**Related:** [[2026-05-06-compose-harness-api|Compose-Harness API]] · [[../Specs/02-FAILURE-MODES|FM Catalog]] · [[../../Research/Debriefs/2026-05-06-M3-cogito-14b-divergence|M3 Cogito:14b Divergence]]

---

## TL;DR

Migrate the framework's hardcoded LLM-bound strings (oracle nudges, retry signals, tool descriptions, error messages, redirects, gate failures) to **typed pure functions of harness context** — *intelligent default builders*. Each builder is a small composable primitive: `(ctx) => string | null`. These are the framework's own composable primitives that produce the **highest-quality default emission** for a given situation, before any developer customization.

Pairs with the [[2026-05-06-compose-harness-api|Compose-Harness API]]:
- **This spec (Layer 1):** what the framework says by default — context-aware defaults.
- **Compose-Harness spec (Layer 2):** how developers override or augment those defaults.

Tagline: **"Smart defaults, composable everything."**

---

## 1. Motivation

### 1.1 The hardcoded-string problem

The May-6 audit identified 24 distinct injection points where the harness emits content into the LLM's context. Of those, 17 emit static strings — text that doesn't change based on:

- Model tier (frontier vs local — local needs more explicit examples)
- Output format (prose task vs code task — different guidance applies)
- Iteration state (nudge 1 vs nudge 2 — escalation matters)
- Recent tool calls (you've called X, try Y next)
- Task intent (was this asking for a file or a synthesis?)

**Empirical evidence (this session, cogito:14b):**
- T4 baseline: oracle force-terminated after 1 generic nudge → 0% output.
- Pivot B: same nudge text, raised local-tier limit 1→2 → 100% output. **The change was state-aware behavior, not a smarter string.**
- T5 baseline: cogito wrote a file and returned the path — because the static `final-answer` description listed "file path" as an example output. **The string wasn't task-aware.**
- Each empirical win came from making a previously-static decision context-aware.

### 1.2 The compose-harness ergonomics gap

The [[2026-05-06-compose-harness-api|Compose-Harness API]] establishes principle 3: *"Every transformer receives the current default."* If that default is a static string, the user's transformer has zero context to work with. They have to re-derive everything (model tier, task intent, recent state) inside their override.

Layer 2 (compose) is only ergonomic when Layer 1 (intelligent defaults) exists. Otherwise compose-harness is a permission slip to rewrite static strings, not a composition surface.

### 1.3 The harness-research velocity angle

The harness-improvement-loop skill currently iterates as:
1. Identify a hardcoded string suboptimal for some failure mode
2. Edit the source file
3. Rebuild affected packages
4. Re-run the probe
5. Diff traces
6. Commit

**Cycle time: minutes per iteration. The bottleneck is the rebuild + reload.**

With Layer 1 builders + Layer 2 compose, the same loop becomes:
1. Identify a hardcoded emission
2. Write a probe with `.compose(harness => harness.on('<tag>', (ctx) => variantBuilder(ctx)))`
3. Run probe
4. Diff traces
5. Promote winning variant by replacing the default builder (or shipping it as compose-only)

**Cycle time: seconds per iteration. Multiple variants per probe run. A/B testable.**

This is the strategic payoff: every Layer 1 builder we ship makes the next harness-improvement spike cheaper. The framework becomes its own research instrument.

### 1.4 The framework brand angle

Most agent frameworks ship two things: opinionated abstractions + escape hatches. The default behavior is generic; users either accept it or replace it.

Layer 1 + Layer 2 is a different shape:

> Smart defaults that already adapt to the situation, plus a composition surface for when the developer knows better.

Default users get a framework that's already responsive to model tier, task shape, and recent state. Advanced users get a fully composable surface. **Neither is starved of value.**

---

## 2. Design Principles

| # | Principle | Implication |
|---|---|---|
| 1 | **Intelligence is the default, not a feature** | The framework's default emission should already adapt to known signals. Static strings are a code smell. |
| 2 | **Pure functions of context** | Each builder is `(ctx) => string \| null`. No side effects. Trivially testable, swappable, composable. |
| 3 | **Narrow context per builder** | Each builder's typed context contains only what that builder needs. No global `HarnessContext` god-object. |
| 4 | **Builders live near their primitive** | The oracle nudge builder lives near the oracle gate. The verifier-retry builder lives near the verifier. Not buried in `runner.ts`. |
| 5 | **Every builder is exported** | Compose-harness needs to call them. Tests need to call them. Builders are public API of their containing package. |
| 6 | **`null` means suppress** | Returning `null` from a builder means "don't emit anything." Returning `undefined` is reserved for "use the next builder in chain" once compose-harness wires them. |
| 7 | **Each migration ships independently** | Don't refactor all 24 at once. Each builder migration is its own harness-improvement-loop session with empirical evidence. |
| 8 | **Empirical justification required** | A new builder ships only when probe traces show the static version was suboptimal. We don't pre-build defaults for hypothetical failures. |
| 9 | **Migrations are non-breaking** | The new builder produces strings that are functionally compatible with the old static one (modulo intended improvement). No external API change. |
| 10 | **Layer 1 is structural; Layer 2 is opinion** | Builders define how the framework chooses to emit. Compose lets developers reshape that. The boundary is permanent. |

---

## 3. Architecture

### 3.1 The three layers

| Layer | What | Where today | Where after this spec |
|---|---|---|---|
| **0** | Hardcoded strings | 17 of 24 injection points | Eliminated incrementally |
| **1** | Intelligent default builders | 0 of 24 today (1 in-flight: final-answer description) | Target: top-leverage 5-7 builders shipped pre-v0.11 |
| **2** | Compose-harness override surface | 0 of 24 today | v0.11 — wires Layer 1 builders as default emitters |

### 3.2 Builder shape

```ts
// Generic shape — narrow ctx per builder, pure function, optional null suppression
type BuilderFn<Ctx> = (ctx: Ctx) => string | null;

// Example: oracle nudge builder
interface OracleNudgeContext {
  readonly tier: 'local' | 'mid' | 'large' | 'frontier';
  readonly nudgeCount: number;
  readonly nudgeLimit: number;
  readonly outputFormat: OutputFormat | null;
  readonly toolsUsed: ReadonlySet<string>;
  readonly availableTools: readonly string[];
}

function buildOracleNudge(ctx: OracleNudgeContext): string | null;
```

### 3.3 Builder context typing

**Each builder owns its typed context.** No shared `HarnessContext` interface.

Rationale:
- Builder contracts stay small and explicit
- Adding a new signal to one builder doesn't ripple through unrelated ones
- Tests construct minimal context objects, not full kernel state
- TypeScript IDE hints show only the fields a builder actually consumes

There may eventually be common types (`OutputFormat`, `Tier`, etc.) shared via a small types module — but no monolithic context object.

### 3.4 Builder location

Each builder lives near the primitive it serves:

| Primitive | Builder location |
|---|---|
| Final-answer tool | `packages/tools/src/skills/final-answer.ts` |
| Oracle gate | `packages/reasoning/src/kernel/capabilities/decide/oracle-nudge.ts` (new) |
| Verifier retry | `packages/reasoning/src/kernel/capabilities/verify/retry-context.ts` (already partially shaped) |
| Loop detector follow-up | `packages/reasoning/src/kernel/capabilities/reflect/loop-message.ts` (new) |
| Required-tools redirect | `packages/reasoning/src/kernel/loop/required-tools-message.ts` (new) |
| Healing failure assembly | `packages/tools/src/healing/healing-message.ts` (new) |

**Anti-pattern:** putting builders in `runner.ts`. The runner orchestrates phases; it shouldn't be the source of every text emission. Builders are siblings to the primitives they serve.

### 3.5 Wiring at the call site

Today's call site:
```ts
state = transitionState(state, {
  pendingGuidance: { oracleGuidance: "You are ready to answer. Call `final-answer` now…" },
});
```

Layer 1 call site:
```ts
const nudge = buildOracleNudge({ tier, nudgeCount, nudgeLimit, outputFormat, toolsUsed, availableTools });
if (nudge) {
  state = transitionState(state, { pendingGuidance: { oracleGuidance: nudge } });
}
```

Layer 2 call site (when compose-harness ships):
```ts
const nudge = harness.emit('oracle.nudge', { tier, nudgeCount, … });
// harness pipeline runs default builder + any user transformers in registration order
if (nudge !== null) {
  state = transitionState(state, { pendingGuidance: { oracleGuidance: nudge } });
}
```

The default builder is the same in Layer 1 and Layer 2; only the dispatch changes.

---

## 4. Worked example: final-answer description

This is the canonical Layer 1 example, in-flight at time of writing.

### 4.1 Layer 0 (today)

```ts
// packages/tools/src/skills/final-answer.ts:6-13
export const finalAnswerTool: ToolDefinition = {
  name: "final-answer",
  description:
    "Submit the final answer and terminate the task. Call this when ALL required steps " +
    "are complete. Provide the actual deliverable in 'output', its format in 'format', " +
    "and a brief summary of what was accomplished in 'summary'. " +
    "This is the preferred way to end a task — do NOT write 'FINAL ANSWER:' in text when you can call this tool. " +
    "When your task involves code generation, your output field MUST contain the actual complete code…" +
    "When your task involves writing a summary, report, paragraph…",
  …
};
```

Every agent sees every clause. Code-task agents see the prose clause; prose-task agents see the code clause; everyone sees both.

### 4.2 Layer 1 (this spec)

```ts
// packages/tools/src/skills/final-answer.ts
export interface FinalAnswerDescriptionContext {
  readonly outputFormat?: OutputFormat | null;
  readonly hasRequiredTools?: boolean;
}

export function buildFinalAnswerDescription(
  ctx: FinalAnswerDescriptionContext = {},
): string {
  // Composes preamble + fixed clause + ONE shape clause
  // selected from { codeClause, proseClause, jsonClause, structuredClause, null }
  // based on ctx.outputFormat.
}

export function buildFinalAnswerOutputDescription(
  ctx: FinalAnswerDescriptionContext = {},
): string {
  // Mirrors the description shape — output param description varies by format.
}
```

Call site in execution-engine builds context once and substitutes the description in the schema:

```ts
const finalAnswerCtx = {
  outputFormat: extractOutputFormat(taskText).format,
  hasRequiredTools: (effectiveRequiredTools?.length ?? 0) > 0,
};
const dynDesc = buildFinalAnswerDescription(finalAnswerCtx);
// override description in the LLM-facing tool schema
```

A code-task agent now sees the code clause only. A prose-task agent sees the prose clause only. JSON tasks see the JSON clause. Tasks without detected format fall back to a generic preamble + fixed clause (no shape-specific text).

### 4.3 Layer 2 (when compose-harness ships)

```ts
agent.compose(harness => {
  harness.on('tool.description', (ctx, defaultText) => {
    if (ctx.toolName === 'final-answer' && ctx.outputFormat === 'code') {
      return defaultText + " Always include error handling and types.";
    }
    return undefined; // pass through default
  });
});
```

The user receives the **already-context-aware default**, not a static string. Their override is small and additive. They don't have to re-derive `outputFormat`.

---

## 5. Catalog: 24 chokepoints, prioritized for Layer 1 migration

Builders ranked by empirical leverage (impact on observed failure modes) and migration cost.

| Rank | Builder | Site | Layer 0 → 1 status | Empirical signal | Effort |
|---|---|---|---|---|---|
| 1 | `buildFinalAnswerDescription` | `tools/skills/final-answer.ts` | ⏳ in-flight | T5 file-path-as-answer fixed via Layer 0 description tightening; Layer 1 makes it task-aware | 0.5d |
| 2 | `buildOracleNudge` | (new) `reasoning/.../decide/oracle-nudge.ts` | ❌ static | T4 cogito:14b 30%→100% via state-aware nudge limit; full builder unifies tier + format + escalation | 1d |
| 3 | `buildRequiredToolsRedirect` | (new) `reasoning/.../loop/required-tools-message.ts` | ❌ static | Generic "you must call X" leaves cogito guessing parameters; format-aware text can include tool param example | 0.5d |
| 4 | `buildVerifierRetrySignal` | `reasoning/.../verify/retry-context.ts` | 🟡 partial (FM-A1, FM-C2 only) | Already shaped per failure mode; generalize the dispatch | 0.5d |
| 5 | `buildHealingFailureMessage` | (new) `tools/healing/healing-message.ts` | ❌ scattered across 4 stages | 4-stage pipeline currently emits different hardcoded strings per stage; single builder unifies | 1d |
| 6 | `buildLoopDetectorMessage` | (new) `reasoning/.../reflect/loop-message.ts` | ❌ static at `loop-detector.ts:102` | Currently doesn't explain WHAT loop pattern detected | 0.5d |
| 7 | `buildHandoffSummary` | (new) | ❌ static | Sub-agent handoff summary — currently generic | 0.5d |
| 8 | `buildEpisodicMemoryRender` | `runtime/.../execution-engine.ts:1419` | 🟡 partial | Already format-aware-ish; refactor to builder shape | 0.5d |
| 9 | `buildHarnessSkillPrepend` | (depends) | ❌ static | Tier-aware prepend already partially exists | 0.5d |
| 10 | `buildCompletionGateMessage` | (depends) | ❌ static | Lower empirical leverage | 0.3d |
| … | (remaining 14 chokepoints) | various | mostly ❌ static | Migrate opportunistically as their primitives are touched | TBD |

**Total Phase 1.5b effort estimate (top 6 builders): ~4 days of focused harness-improvement-loop sessions.**

Each migration is a self-contained commit with empirical before/after evidence per the harness-improvement-loop skill.

---

## 6. Migration pattern (per builder)

Each Layer 1 migration follows the same shape — the harness-improvement-loop skill gets a Layer 1-specific extension:

1. **Probe (Phase 2 of HIL):** Run a probe targeting a known suboptimal hardcoded string. Capture trace.
2. **Diagnose (Phase 3):** Verify the static string is the bottleneck via trace evidence (not a downstream issue).
3. **Hypothesize (Phase 4):** Write down:
   - The signals the builder will consume (define the typed context)
   - The decision logic (which signal selects which clause / phrasing)
   - Expected probe-trace shape after migration
4. **Implement (Phase 5):**
   - Define `XxxContext` interface (narrow)
   - Implement `buildXxx(ctx): string | null`
   - Export from the package's public API
   - Replace static-string call site with builder invocation
   - Add unit tests for the builder (pure-function tests, no kernel needed)
5. **Verify (Phase 6):**
   - Re-run probe (n≥2)
   - Trace diff confirms expected emission shape change
   - Existing test suite passes (no net new regressions)
6. **Commit (Phase 7):**
   - Empirical evidence in the commit message (runIds, before/after metrics)
   - No co-authors per project memory

**The builder is then ready to be wired as a default emitter when compose-harness ships.**

---

## 7. Compose-harness integration (forward-compatibility)

When compose-harness lands in v0.11:

### 7.1 Default emitter registration

Each Layer 1 builder is registered against its compose tag:

```ts
// Internal — built into the compose pipeline, runs when no user override applies.
internalDefaults.register('tool.description', (ctx) => {
  if (ctx.toolName === 'final-answer') return buildFinalAnswerDescription(ctx);
  return undefined; // tool description not customized
});

internalDefaults.register('oracle.nudge', (ctx) => buildOracleNudge(ctx));
internalDefaults.register('verifier.retry-signal', (ctx) => buildVerifierRetrySignal(ctx));
// …
```

### 7.2 User override path

```ts
agent.compose(harness => {
  harness.on('oracle.nudge', (ctx, defaultText) => {
    // ctx is already typed with the OracleNudgeContext fields the default uses
    // defaultText is what buildOracleNudge would have emitted
    if (ctx.tier === 'local' && ctx.nudgeCount === ctx.nudgeLimit) {
      return defaultText + "\n\nNote: this is your final attempt before termination.";
    }
    return undefined; // pass through default
  });
});
```

### 7.3 Tag taxonomy

Compose-harness's tag namespace (`tool.*`, `oracle.*`, `verifier.*`, etc.) corresponds 1:1 to the builder catalog above. The compose-harness spec's tag catalog and this spec's builder catalog are kept in sync.

### 7.4 The migration is non-breaking

When compose-harness ships:
- Every Layer 1 builder shipped pre-v0.11 already has the right shape
- The compose pipeline calls the same function; it just adds the chain semantics on top
- No call-site rewrite at builder definition

---

## 8. Strategic implications

### 8.1 Harness-improvement-loop becomes A/B testable

Today, A/B-testing two oracle-nudge variants requires:
1. Edit `runner.ts:1105`
2. Rebuild reasoning + runtime + trace + diagnose packages (~30s)
3. Run probe (~3min)
4. Note result
5. Edit again with variant 2
6. Rebuild
7. Run probe again
8. Compare

With Layer 1 + Layer 2:

```ts
// In a probe script:
const variants = [
  { name: 'default', compose: () => {} },
  { name: 'firmer', compose: harness => harness.on('oracle.nudge',
    (ctx, def) => def + "\n\nIf you do not call final-answer, the run terminates.") },
  { name: 'tier-stratified', compose: harness => harness.on('oracle.nudge',
    (ctx, def) => ctx.tier === 'local' ? `[LOCAL TIER GUIDANCE]\n${def}` : undefined) },
];

for (const v of variants) {
  const agent = builder.compose(v.compose).build();
  const result = await agent.run(task);
  // record result
}
```

**One probe run; three variants; no rebuild. Cycle time: minutes → seconds.**

### 8.2 Default-quality competition

The framework's defaults become a research output, not a programming convenience. Each Layer 1 builder is empirically validated; each replacement is a documented improvement.

This is what makes the framework a genuine research vehicle: the defaults are the research artifact.

### 8.3 Local-model performance trajectory

Almost every empirical lift this session came from making a previously-static decision context-aware:
- Pivot B (oracle nudge limit): static `1` → state-aware `2` for local tier. T4: 30% → 100%.
- Pivot A (verifier blind spot): static "always pass harness fallback" → state-aware "reject when terminatedBy=harness_deliverable".
- Final-answer description: static "list every clause" → format-aware "include only the relevant clause".
- Built-ins opt-in: static "auto-inject all" → context-aware "explicit opt-in".

**Migrating the next 6 high-leverage hardcoded strings to Layer 1 builders is a roadmap of similar empirical wins.** The pattern is reproducible.

---

## 8.4 Empirical finding: text augmentation vs behavioral adaptation

**Date:** 2026-05-07 — added after the Path C experiment.

The first attempted Layer 1 migration (final-answer description, Path C) yielded an unexpected and important architectural lesson. Two variants were tested:

### Variant A — subtractive composition

Hypothesis: select one shape-clause from a menu based on detected output format; remove unrelated clauses to reduce noise.

Result: **regressed T4 cogito:14b by 8pp (100% → 92%)**, reproducible across two runs. Cogito-class models apparently use the static description's full clause list as a checklist — removing clauses removed structural guidance the model relied on.

### Variant B — calibration-additive composition

Hypothesis: keep the full static base, then APPEND targeted guidance derived from calibration fields (`systemPromptAttention`, `observationHandling`, `toolCallDialect`) for higher signal density.

Result: **regressed cogito:8b by 14pp (60% → 46%)** when calibration was ON vs OFF (control). The +211 characters of calibration-driven clauses ("Your output MUST include actual values...", "REMINDER: the answer goes in `output`...") overloaded the model's attention, causing it to stall at high token usage with empty outputs.

### Generalized lesson

Both attempts share a failure mode: **adding text to tool descriptions regressed small models.** The empirical evidence in the same session showed that successful Layer 1 work was uniformly behavioral, not textual:

| Layer 1 work this session | Mechanism | Empirical signal |
|---|---|---|
| Pivot A (verifier sees harness fallback) | flow-control change | structural fix, retry path reachable |
| Pivot B (local-tier nudge limit 1→2) | budget change | T4 cogito:14b: 30% → 100% |
| Builtins opt-in | schema construction change | file-write calls 1-3/probe → 0/probe |
| T5 description fix (removed "file path" example) | **removed** harmful text | T5 file-path-as-answer eliminated |
| Path C subtractive (stripped clauses) | text rewrite | T4 cogito:14b regressed |
| Path C calibration-additive (more clauses) | text rewrite | cogito:8b regressed 14pp |

**Refined principle for Layer 1 builders:**

> Calibration drives **behavior**, not **prose**. Builders that adapt *what the framework does* (when to fire, how many times, whether to skip) earn empirical lift. Builders that adapt *what text the framework emits* (more clauses, more guidance, more reminders) regress small-model performance via attention dilution.

The exception is **removing harmful text** (T5 fix) — pruning is consistently safe; appending is consistently risky for cogito-class models.

### Implications for the catalog (§5)

Reorder priorities to prefer behavioral-primary builders:

| Rank | Builder | Type | Empirical basis |
|---|---|---|---|
| 1 | `buildOracleNudgeBudget` (decides if/how-many nudges before force-exit) | **behavioral** | Pivot B proved budget tuning works |
| 2 | `decideRequiredToolsRedirect` (whether to redirect, not the message text) | behavioral | analogous mechanism |
| 3 | `decideVerifierRetryFire` (skip retry on calibrated low-responders) | behavioral | uses `interventionResponseRate` |
| 4 | `decideHealingPipelineDepth` (how many healing stages to attempt) | behavioral | uses `toolSuccessRateByName` |
| 5+ | text-augmenting builders | demoted | requires per-tier empirical justification before shipping |

Final-answer description (the original Path C target) remains a candidate but pending a different mechanism — likely shape-pruning from a long static base for known-format tasks, not appending to it. The empirical bar for shipping ANY text-augmenting builder is now: probe data showing positive lift on the smallest tier, not just neutrality.

### Tag corollary for compose-harness

The compose-harness API tag space should distinguish behavioral chokepoints (`oracle.budget`, `verifier.retry-fire`, `healing.depth`) from textual chokepoints (`oracle.message`, `verifier.signal-text`, `healing.message`). The textual chokepoints become user-driven escape hatches for advanced consumers; the framework's defaults concentrate on the behavioral side where empirical wins reproduce.

### 8.4.1 Experiment 2 — calibration-driven LENGTH PRUNING (validated)

**Date:** 2026-05-07.

After the two failed Path C variants (subtractive by intent format, and calibration-additive), a third variant was tested: **calibration-driven length pruning**. The hypothesis: cogito-class models with limited attention capacity benefit from a *shorter* tool description; calibration tells us *which models* need the trim.

**Pruning policy by `systemPromptAttention`:**
- `"weak"` → preamble + fixed clause only (~250 chars).
- `"moderate"` → preamble + fixed clause + ONE format-relevant clause (~610 chars).
- `"strong"` / undefined → full static description (~780 chars, the empirically validated baseline for stronger models).

**Empirical result (cogito:8b, n=2):**

| Task | Cal-OFF baseline | Cal-PRUNE Run 1 | Cal-PRUNE Run 2 | n=2 avg |
|------|------------------|------------------|------------------|---------|
| T1 | 100% | 100% | 100% | 100% |
| T2 | 30% | 30% | 30% | 30% (cogito:8b limit, not description-related) |
| T3 | 35% | 77% | 100% | **88.5% (+53.5pp vs 35%)** |
| T4 | 100% | 100% | 100% | 100% |
| T5 | 37% | 37% | 37% | 37% |
| **Avg** | **60%** | 69% | 73% | **71% (+11pp)** |

T3 specifically went from a previously bimodal-broken 35% to two consecutive runs at 77% and 100% — a +53.5pp lift. Total suite avg lifted +11pp on cogito:8b.

**Mechanism:** the trimmed description (-22% chars, -171 chars) freed enough attention that cogito:8b correctly applied the "filter by COMMENTS not score" reasoning on T3. The pruning didn't add any guidance — it removed text the model didn't need at the cost of attention it did need.

**Confirmation that this is "calibration → behavior, not calibration → prose":** The pruning IS removal — exactly the exception called out in the principle ("removing harmful text is consistently safe; appending is consistently risky for cogito-class models"). Calibration drives *what to remove based on model capacity*, not *what to add*.

**Updated principle (incorporating Experiment 2):**

> Calibration drives **structural decisions** (behavior, removal, capacity-aware shape), not **prose augmentation**. The empirical bar for shipping a Layer 1 builder is positive lift on the smallest tier where the calibration field would fire — not just neutrality.

**This makes final-answer description a validated Layer 1 builder candidate** — pruning earns its keep on cogito:8b. The catalog (§5) is reordered:

| Rank | Builder | Type | Empirical basis |
|---|---|---|---|
| 1 | `buildOracleNudgeBudget` | behavioral | Pivot B: T4 cogito:14b 30%→100% |
| 2 | `buildFinalAnswerDescription` (with calibration-driven length pruning) | structural / removal | Experiment 2: cogito:8b 60%→71%, T3 +53.5pp |
| 3 | `decideVerifierRetryFire` (skip retry on calibrated low-responders) | behavioral | uses `interventionResponseRate` |
| 4+ | other behavioral / removal-driven builders | — | — |

Final-answer description is no longer demoted — it's a shipped Layer 1 example, with the explicit constraint that the composition logic is **calibration-driven removal**, not addition.

### 8.4.2 Cogito:14b sanity check

Confirmed no regression on uncalibrated path: cogito:14b has no calibration profile in the calibrations directory; the builder falls through to the `"strong" / default` branch returning the full static description. Probe result: 87% avg composite (within the established cogito:14b variance band of 86-94% across this session's runs). T1/T3/T4 at 100%, T5 at 70%, T2 at 65% — all consistent with previously observed bimodal task variance. The pruning has zero behavioral effect on uncalibrated models.

### 8.4.3 Experiment 3 — calibration-driven observation INLINING (rejected)

**Date:** 2026-05-07. Tested after Experiment 2 shipped.

Hypothesis: when `observationHandling === "needs-inline-facts"`, increase the `compression.budget` so tool results are inlined verbatim instead of compressed to a preview-with-recall-key. T5's persistent failure (faithfulness=0%, model fabricates titles) was attributed to the model not seeing actual values — only a compressed preview.

**Wired:** runner.ts compression budget multiplier conditional on calibration field. Tested at 4× and 2× multipliers on cogito:8b (calibrated `needs-inline-facts`).

**Result — high variance, no reliable lift:**

| Configuration | T5 | Avg | Reproducibility |
|---|---|---|---|
| Cal-OFF baseline | 37% | 60% | n=stable |
| Exp 2 alone | 37% | 71% | n=2 reproducible |
| Exp 3 @ 4× run 1 | 88% | 84% | one-shot win |
| Exp 3 @ 4× run 2 | 37% | 55% | catastrophic; T5 max_iter at 0 chars |
| Exp 3 @ 2× run 1 | 37% | 73% | matches Exp 2 baseline |

**Diagnostic reading:**

- 4× multiplier: bimodal. When the model copes with the inflated context, it synthesizes well (T5: 88%, 67% faithfulness — the lift the field was supposed to deliver). When it doesn't, it stalls at max_iter with empty output (T5: 37%, 0 chars). Spread is too wide for a default.
- 2× multiplier: stable but adds no measurable lift over Exp 2. Pure complexity without value.

**Conclusion:** budget inflation isn't the right mechanism for T5. The empirical signal isn't "model can't see the data" — it's something subtler. Possibilities for future investigation:
- Mid-synthesis re-grounding (inject a prompt-side "(reminder: cite specific titles from the data above)" right before the model's final-answer turn).
- Different chunking that preserves all values verbatim while compressing structure (deduplicate schema fields, keep all data points).
- A pre-final-answer phase where the model is asked to enumerate what it will cite.

**Refined principle (Experiments 2 and 3 combined):**

> Calibration drives **decisions about behavior and structural shape** (when to fire, whether to suppress, how much to remove). It does NOT reliably drive *single-knob amplification of one signal* (e.g., "send 4× more data to needs-inline-facts models"). Multi-mechanism failures need multi-mechanism investigation, not bigger numbers on one knob.

Reverted runner.ts compression budget back to the calibrated baseline (`profile.toolResultMaxChars`, which already inherits `optimalToolResultChars` from calibration). The mechanism stays available for compose-harness consumers who want to override per-task; it's just not auto-applied via `observationHandling` because the empirical signal isn't there.

The T5 problem remains a known unknown — see the divergence debrief.

---

## 9. Risks & anti-patterns

### 9.1 Premature abstraction

Risk: writing builders for hardcoded strings that don't actually need context. The static text might be the right default already.

Mitigation: Principle 8 — empirical justification required. Each new builder ships only when probe evidence shows the static version is suboptimal. We don't speculate.

### 9.2 Context bloat

Risk: each builder's context grows as new signals are added, eventually becoming a god-object.

Mitigation: Principle 3 — narrow per-builder context. Refactor when adding a 4th+ field rather than splatting a global object.

### 9.3 Builder sprawl in runner.ts

Risk: builders end up co-located with their call sites, which are mostly in `runner.ts`. The runner becomes the home of every emission function.

Mitigation: Principle 4 — builders live near their primitive (the tool, the policy, the gate). The runner imports and invokes; it doesn't define.

### 9.4 Testing surface explosion

Risk: 17 hardcoded strings → 17 builders → 17 unit-test files.

Mitigation: Each builder is a pure function. Test files are small (often <50 lines). Net test surface is similar to or smaller than today's integration-test coverage of static strings.

### 9.5 Migration churn breaking external consumers

Risk: a builder migration changes the exact text emitted, breaking downstream tools that grep for it.

Mitigation: Principle 9 — migrations are non-breaking. The new emission is functionally compatible (modulo intended improvement). Tests assert only meaningful properties (e.g. "contains a reference to required tool name") not exact strings.

### 9.6 Discoverability for compose users

Risk: with 24 builders, devs trying to use compose-harness can't find the right tag.

Mitigation: Compose-harness exposes `harness.tags()` introspection (per spec line 65). Each Layer 1 builder's tag is auto-documented from its registration site.

---

## 10. Out of scope (this spec)

- **Migration of all 24 chokepoints.** This spec defines the pattern and prioritizes the top 5-7. Remaining migrations happen opportunistically.
- **A global `HarnessContext` type.** Each builder owns its narrow context; no monolithic interface.
- **Builder versioning / semver guarantees.** Builders are pure functions with stable signatures; no semver concerns yet. If a builder's context shape changes, that's a normal package update.
- **The compose-harness pipeline itself.** Defined in [[2026-05-06-compose-harness-api|Compose-Harness API]]. This spec only defines the default emitters that compose-harness will dispatch through.
- **Localization / i18n.** All builders emit English. i18n is a future concern.

---

## 11. Open questions

1. **Tag naming.** Compose-harness's tag taxonomy isn't fully locked. Should Layer 1 builders pre-register against tentative names, or wait for compose-harness's tag freeze? (Recommendation: ship Layer 1 builders now with names matching the compose-harness draft; rename if needed during compose-harness implementation.)

2. **Suppress vs default.** Today, `null` from a builder means "suppress emission entirely." When compose-harness lands, will user transformers be able to *un*-suppress? (Likely yes via returning a string, but worth confirming in compose-harness spec.)

3. **Synchronous vs async builders.** All builders proposed here are synchronous pure functions. Some future emissions may need async (e.g., LLM-driven nudge generation). Should the type be `string | null | Promise<string | null>`? (Defer until empirical need arises.)

4. **Context-snapshot timing.** Some builders run pre-iteration (oracle nudge, redirect); others run mid-iteration (verifier retry). Does the `ctx` snapshot need explicit lifecycle hooks? (Probably handled by call-site discipline, not the builder contract.)

5. **Builder composition within Layer 1.** Can one builder call another (e.g., `buildHealingFailureMessage` invoking `buildToolNameSuggestion`)? Probably yes — they're just functions. But this might create implicit coupling. (Permit it; flag during code review if it creates cycles.)

---

## 12. Phase plan

| Phase | Scope | Outcome |
|---|---|---|
| **v0.10.x** | Layer 1 catalog + top 5-7 builder migrations (final-answer, oracle nudge, required-tools redirect, verifier-retry generalization, healing failure, loop detector message) | Each migration ships as a separate commit with empirical evidence. Framework's intelligent defaults rise meaningfully on local models. |
| **v0.11** | Compose-harness API ships. Wires existing Layer 1 builders as default emitters under tag namespace. Adds compose pipeline, transformers, runtime control verbs. | Layer 1 + Layer 2 unified. Developers can override any default via `.compose()`. Harness-improvement-loop becomes A/B-test-friendly. |
| **v0.11+** | Migrate remaining ~17 chokepoints opportunistically. Each migration empirically justified. | Eventually no Layer 0 hardcoded strings remain. |

---

## 13. Ratification checklist

Before shipping the first Layer 1 migration as the canonical pattern:

- [ ] Spec reviewed and merged
- [ ] Migration template added to `.agents/skills/harness-improvement-loop/SKILL.md` (Phase 5 sub-checklist for builder migrations)
- [ ] Tag-name draft aligned with compose-harness spec's draft
- [ ] First builder (final-answer description, in-flight) lands as a commit referencing this spec
- [ ] After ~3 builders shipped, write a debrief comparing harness-improvement velocity (commits/day) before vs after Layer 1 adoption

---

## 14. Why this matters

The framework's value is the harness, not the API. The API is the surface; the harness is the substance. Today the harness is mostly hardcoded text. Migrating to Layer 1 makes the harness a **first-class composable system the framework owns and improves**, not an artifact of which strings happened to get committed.

Every static string in `runner.ts` is a research opportunity that's currently locked behind a rebuild. Layer 1 + Layer 2 unlocks that research. The harness becomes its own research instrument.

> "Don't config, compose." (compose-harness)
>
> **"Don't hardcode, build."** (this spec)
