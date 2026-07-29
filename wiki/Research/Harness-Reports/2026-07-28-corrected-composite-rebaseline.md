---
tags: [harness-report, rebaseline, lift-rule, F10, a-tier]
date: 2026-07-29
measured: 2026-07-28 / 2026-07-29
status: FINAL — Task 13 of the A-tier gap-closure plan
supersedes: every token-overhead figure in this repository predating `2f97ca1e`
---

# Corrected composite re-baseline — harness overhead, and the `stable-surface` verdict

**What this document is.** The synthesis step of the A-tier gap-closure program.
It does two things: (1) replaces the **retracted** 555–640% harness-overhead
figure with a number measured on a working instrument, and (2) applies the 09 §6
lift rule to `RA_STABLE_TOOL_SURFACE` and records the promotion verdict.

**Plan:** [[../../Planning/Implementation-Plans/2026-07-28-a-tier-gap-closure]] Task 13.
**Rule applied:** [[../../Architecture/Specs/09-UNIFIED-PROGRAM#6. Program invariants]] —
**≥3pp accuracy lift AND ≤15% token overhead**, cross-tier, to earn default-on;
otherwise opt-in; otherwise delete.

---

## 0. The standing invalidation, restated

**Every token-overhead figure in this repository predating `2f97ca1e` is void.**
This is filed as [[../../Architecture/DEBT-REGISTER#D-2026-07-28-A — every pre-`2f97ca1e` token figure is unverified|D-2026-07-28-A]] and
is not softened here.

Anthropic's `usage.input_tokens` counts only the **uncached remainder** of a
prompt; the cached prefix arrives separately as `cache_read_input_tokens` /
`cache_creation_input_tokens`. Both provider paths reported the remainder as
`inputTokens`/`totalTokens` while computing `estimatedCost` off the correct
total. Cost was right; tokens were wrong; **the error scaled with cache
effectiveness**, so the better a run cached, the cheaper it appeared in tokens.

Consequence: no document may cite a pre-`2f97ca1e` token overhead, including the
555–640% figure that motivated the simplification program. Cost figures from that
era are unaffected. Recurrence is prevented by
`packages/llm-provider/tests/cached-input-tokens-are-counted.test.ts`.

---

## 1. Rung 2 — haiku composite (the load-bearing measurement)

`packages/benchmarks/src/disclosure-ablation.ts`, provider `anthropic`, model
`claude-haiku-4-5-20251001`, **n=3**, 5 arms × 3 runs = **15/15 live cells, no
truncation**. Raw data: [[2026-07-28-rung2-haiku-composite.json]]. Summary:
[[2026-07-28-rung2-haiku-composite.md]].

Manipulation check **PASSED** (did not fire): `stable-surface` reported non-zero
`cacheRead` on all three runs (4,469 / 26,380 / 17,435).

### Arm table (mean of n=3)

| arm | tokens | cost | cacheRead | freshIn | calls | iters | correct |
|---|---:|---:|---:|---:|---:|---:|---:|
| `inline` | 13,998 | $0.01529 | 0 | 13,674 | 4.0 | 5.0 | 3/3 |
| `prune+discover` *(current default)* | 33,752 | $0.03916 | 0 | 32,399 | 14.3 | 22.0 | 3/3 |
| `prune-only` | 31,791 | $0.03745 | 0 | 30,375 | 14.3 | 21.7 | 3/3 |
| `no-prune` | 45,004 | $0.03996 | 14,085 | 16,966 | 12.3 | 17.0 | 3/3 |
| `stable-surface` | 44,995 | **$0.03745** | **16,095** | 17,522 | 12.0 | 16.0 | 3/3 |

**Read the two kinds of figure differently.** Cost, token and cache columns are
near-deterministic measurements of what the API billed for a fixed scripted task
and can be trusted at n=3. **Accuracy cannot.** Every arm scored 3/3, which at
n=3 on a single task carries roughly ±26pp of standard error per the project's
bench-interpretation rule. "All arms 3/3" means *no arm failed in three tries*,
not *the arms are equally accurate*. **This tier is at ceiling on accuracy and
therefore cannot measure an accuracy lift in either direction.**

---

## 2. The corrected harness overhead — the number that replaces 555–640%

`full` = `prune+discover` (lazy disclosure + the `discover-tools` escape hatch —
the actual shipped kernel default). `bare` = `inline` (no kernel, no pruning, no
discovery). Rung 2, haiku, n=3, all cells delivered.

| | `bare` (inline) | `full` (prune+discover) | overhead |
|---|---:|---:|---:|
| **tokens** | 13,998 | 33,752 | **2.41× = +141.1%** |
| **cost (USD)** | $0.015293 | $0.039161 | **2.56× = +156.1%** |

**Both are reported because F10's whole point is that they diverge.** They happen
to be close on this arm (`prune+discover` caches nothing, so its tokens and its
money move together) — but they diverge sharply on the arms that *do* cache; see
§4.

### Four caveats that constrain how far this number travels

1. **`bare` is RA's inline path, not a raw API loop.** The `inline` arm runs
   `reasoning: false` — the runtime's own inline tool loop, still carrying an RA
   system prompt and RA tool schemas. It is the closest available proxy for "a
   bare LLM," not a literal `messages.create` loop. **A true bare-API baseline
   would make the overhead larger, not smaller.** +141%/+156% is therefore a
   floor on the kernel's overhead, and it is the overhead of *the kernel over the
   inline path*, which is the comparison a user actually faces when deciding
   whether to call `.withReasoning()`.
2. **One task shape, one model, n=3.** The bench runs a single composite task
   (read a JSON file, sum an array, write the result) against a 10-builtin
   surface. Overhead on other task shapes is not measured.
3. **It is still ~9.4× the §6 ceiling.** The retraction of 555–640% is not
   exoneration. Applied to itself, `ra-full` still fails §6's 15% token bar by
   roughly an order of magnitude — down from ~40×, but the sign and the verdict
   are unchanged. The simplification program's *conclusion* survives its
   *evidence* being retracted; only the magnitude changes.
4. **Rung 3 cannot produce a comparable overhead figure — see §3.**

### Honest restatement for the record

> On a 3-tool composite task with a 10-builtin surface, measured on
> `claude-haiku-4-5` at n=3 with corrected token accounting, the full reasoning
> kernel costs **2.4× the tokens and 2.6× the money** of the framework's inline
> tool loop. The previously circulated 555–640% figure is retracted and must not
> be cited.

---

## 3. Rung 3 — fast local non-reasoning tool-callers

Same 5 arms, `ollama`, **n=3** each. `qwen3.5:latest` and `granite4:tiny-h`;
reasoning/thinking models deliberately excluded because their output variance
swamps a cost signal. Raw data: [[2026-07-28-rung3-qwen35.json]],
[[2026-07-28-rung3-granite4.json]].

### ⚠️ Caching caveat — this rung measures accuracy non-regression ONLY

**Ollama has no prompt-cache billing.** `cacheRead` is 0 on every cell of both
models because there is no cache-read channel to report, not because the prefix
churned. `costUsd` is 0 on every cell for the same reason. **The entire cost and
caching conclusion of this document rests on rung 2 alone.** A reader who sees
"`stable-surface` wins on two rungs" must not conclude that both rungs measured
the same thing — rung 3 measured whether the deliverable still lands.

### `qwen3.5:latest` (n=3)

| arm | tokens | correct | notes |
|---|---:|---:|---|
| `inline` | 10,800 | 3/3 | |
| `prune+discover` | 8,207 | **1/3** | 2 cells died at iteration 1, `llm_error` |
| `prune-only` | 9,476 | **1/3** | 2 cells died at iteration 1, `llm_error` |
| `no-prune` | 30,949 | 3/3 | |
| `stable-surface` | 36,086 | 3/3 | |

### `granite4:tiny-h` (n=3)

| arm | tokens | correct | notes |
|---|---:|---:|---|
| `inline` | 8,672 | **1/3** | 2 cells stopped at iteration 1 |
| `prune+discover` | 16,547 | **0/3** | never wrote the deliverable in any cell |
| `prune-only` | 12,098 | **0/3** | never wrote the deliverable in any cell |
| `no-prune` | 30,628 | 2/3 | |
| `stable-surface` | 31,774 | 3/3 | |

### Rung-3 token figures are NOT usable as overhead

`prune+discover` on `qwen3.5` averages **fewer** tokens than `inline`
(8,207 vs 10,800, a nonsensical "−24% overhead") purely because two of its three
cells crashed at iteration 1. **An arm that dies early looks token-efficient.**
Token comparisons across arms that terminated at different points in the task are
meaningless, and no overhead figure is derived from this rung. This is why §2's
headline comes from rung 2, where all 15 cells produced a correct deliverable and
the arms are genuinely comparable.

### An unplanned finding this rung DID produce: pruning hurts small local models

Pooled across both local models, holding the mechanism axis rather than the arm:

| arms | correct |
|---|---:|
| pruning ON (`prune+discover` + `prune-only`) | **2 / 12** |
| full surface visible (`no-prune` + `stable-surface`) | **11 / 12** |

Fisher exact, one-tailed: **p ≈ 3.2 × 10⁻⁴**. Same direction on both models, no
exceptions. Haiku shows nothing of the sort (3/3 everywhere), so this is
**tier-specific**: lazy tool disclosure appears to be roughly neutral on a
frontier-class small model and materially harmful on 4–7GB local tool-callers.

**Two caveats, and the second is the one that blocks acting on this today.**

- On `qwen3.5` four of the six pruning-arm failures are `llm_error` at iteration
  1 — a provider-layer failure, not necessarily a model-competence one. A pruned
  tool array may be producing a request Ollama rejects. **That is an instrument
  hypothesis and it has not been tested.** Per this project's own
  instrument-before-conclusion rule, it must be diagnosed before the finding is
  attributed to the mechanism.
- On `granite4` there are **zero** `llm_error` cells. All six pruning-arm
  failures are honest task failures: the agent ran, burned 8–18k tokens, and
  never wrote the deliverable (`wroteFile: false` on all six). That half of the
  finding is not instrument-confounded.

**Status: filed as a lead, not a verdict.** It bears directly on the ablatability
audit's open note that `RA_LAZY_TOOLS` and `RA_TOOL_DISCOVERY` are demotion
candidates ([[../Audit-Reports-2026-07-28/ablatability.md]]) — this is the first
*live* evidence on that question, and it points the same way rung 1's INERT
verdict did, for an entirely different reason. It does not license a demotion on
one task shape with an undiagnosed `llm_error` in half the cells.

---

## 4. Where tokens and money actually diverge (rung 2)

This is the finding F10 was built to expose, isolated:

| arm | tokens vs `inline` | cost vs `inline` | cacheRead |
|---|---:|---:|---:|
| `prune-only` | +127.1% | +144.9% | 0 |
| `prune+discover` | +141.1% | +156.1% | 0 |
| `no-prune` | +221.5% | +161.3% | 14,085 |
| `stable-surface` | **+221.4%** | **+144.9%** | 16,095 |

`stable-surface` and `no-prune` are within 9 tokens of each other (44,995 vs
45,004) and **$0.0025 apart in cost — a 6.3% gap on identical token counts.**
That gap is the cache, and nothing else. Against the current default:

- `stable-surface` spends **+33.3% more tokens** than `prune+discover`
- `stable-surface` spends **−4.4% less money** than `prune+discover`
- `stable-surface` ties `prune-only` — the cheapest kernel arm — at **$0.03745**,
  while running 5.7 fewer iterations to get there

**A token-denominated rule scores this mechanism as a 33% regression. A
money-denominated one scores it as a 4% improvement. Both are correct readings
of the same run.** That is the gap §5 has to confront.

---

## 5. The §6 verdict for `RA_STABLE_TOOL_SURFACE`

### The rule, quoted as written

09 §6: *"Default-on only via the (per-task-class) lift rule."* Operationalised in
`packages/benchmarks/src/gate/` and stated in the plan's own constraints:

> **≥3pp accuracy lift AND ≤15% token overhead**, cross-tier, to earn default-on.
> Otherwise opt-in. Otherwise delete.

In code (`gate/types.ts:100-101`, `gate/gate.ts:286`):

```ts
minLiftPp: 3,
maxTokenOverheadPct: 15,
// ...
costOk = tokenOverheadPct <= policy.maxTokenOverheadPct;
```

with `tokenOverheadPct = (candTokens − baseTokens) / baseTokens × 100`
(`gate.ts:208`). **There is no USD field anywhere in the gate's input or output
types.** Even the `long-horizon` exemption is denominated in tokens
(`costPerDeliverable` = tokens ÷ deliverable pass-rate, `gate.ts:277-284`). The
rule cannot see money. This is load-bearing for §6.4 below.

### Leg 1 — token overhead: **FAILS, on every tier and every baseline**

Candidate = `stable-surface`. Baseline = the mechanism off, i.e.
`prune+discover`, the current default.

| tier | candidate tokens | baseline tokens | overhead | vs 15% ceiling |
|---|---:|---:|---:|---|
| haiku (rung 2) | 44,995 | 33,752 | **+33.3%** | **FAIL** (2.2× over) |
| qwen3.5 (rung 3) | 36,086 | 8,207 | +339.7% | **FAIL** (confounded — baseline crashed) |
| granite4 (rung 3) | 31,774 | 16,547 | **+92.0%** | **FAIL** (6.1× over) |

Against `inline` instead of the default, it is worse still: **+221.4%** (haiku),
+234.1% (qwen3.5), +266.4% (granite4).

The cleanest available number is the haiku one — the only tier where every cell
in both arms delivered — and it is **+33.3%, which is 2.2× the ceiling.** The
verdict does not depend on the rung-3 confound, and it does not depend on which
baseline is chosen. **The token leg fails unambiguously.**

### Leg 2 — accuracy lift: **NOT ESTABLISHED cross-tier**

| tier | candidate | baseline | lift |
|---|---:|---:|---:|
| haiku (rung 2) | 3/3 | 3/3 | **0.0pp** — and unmeasurable (ceiling) |
| qwen3.5 (rung 3) | 3/3 | 1/3 | +66.7pp |
| granite4 (rung 3) | 3/3 | 0/3 | +100.0pp |

The ladder ratified on 2026-07-28 requires **rungs 2 and 3 to agree in sign**.
Rung 3 is strongly positive. Rung 2 is exactly zero — and *cannot* be otherwise,
because every arm including the baseline scored 3/3, so the tier is at ceiling
and has no headroom in which a lift could appear. **Zero and positive do not
agree in sign; zero has no sign.** The honest statement is not "rung 2 refutes
rung 3," it is **"rung 2 is uninformative on accuracy and the cross-tier
requirement is therefore unmet."**

Two further reasons this leg cannot be granted on the present data:

- The bench runs **one task** (`disclosure-ablation.ts:40`). With `T = 1` the
  formal gate's between-task clustering term is structurally unavailable
  (`gate.ts:220-224` requires `T ≥ 2`), so its heterogeneity guard — the thing
  that stops an effect buying significance by hammering a single task — cannot
  run at all.
- Half the rung-3 baseline failures are undiagnosed `llm_error` (see §3).

### Leg 3 — the conjunction

The rule is **AND**, not OR. The token leg fails on every tier by 2.2×–6.1×. Even
granting the accuracy leg in full, the mechanism does not clear the rule.

### VERDICT: **FAILS the §6 lift rule as written. `RA_STABLE_TOOL_SURFACE` stays OPT-IN. Not promoted to default-on.**

No change to `packages/reasoning/src/harness-flags.ts`. The flag remains default
OFF, `RA_STABLE_TOOL_SURFACE=1` to enable.

### 5.4 — What is NOT being done here, and why that matters

`stable-surface` costs **4.4% less money** than the mechanism it would replace
and is the **only arm in the entire measurement that caches at all** on a
plan-bearing prefix. It would be easy, and wrong, to write "the rule obviously
*meant* cost all along" and promote it.

**That is metric-gaming, and it is a named failure in this project's history**
(`feedback_no_metric_gaming_refactor`: *don't hit targets by redefining them*).
The rule says **tokens**. It says tokens in prose, in `types.ts:101`, and in
`gate.ts:286`. It says tokens even in its one existing exemption. The mechanism
increases tokens by 33%. It fails. The verdict is recorded as a failure.

**However** — and this is a separate claim, filed separately for owner
ratification rather than resolved here — a rule that scores a **cheaper** run as
a regression is measuring the wrong thing, and that is a defect in the rule, not
a loophole for this mechanism. Prompt caching discounts a cache hit ~90%; it
made tokens and money diverge by design, three years after the rule's ancestor
was written. **A proposed amendment to §6 is filed at
[[../../Decisions/2026-07-29-lift-rule-cost-vs-tokens-amendment]].** It is a
PROPOSAL. §6 is not edited, and this verdict stands under §6 as it exists today.

### 5.5 — What would change this verdict

Not a reinterpretation. Any of:

1. **Ratification of the §6 amendment**, after which `stable-surface` would be
   re-scored on the cost leg (−4.4% vs the default at haiku) — and would still
   need the accuracy leg, which is currently unmet.
2. **A rung-2 task shape where haiku is off ceiling**, so the accuracy leg
   becomes measurable at the tier that carries the cost signal. This is the
   single highest-value follow-up: the current bench cannot detect an accuracy
   effect on the only tier where money is observable.
3. **≥2 tasks in the bench**, so the gate's between-task term exists and the
   formal `evaluateLiftGate` can actually be run against this data instead of the
   rule being applied by hand as it is here.
4. **Diagnosis of the rung-3 `llm_error` cells**, which would either strengthen
   the accuracy finding or retract it.

---

## 6. Programme scorecard after this measurement

- **Lift measurements to date: 7. Cleared the bar: 0.** `stable-surface` is the
  seventh attempt and the sixth to fail on the token leg. A-tier gate 1 ("one
  mechanism clears the lift rule") remains **OPEN**.
- **Corrected harness overhead: +141% tokens / +156% cost** (haiku, n=3, one task
  shape), replacing the retracted 555–640%. Still ~9.4× the §6 ceiling. **The
  simplification program's conclusion survives; only its magnitude changes.**
- **F10's mechanism is confirmed real.** `stable-surface` is the only arm that
  reaches non-zero `cacheRead` with a stable prefix by construction rather than
  by accident, and the 6.3% cost gap over `no-prune` at identical token counts is
  the cache doing exactly what F10 predicted. **The mechanism works; it just does
  not clear a token-denominated bar.**
- **New lead, not a verdict:** lazy pruning correlates with deliverable failure
  on small local tool-callers (2/12 vs 11/12, p ≈ 3.2 × 10⁻⁴), half of it
  instrument-confounded. First live evidence on the `RA_LAZY_TOOLS` demotion
  question.
- **Open instrument gap:** the composite bench is a single task, so no result
  from it can be run through the project's own `evaluateLiftGate`. Every verdict
  above is the rule applied by hand.
