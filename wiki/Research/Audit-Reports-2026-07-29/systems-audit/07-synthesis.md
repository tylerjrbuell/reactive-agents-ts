# Synthesis — Cross-System Cascade Analysis

**Date:** 2026-07-29. **Part of:** [[00-overview|Systems Audit — Root Cause Analysis]].

Single-agent (opus) cross-cutting synthesis over the 6 subsystem audits: [[01-tool-exposure]], [[02-context-assembly]], [[03-error-handling]], [[04-loop-control]], [[05-cross-tier]], [[06-observability]]. Independently re-verified load-bearing claims against source before synthesizing (listed in §0 below). Adversarial verification of the resulting top-8 ranked root causes is in [[08-verify]].

---

# SYNTHESIS — Cross-System Cascade Analysis of Six Subsystem Audits
### Reactive Agents harness, audit date 2026-07-29, against `main` @ `145671e6`

---

## 0. What I independently verified before synthesizing

Synthesis that just re-narrates six audits is worthless, so I re-grounded the load-bearing claims and the places where two audits were looking at the same object from opposite sides. Everything below that I checked myself:

- `packages/runtime/src/builder/contract-tool-set.ts:117-133` — `mergeContractRequiredTools`'s `contractRequired.length === 0` branch returns `priorConfig ?? (reasoningEnabled && toolsEnabled ? { adaptive: true } : undefined)`. **Tool-exposure Finding 1 confirmed at source.**
- `packages/runtime/src/engine/phases/agent-loop/setup/classifier.ts:117-127` — `wantsClassification` reads `config.requiredTools?.adaptive === true`. Confirmed.
- `packages/benchmarks/src/disclosure-ablation.ts:123-127` — every arm is built with `.withTools({builtins: true, adaptive: false})` + `.withReasoning({defaultStrategy:"reactive"})` and **no `.withRequiredTools()` call**. Confirmed; the contamination path is live in the harness underneath F9/F10 and rungs 2–4.
- `packages/reasoning/src/kernel/loop/terminate.ts:106-165` — `applyTerminalPostConditionGate`, docstring: *"NO LLM, NO fs: `verifyPostConditions` is a pure ledger scan."*
- `packages/reasoning/src/kernel/capabilities/verify/post-conditions.ts:236-330` — `isArtifactProduced`, docstring: *"Ledger-only, pure. NO fs access."*
- `packages/reasoning/src/kernel/loop/runner.ts:1288-1310` → `packages/reasoning/src/kernel/state/completion-status.ts:41,48` — `terminatedBy: "harness_deliverable"` + failed authorship check → `meta.harnessAuthoredOutput = true` → `resolveCompletionStatus` → `partial` → `success: false`.
- `packages/reasoning/src/kernel/loop/runner.ts:955-1000` — unmet required tools → `transitionState({status:"failed", output: null})`.
- `packages/reasoning/src/kernel/loop/runner.ts:775-776` — the loop guard is `state.iteration < currentOptions.maxIterations`, i.e. **per kernel pass**.
- `packages/tools/src/drivers/select-driver.ts:25-42` — `_dialect` is documented as *intentionally* unused in "Stage A" because the text-parse think→acting transition does not exist yet.
- Raw cell dumps of `wiki/Research/Harness-Reports/2026-07-28-rung{2-haiku,3-qwen35,3-granite4}.json` (all 45 cells: arm/status/terminatedBy/correct/wroteFile/iterations/tools/tokens/calls/cacheRead/cost).

Two of those re-groundings **materially changed the interpretation** of a submitted finding, and one produced a defect that none of the six audits found. Both are flagged inline.

---

## 1. CASCADE MAP

I found five cascades. Three are genuine multi-system chains; two are two-node links. Findings are cited by their submitted titles, abbreviated after first use.

---

### CASCADE A — "The measurement substrate is contaminated, again"
**Root: "The F6 classifier opt-in fix is silently defeated for the common builder pattern — `mergeContractRequiredTools` re-defaults `requiredTools` to `{adaptive:true}`" (tool exposure).**

```
                    TE-1 classifier default-on  ◄──masked by──  TE-2 two unrelated `adaptive` fields
                              │
        ┌─────────────────────┼──────────────────────┬────────────────────────┐
        ▼                     ▼                      ▼                        ▼
  extra LLM call        mutates the             feeds lazy-disclosure    can mint an ENFORCED
  per kernel run        `tools` array           allow-set (F6-documented) required-tool set
        │                     │                      │                        │
        ▼                     ▼                      ▼                        ▼
  TE-3 F7's "+168%"    F10 / D-2026-07-28-B    CT-3 granite4 never     runner.ts:955-1000
  is not matched-      cache-prefix churn is    calls file-write        fails run + NULLS output
  surface              measured THROUGH the     (0/6 pruned cells)      (see A′ below)
        │              thing that perturbs it
        ▼                     │
  EH-2/CT-2 qwen3.5 XML       ▼
  decode crash rate is   every rung2/3/4 arm-vs-arm
  per-LLM-call, so an    token & cost delta
  extra call inflates
  kernel-arm-only crash rate
```

**Causal statements:**

1. **TE-1 → TE-3.** `"F7's currently-standing '+168% matched-surface' figure and F9/F10's own verification harnesses are themselves running under the unaccounted classifier confound"` is not an independent finding — it is TE-1's blast radius. Collapse it into TE-1.
2. **TE-2 masks TE-1.** `"ToolsOptions.adaptive and RequiredToolsOptions.adaptive are two unrelated fields sharing the name 'adaptive'"` is the *reason* TE-1 survived a whole session of people writing `adaptive: false` in benchmark scripts and believing they had controlled for it. TE-2 is not a separate defect to rank; it is TE-1's concealment mechanism, and fixing TE-1 without renaming one of the two fields leaves the next person the same trap.
3. **TE-1 → EH-2 / CT-2 arm correlation.** `"qwen3.5-on-ollama llm_error cells are a real, reproduced local-model tool-call-decode fragility"` and `"qwen3.5's pruned-arm llm_error crashes are diagnosed"` (two audits, same live repro, independently reproduced 4× and 2× respectively — **this is the strongest-evidenced finding in the whole set**) both note the crash is per-generation-attempt. TE-1 adds 1–2 extra generation attempts to **kernel arms only** (`classifyTools` is called from `pre-loop-dispatch.ts`, which the inline path never traverses). So the recorded 4/6-pruned-vs-1/9-nonpruned crash split is measured on arms that do not have equal numbers of dice rolls. The error-handling audit's conclusion ("small-n Bernoulli noise around one systemic zero-retry defect, not caused by pruning") is *strengthened* by this, not weakened.
4. **TE-1 → F10.** F10 / `D-2026-07-28-B` is literally about per-iteration mutation of the `tools` array at position zero of Anthropic's cache prefix. TE-1 injects a second, undeclared writer into the allow-set that determines that array. The catalogue's "highest open item" is being measured through an uncontrolled input to the thing it measures.
5. **TE-1 → CT-3 (partial).** `"Granite4's pruning-arm deliverable failures have a confirmed tool-level signature: file-write is never called in any of the 6 pruned-arm cells"` — I re-confirmed this from the raw JSON (pruned cells' tool lists are `[file-read, code-execute, list-directory|final-answer]`; 0/6 contain `file-write`; all 9 non-pruned completed cells contain it). The audit correctly flagged that it could not distinguish "absent from the wire payload" from "present but ignored." TE-1 is a candidate *cause* of the absence: the classifier is one of the writers of the allow-set that decides what stays on the wire. This does not resolve CT-3 — it names the specific suspect and makes the discriminating probe cheap (re-run granite4's pruned arms with `.withRequiredTools({adaptive:false})` and diff the wire payloads).

**A′ — a new, unreported link inside Cascade A that I found while verifying:**
`classifier.ts:258-259` writes the classifier's inferred tools into `effectiveRequiredTools`, which becomes the run's **enforced** required-tool set. `runner.ts:955-1000` then fails the run with `missing_required_tool` **and sets `output: null`** if any of them wasn't successfully called. There is a hallucination guard at `classifier.ts:225-240` — but read its condition:

```ts
if (classifyResult.required.length > 1 && literalMentions.length < classifyResult.required.length)
  effectiveRequired = literalMentions;
```

**The literal-mention demotion only applies when the classifier names more than one required tool.** A classifier that returns exactly **one** hallucinated required tool bypasses the guard entirely and that tool becomes a hard, output-nulling failure condition — on the default `.withReasoning()+.withTools()` path, because of TE-1. I did not reproduce this live (it needs a classifier response fixture returning a single tool), so I rate it **plausible-unverified**, but it is a one-line-verifiable claim and it converts TE-1 from "a cost confound" into "a correctness risk."

---

### CASCADE B — "There is no single, world-grounded owner of 'did this succeed'" *(the structural one)*
**Root: success/failure is adjudicated by at least four independent, filesystem-blind authorities that reason over reconstructed proxies of the world, and they err in both directions.**

This cascade unifies findings from **three separate audits that were each looking at one face of the same object and none of which saw the others**.

```
   ROOT: success authority is a ledger/steps RECONSTRUCTION, never the world
        │
        ├─ authority 1: applyTerminalPostConditionGate (terminate.ts:106-165) "NO LLM, NO fs"
        ├─ authority 2: terminal Verifier `output-is-model-authored` (runner.ts:1288+)
        ├─ authority 3: missingRequiredToolsForInput → status:failed, output:null (runner.ts:955)
        └─ authority 4: computeDeliverableReport → goalAchieved (runtime/builder/helpers.ts:100-104)
        │
        ├──► FALSE NEGATIVE at scale ──► CT-1 "22 of 25 kernel cells report failure on a
        │                                 correct, on-disk deliverable" (3 tiers)
        │                                        │
        │                                        └──► forced disclosure-ablation.ts:208
        │                                             "Grade on DISK, not on the model's
        │                                             claim about the disk" — the bench
        │                                             had to route around the product's
        │                                             own core claim
        │
        ├──► FALSE POSITIVE ──────────► LC-1 "D-2026-07-28-D's pre/post-heal argsHash
        │                               divergence reaches the real terminal PostCondition
        │                               gate and goalAchieved for plan-execute tool_call steps"
        │
        ├──► amplified by ────────────► LC-3 "terminate.ts's 'single terminal owner' claim
        │                               holds only inside one ReAct kernel instance"
        │                               (this is WHY there are four authorities)
        │
        └──► new instances minted by ─► OB-1 "code-action strategy's sandboxed tool-execution
                                        bridge never merges a delegated sub-agent's ledger"
```

**Causal statements:**

6. **CT-1 and LC-1 are the same root cause, in opposite directions.** `"Kernel terminal/synthesis gate reports FAILURE on a correct, on-disk deliverable in 22 of 25 cells"` (cross-tier) and `"D-2026-07-28-D's pre/post-heal argsHash divergence is not replay-only"` (loop control) were filed by two audits as unrelated. They are not. Both are `verifyPostConditions` / `isArtifactProduced` — a function whose own docstring says *"Ledger-only, pure. NO fs access"* — deciding whether a file exists by pattern-matching recorded tool-call arguments against a derived target string. LC-1 shows the recorded arguments can be **stale** (pre-heal), producing a false-MET. CT-1 shows the same evidence substrate produces false-UNMET at 88% on real three-tier data. **Any fix that only loosens the gate to fix CT-1 will multiply LC-1's false-successes, and vice versa.** These must be discharged as one task.

7. **LC-3 explains why the root exists.** `"terminate.ts's 'single terminal owner' claim holds only inside one ReAct kernel instance"` (submitted as `isNew: false`, correctly) is the architectural precondition: because 7 of 8 strategies never call `terminate.ts`, deliverable-honesty enforcement had to be re-implemented at a receipt-assembly boundary, so there are now two structurally separate places that decide the same thing from the same untrustworthy substrate. This is the finding to promote from "known observation" to "root cause," because it is the thing point-fixes cannot resolve.

8. **OB-1 mints new CT-1 instances.** `"code-action strategy's sandboxed tool-execution bridge never merges a delegated sub-agent's ledger"` — `isArtifactProduced`'s *first* and canonical evidence source is `entriesOfKind(ledger, "artifact")`, and `isToolCalled`'s first source is `entriesOfKind(ledger, "tool-result")`. Both docstrings explicitly justify themselves on "a sub-agent's ledger merges into its parent's (Wave C.2 slice 2)." On the code-action path that merge does not happen. Therefore **a code-action run that delegates its deliverable to a sub-agent is guaranteed a false-negative from the deliverable gate** — not a possible one, a structural one. The observability audit filed this as a trace-fidelity gap; it is also a correctness gap in the success authority. Strategy-switching is default-on for multi-step tasks, so this is reachable without the user ever naming `code-action`.

9. **OB-3 is the reason 8 would not have been caught.** `"Sub-agent ledger merge on the kernel parent path is completely untested"` — the committed suite pins only the inline writer. Same shape as TE-1's own pinning test (`contract-required-tools-execute.test.ts:105-108` asserts the classifier default is `{adaptive:true}`, i.e. a test *pins the defect as intended behavior*) and CA-1's (`tier-tool-compression.test.ts:14` hand-passes `"full"`, a value the local profile never produces). **Three audits independently found the same test-design failure: a test that proves the branch works while never establishing that the branch is reached.**

**B′ — I re-grounded CT-1's mechanism and it changes the finding's meaning.** The cross-tier audit stopped at "the status field lies." Tracing it: haiku's 12/12 kernel cells terminate via `harness_synthesis` or `controller_early_stop`, **not** `harness_deliverable`, so the post-condition gate is likely not the failing authority there — authority 2 is. `runner.ts:1288-1310` fails the `output-is-model-authored` check whenever the harness (not the model) assembled the final answer; `completion-status.ts:25-26` states the rule explicitly: *"Shipping a partial is fine. Calling it 'completed' is not."* So on haiku, `status:failure` is **a deliberate honesty rule firing correctly**: the model never authored a clean terminal, so the run is not "completed." On granite4, `terminatedBy: harness_deliverable` + `correct: true` in 5 cells is the *other* authority — the post-condition/deliverable gate. **CT-1's "22/25" merges two different defects with two different fixes.** The real, unified defect is one level up and worse than what was filed:

> **`success` is a statement about the model's termination hygiene, and `correct` is a statement about the world, and the receipt exposes only the first while the framework markets it as the second.** A consumer reading `success:false` cannot distinguish "nothing was accomplished" from "everything was accomplished and the model never signed off." The framework's own benchmark had to bypass its own success field to get a trustworthy number (`disclosure-ablation.ts:208`).

That is the honest form of CT-1 and it belongs in the catalogue in that form, not as "the status field lies."

---

### CASCADE C — "The local tier is structurally unserved, and every safety valve for it is disconnected"
**Root: the calibration→driver signal path is severed by design and never reconnected; every mechanism built to compensate for weak local tool-calling is either dead, absent, or unreachable.**

```
  CT-4 driver selection ignores dialect ── documented as "Stage A", text-parse UNREACHABLE
        │                                   (select-driver.ts:25-42 — I verified this;
        │                                    it is deliberate incomplete work, not a bug)
        ▼
  every Ollama model gets NativeFCDriver + raw `tools:` schema on the wire, always
        │
        ├──► EH-2 / CT-2 qwen3.5 Ollama chat-template emits malformed <function></parameter>
        │         │        → hard HTTP failure, 0 tokens, no partial recovery
        │         ▼
        │    EH-1 "Streaming LLM calls get zero retry on all 5 providers" ──► total run loss
        │         (retryPolicy wired ONLY into complete(), never stream(); gatewayStream
        │          adds none; CircuitBreaker.protect re-throws, does not retry)
        │
        ├──► CT-5 no calibration exists for qwen3.5 or granite4 at all; the qwen3-family
        │    calibrations say toolCallDialect:"none" while STATIC_CAPABILITIES says
        │    "native-fc"; the live probe derives dialect from a capability FLAG, not a
        │    reliability RATE, so it structurally cannot detect this failure mode
        │
        └──► CA-1 "Local-tier's 'Required tools (call these)' grouping is unreachable
             dead code under the tier's own default profile"
                  │
                  └──► plausibly amplifies CT-3 granite4 never calls file-write
```

**Causal statements:**

10. **EH-1 converts CT-2 from a hiccup into a task failure.** The two audits reproduced the identical Ollama XML decode error independently (error-handling: 4 live runs; cross-tier: 2 live runs). The error-handling audit's added contribution is decisive: the same prompt against the same model **succeeds in the majority of re-runs**, so it is transient, but `provider-error.ts:190` classifies it as generic `LLMError` (not `LLMRateLimitError`/`LLMTimeoutError`), and even if it were classified correctly, `stream()` has no retry wrapper at all. **Two independent barriers between a recoverable fault and recovery.**
11. **CT-4 is the missing off-ramp.** If the dialect signal reached `selectToolCallingDriver`, a model with a fragile chat-template could be routed to `TextParseDriver`. It cannot — and per the source comment, routing there today would *strand* the model, because the text-parse think→acting transition was never built. So the correct statement is not "a dead branch" (as filed) but: **"the compensating mechanism for weak-tool-calling models was designed, half-built, documented as half-built, and then the half that would consume it was never finished — while the models it was designed for became the project's primary local benchmark targets."**
12. **CA-1 sits in the same chain.** `"Local-tier's purpose-built 'Required tools (call these)' grouping is unreachable dead code"` — the tier with (a) no dialect off-ramp, (b) no per-model calibration, and (c) no stream retry, is *also* the only tier whose `toolSchemaDetail` is not `"full"`, which is the exact guard that gates the required/other tool grouping written specifically for it. Four independent compensations for weak local models; **all four are inert**. CT-3 (granite4 never calling `file-write`) is the observed outcome that this chain predicts.

---

### CASCADE D — "The honest-observability spine has holes on exactly the majority path" *(two-node)*

13. **CA-2 → CT-1's interpretation.** `"Compaction's 'honest stub' silently omits non-recallable (small/inline) tool results from its retrieval disclosure"` — small tool results (below the 600–4000-char per-tier budget) never get a scratchpad ref, so when compaction drops them the stub says "N exchanges dropped" with no retrieval sentence and no signal that anything is unrecoverable. This is the same invariant as F1/03-F4, on the *common* case rather than the large-result case. It compounds Cascade B: a long kernel run (haiku: 16–28 iterations) that silently loses an early small result will re-derive or fail, and the receipt shows neither the loss nor the reason.
14. **EH-3 is Cascade B's observability twin.** `"lifecycle.failure.failureStreak is either hardcoded to 1 or silently repurposed"` — three code paths write one documented field with three different semantics, and the framework's own correctly-computed streak rides an *undocumented string tag* instead. Same shape as B: the system does the right thing internally and cannot be observed doing it. Independent enough to rank separately, but it is the same cultural failure.

---

### CASCADE E — "The token-accounting sweep (`D-2026-07-28-A`) was never completed" *(two-node)*

15. **OB-2 reopens D-2026-07-28-A.** `"LiteLLM provider path has zero cache-token accounting"` — `calculateCost(..., undefined, ...)` at both LiteLLM mapping sites means the full prompt is billed at base-input rate with no discount line. The register states *"every token-overhead number in this repository predating `2f97ca1e` is unverified"* and scopes the discharge to the corrected re-baseline. That discharge did not sweep the fourth provider. LiteLLM's error is **opposite in sign** (overstated cost) to the Anthropic bug (understated tokens), so any future comparison including a LiteLLM arm is skewed in the un-audited direction.

---

## 2. WHAT MUST BE RE-EXAMINED, BY ROOT CAUSE

### If TE-1 (classifier default-on) is confirmed — and I confirmed the code path myself:

| Artifact | Why | Verdict needed |
|---|---|---|
| `F7` "+168% matched surface" (RUNNING-CATALOGUE) | `kernel+tools` arm has no `.withRequiredTools()`; `inline+tools` structurally cannot run `classifyTools` at all. The arms are not surface-matched. | **Asterisk → re-measure.** The residual kernel tax is *smaller* than +168%. |
| `F6` "✅ FIXED (`13dc6c80`, `228bf10e`)" | The fix is real for callers who never combine `.withReasoning()` + `.withTools()` without an explicit `.withRequiredTools()` — i.e. almost nobody. | **Downgrade FIXED → PARTIALLY FIXED.** Commit `60730287`'s claim is over-broad. |
| `F10` / `D-2026-07-28-B` (catalogue's "highest open item") | Measured through `disclosure-ablation.ts`, whose 4 reasoning arms all carry the confound; and the confounded mechanism *writes to the array being measured*. | **Asterisk on the mechanism; see §2b for a separate, worse problem with F10's numbers.** |
| `2026-07-28-rung2-haiku-composite.{json,md}` | All 12 kernel cells. | Asterisk on every token/cost/iteration figure. |
| `2026-07-28-rung3-qwen35.json`, `2026-07-28-rung3-granite4.json` | All kernel cells; plus TE-1 inflates per-arm LLM-call counts, which is the denominator for the `llm_error` rate. | Asterisk. |
| `2026-07-28-corrected-composite-rebaseline.md` | It is the discharge document for `D-2026-07-28-A` and was produced by the same harness. | Asterisk. |
| `09-UNIFIED-PROGRAM.md` §7 harness-cost figures | Already retracted once for the token bug; now carries a second, independent confound. | Keep retracted; do not re-cite until both are cleared. |
| `packages/runtime/tests/discover-tools-respects-surface.test.ts:62` | F9's pinned regression test — runs the confound on every CI invocation. Its *capability* claim still stands; its cost/call profile does not. | Fix the test's builder chain; F9's verdict unaffected. |
| `packages/runtime/src/__tests__/contract-required-tools-execute.test.ts:105-108` | **Pins the defect as intended behavior.** Any fix to TE-1 turns this test red, and whoever sees it red will be told by the test name that the old behavior was correct. | Must be rewritten *in the same commit* as the fix, with a comment naming F6. |
| `packages/benchmarks/src/abstention-cost.ts` (`kernel`, `kernel+tools` arms) | No `.withRequiredTools()`. (`kernel+required` is correctly protected by its static list.) | Re-run. |

### 2b. A separate defect in the rung-2 report that none of the six audits found

`wiki/Research/Harness-Reports/2026-07-28-rung2-haiku-composite.md` states its central epistemic rule:

> *"Cost and cache figures are near-deterministic and can be read at this n without the same caveat... they are not sampled from a noisy pass/fail distribution, so n=3 is enough to trust the relative ordering between arms."*

Its own raw data falsifies this. Per-run `no-prune` costs, from the JSON it links: **$0.0494 / $0.0459 / $0.0245** — a 2× within-arm spread, driven by `cacheRead` of **4,312 / 12,504 / 25,438** on three runs of an *identical* configuration. Per-run iteration counts for the same arm: 16 / 19 / 16; for `prune-only`: 28 / 19 / 18. Cost is downstream of iteration count and cache-hit luck, both of which are stochastic model-driven quantities. Arm means: `prune+discover` $0.0392, `prune-only` $0.0374, `no-prune` $0.0399, `stable-surface` $0.0374 — **all four kernel arms within 7% of each other, well inside the within-arm spread.**

Consequences:
- The report's "Establishes (high confidence)" section — `discover-tools` bought nothing; `stable-surface` reaches cost parity — is **not established at n=3**. The direction may well be right; the confidence label is wrong.
- **F10's headline "lazy disclosure saves 41% of raw tokens and costs 17% more money" does not reproduce in the rung-2 data.** F10's table (`inline 14,008 / prune-only 39,174 / prune+discover 41,555 / no-prune 66,719`) does not match the rung-2 means (`13,998 / 31,791 / 33,752 / 45,004`) — it is a different, likely lower-n run set, and its 17% cost inversion is smaller than the within-arm variance measured three runs later.
- This is the **sixth** consecutive instance of the project's own "instrument, not system" pattern, and it is a *new species* of it: not a broken probe, but a **correct probe with an incorrect confidence model**. The project's memory already contains the antidote ("Bench cells are Bernoulli"); the rung-2 report explicitly argues for an exception to it for cost, and the exception is wrong because cost is a *function of* the Bernoulli-ish iteration count.

### 2c. A loop-control defect none of the six audits found

`disclosure-ablation.ts:128` sets `.withMaxIterations(12)`. The recorded haiku kernel cells report **16, 16, 16, 16, 16, 18, 19, 19, 19, 19, 28, 28** iterations. `runner.ts:775-776` caps at `state.iteration < currentOptions.maxIterations` — **per kernel pass**. With strategy-switching default-on for multi-step tasks, a run consumes 12 iterations per pass and the declared budget is silently multiplied by the number of passes (12+4, 12+7, 12+12+4). This is a live budget-escape on the exact dimension the loop-control audit was scoped to, and it is the mechanical driver of both the cost variance in §2b and the `harness_synthesis` terminals in Cascade B′. **Confidence: strong-inferential** (the arithmetic is unambiguous and the code path is cited; I did not run a live probe to confirm the pass boundary is where the extra iterations come from).

### If Cascade B's root (fragmented success authority) is confirmed:

- **`D-2026-07-28-D` must be rescoped.** It is filed as *"latent correctness bug in the replay/observability boundary, not in the kernel itself"* with an optional discharge (*"reconcile in replay-agent.ts (or store post-heal args in step-executor.ts)"*). LC-1's trace shows the pre-heal args reach `terminate.ts`'s live terminal gate and `goalAchieved`. Storing post-heal args is **not optional**.
- **`F2` must come off RETRACTED and be re-filed in its corrected form** (per B′). The retraction was correct about the *original* probe; the defect it named reproduces on the fixed instrument at n=25 across three tiers, in a form the original never articulated.
- **Every accuracy claim in this repo that was read off `status` rather than on-disk state must be re-derived.** Concretely: `F8`'s "4/4 kernel runs failed across both tiers" (which is the current #1-leverage entry in the catalogue's own table) was read off `status=failure`. Given the 88% false-negative rate on kernel-path `status`, **F8's outcome-flip claim is unverified** — its cost claim (46k tokens, 21 iterations) is independent and survives, but "the kernel cannot handle a missing tool input while inline can" needs a disk-graded re-run. This is the highest-leverage single re-examination in the whole document, because F8 is the entry the catalogue ranks #1.
- `wiki/Failure-Modes/FM-B Tool Errors.md`'s un-retracted 86.7%/100% figures (EH-4) should be swept in the same pass — P0-13's discharge explicitly did not cover the `wiki/Failure-Modes/` tree.

---

## 3. TOP 8 ROOT CAUSES, RANKED BY LEVERAGE

Ranking = (a) findings/measurements it corrupts or explains, (b) severity, (c) confidence. Cascading findings are collapsed into their root.

---

**#1 — Fragmented, filesystem-blind success authority**
*(collapses CT-1, LC-1, LC-3, OB-1's correctness half, and re-opens F2 and F8)*

- **Explains/corrupts:** 25 recorded cells across 3 tiers; 2 audits' top findings; the retracted-F2 history; F8's outcome claim; forced the project's own bench to bypass its own success field.
- **Severity:** critical. The project's stated moat is verification. Four independent authorities decide "did it succeed," none of them looks at the world, and they are wrong in **both** directions on real data.
- **Confidence:** confirmed (code + 45-cell dataset + two independent audits converging from opposite directions).
- **Cross-tier:** **universal.** 12/12 on haiku, 5/5 on granite4, 5/8 on qwen3.5. A defect this uniform across a 4.5B→frontier span is structural, not capability-related.
- **Industry standard:** **basic hygiene failure on the architecture, genuinely hard on the mechanism.** "A single terminal-decision owner" is table stakes and this codebase *claims* it (`terminate.ts` is CI-enforced as sole caller of `transitionState({status:"done"})`) while the claim only holds inside one kernel instance. That is a hygiene failure. But "verify a declared deliverable without touching the filesystem" is a genuinely hard, deliberately-chosen constraint (purity, replayability, sandbox-safety) — the hard part is real, the fragmentation is not.
- **The trap:** CT-1 and LC-1 pull the gate in opposite directions. Fix them in one commit or you will trade an 88% false-negative rate for a false-success rate.

---

**#2 — Classifier default-on via `mergeContractRequiredTools` (TE-1)**
*(collapses TE-2, TE-3)*

- **Explains/corrupts:** F7's standing number, F6's FIXED status, F10's measurement substrate, all three rung JSONs, the corrected re-baseline, 2 committed tests (one of which *pins the defect*), 2 benchmark scripts; contributes to CT-3's suspect list and inflates kernel-arm-only crash rates in Cascade A; plus the unguarded single-tool required-enforcement path (A′).
- **Severity:** critical for measurement validity; high for correctness via A′.
- **Confidence:** confirmed — I read `contract-tool-set.ts:117-133` and `classifier.ts:117-127` myself; the tool-exposure audit additionally reproduced it live and, notably, **caught and reported its own instrument trap mid-audit** (it first mis-probed via `toConfig()`, which does not reflect the default).
- **Cross-tier:** **universal** — it is builder/config wiring, provider- and model-independent. `classifierReliability` is never populated by any model table, so the gate passes identically on both tiers.
- **Industry standard:** **basic hygiene failure, twice.** (i) A default that contradicts the module's own header comment (`classifier.ts` says "OPT-IN as of 2026-07-28") and the catalogue's own FIXED entry. (ii) Two semantically unrelated config fields named `adaptive`, one nested and one top-level, where setting the reachable one gives false assurance about the other. Neither is hard; both are the kind of thing a config-surface review catches.
- **If you fix only one thing before the next measurement session, fix this** — every other number is measured through it.

---

**#3 — `retryPolicy` wired into `complete()` but never `stream()` on all 5 providers (EH-1)**

- **Explains/corrupts:** every `llm_error` cell in rung 3; the entire qwen3.5 pruned-arm failure story (which was originally attributed to tool-surface churn); jointly with #2, the arm-correlated crash pattern.
- **Severity:** critical. Two sibling functions in the same file, one inherits the retry contract and the other — the one 100% of kernel `think` calls take — does not. A transient 429 on a frontier provider ends the run.
- **Confidence:** confirmed by source on all 5 providers; live-reproduced on Ollama 4× by one audit and 2× independently by another. **The single best-evidenced finding in the set.**
- **Cross-tier:** **universal by structure**, live-confirmed local-only. The audit correctly self-flagged that the frontier arms are source-inspection only. That gap is worth 20 minutes to close, because a frontier rate-limit failure is the commercially expensive case.
- **Industry standard:** **basic hygiene failure.** Distinguishing transient from permanent errors and retrying the former is the most standard thing in this entire document. The codebase *has* the policy, correctly designed, with a correct doc comment — it just isn't attached to the path that matters.
- Compounding: `provider-error.ts:190` also mis-classifies the Ollama template fault as generic `LLMError`, which `retry.ts` excludes by design. Fixing the wiring alone will not recover this specific case; the classifier needs a branch too.

---

**#4 — The calibration → driver signal is severed, and no calibration exists for the models actually in use (CT-4 + CT-5)**

- **Explains:** why #3's local-tier failure has no off-ramp; why the framework cannot detect the failure mode it is suffering from; CA-1 sits in the same chain.
- **Severity:** high.
- **Confidence:** confirmed. **But I am downgrading the framing.** `select-driver.ts:25-42` documents `_dialect` as intentionally unused in "Stage A" because *"`think.ts` has no transition that turns `<tool_call>` markup into `status: "acting"`, so `act.ts`'s text-parse `extractCalls` is unreachable. Routing a capable model there strands it."* This is **not** an accidental dead branch — it is honestly-labelled incomplete work with a named design spec. The defect is not "someone forgot"; it is that **Stage B was never built while the models it was for became the primary local benchmark targets**, and nothing tracks that.
- **Cross-tier:** **tier-specific** — Ollama-served models only. Anthropic/OpenAI/Gemini go through native schema-validated channels with no template-translation layer, so driver choice is moot for them.
- **Industry standard:** **mostly a genuinely hard problem, with one hygiene failure inside it.** Measuring per-model tool-call *reliability* (as opposed to reading a capability flag) is real, expensive work. But two loaded sources (`STATIC_CAPABILITIES` says `native-fc`, `calibrations/qwen3-14b.json` says `none`) contradicting each other on the same field for the same model with **no reconciliation logic anywhere in the resolver chain** is hygiene — and so are the byte-identical `calibratedAt` timestamps on `llama3.2-3b.json` and `llama3.2-latest.json`, which are copy-paste evidence.

---

**#5 — Cache-prefix churn (F10 / `D-2026-07-28-B`) — *now with a compromised evidence base***

- **Explains/corrupts:** it is the catalogue's own "highest open item," and it is now sitting on two independent problems: TE-1 perturbs the array it measures (§1, link 4), and §2b shows its cost inversion is smaller than the within-arm variance of the most recent 3-run dataset.
- **Severity:** high as a mechanism; **the specific measured claim should be considered unresolved.**
- **Confidence:** the *mechanism* is confirmed (three `cache_control` breakpoints at position zero of a mutating array — the context-assembly audit independently verified there is no non-deterministic ordering anywhere else, which is a real and useful negative). The *magnitude and sign of the cost effect* is **not** confirmed at n=3.
- **Cross-tier:** mechanism is universal; only Anthropic monetizes prefix caching, so the cost consequence is provider-specific.
- **Industry standard:** **basic hygiene failure.** A stable cache prefix is the single most standardized optimization in production agent harnesses. The codebase knows this — the fix plan is written — but note the honest constraint it records: the Anthropic API exposes no per-tool logit masking, so the industry "mask, don't mutate" rule cannot be applied literally. That part is genuinely hard.
- Related and already correctly filed: `D-2026-07-28-C` (`goal_state` write-only) means half of F10's original analysis has never fired on a real run.

---

**#6 — Compaction's honest stub is silent about non-recallable results (CA-2)**

- **Explains:** an unmeasured contributor to long-run failures; a live analog of the F1/03-F4 honesty class on the *majority* case rather than the edge case.
- **Severity:** high. The stub reads identically whether nothing was lost or six unrecoverable results were dropped.
- **Confidence:** confirmed — probe output shown, and the audit correctly identified that **every existing compaction test constructs dropped exchanges via `mintScratchpadRef`, so only the recallable path has coverage** (fourth instance of the test-reaches-the-branch-but-not-the-real-case pattern).
- **Cross-tier:** mechanism is tier-independent; more likely to fire on local tier (largest `toolResultPreserveBudget` at 4000 chars meets the smallest real context windows).
- **Industry standard:** **basic hygiene failure.** "Never lie about what you dropped" is the framework's own stated spine; the guarantee was scoped to one namespace.
- Caveat the audit itself raised and I endorse: `DEBT-REGISTER` notes compaction rarely fires post-Wave-3 (full-window-only threshold), so **occurrence rate is unmeasured**. Severity of the defect is high; expected frequency is unknown. Do not rank this above #1–#3 on that basis.

---

**#7 — Wave C.2 slice 2 has an unfixed fourth delegation path (OB-1 + OB-3)**

- **Explains:** a structural false-negative generator feeding root cause #1 (§1, link 8); OB-3 is the reason it would not be caught.
- **Severity:** high (correctness, not just trace fidelity — the observability audit under-rated its own finding by scoping it to receipts).
- **Confidence:** confirmed, live-reproduced at the strategy-function level; and OB-3's kernel-path probe **passed**, which is worth stating plainly — the mechanism is sound where it is wired, and the audit resisted the temptation to report an untested path as broken.
- **Cross-tier:** universal (pure wiring).
- **Industry standard:** **basic hygiene failure** — an incomplete rollout of a fix across the set of paths that structurally do the same thing. Note the aggravating detail: `DEBT-REGISTER:166` already lists code-action as a structurally separate ledger writer *for a different concern*, so the team knew the path existed and did not check it for this one.

---

**#8 — The local tier's compensations are all inert (CA-1, as the representative)**

- **Explains:** part of CT-3 (granite4's `file-write` starvation); the general shape of "the tier we most want to uplift receives the least support."
- **Severity:** medium-high. The `Required tools (call these)` grouping is guarded on `detail === "full"` while `CONTEXT_PROFILES.local.toolSchemaDetail = "names-and-types"` — the only tier profile that isn't `"full"`. The mechanism written *specifically for weak-FC local models* is the one mechanism they can never reach.
- **Confidence:** confirmed by live probe against the real `buildThinkProviderRequest` path with the unmodified profile object.
- **Cross-tier:** **tier-specific by construction** — mid/large/frontier set `"full"` and never reach the guard.
- **Industry standard:** **basic hygiene failure.** A guard condition and a profile constant that were never reconciled, plus a test that hand-passes a value the system never produces.
- Behavioral consequence (does granite4 actually mis-call tools more without the grouping) is **untested** — this is a reachability defect with a plausible but unmeasured downstream effect. Do not promote it above #7 without the A/B.

---

**Deliberately ranked below the cut — real, confirmed, but leaf-level (no downstream amplification found):**
- **OB-2** LiteLLM zero cache accounting — reopens `D-2026-07-28-A`'s completeness, but affects only LiteLLM-routed arms, of which this session ran none. Fix it in the same commit as any other token work.
- **EH-3** `failureStreak` hardcoded/repurposed — a documented public API that cannot do the thing its own doc example shows. High embarrassment, zero cascade.
- **LC-2** arbitrator veto fix unpinned + its stated follow-up never filed in any tracker. The *unfiled follow-up* is the more interesting half: a known-unresolved failure source that exists only in a commit message is invisible to the canonical trackers and indistinguishable from abandoned work.
- **CA-3** (`observation`/`terminated` AgentEvent kinds with zero writers and zero readers), **CA-4** (uncited large/frontier compression budgets), **EH-4** (`FM-B Tool Errors.md` still carries the debunked 86.7%/100%).

---

## 4. WHICH AUDITS CAME BACK THIN — AND WHETHER I BELIEVE THEM

**Strongest: tool exposure.** It found a critical root cause, traced it through five files, reproduced it live, and — the part that earns the most trust — **caught its own instrument trap mid-audit and reported it** (it first probed via `toConfig()`, which does not reflect the default, and said so). It also reported a *negative*: it checked whether `hasClassification` was keyed off "was classification attempted" (which would create a worse-than-unclassified trap) and found it correctly keyed off non-empty output. Specific falsifiable negatives are the signature of a real audit.

**Strongest evidence: error handling.** Four live reproductions against a real Ollama daemon, plus an explicit falsification of its own hypothesis (it re-ran the `no-prune` arm three times specifically to test whether pruning caused the crash, and found the crash on the unpruned surface too). That is the discipline the project's "instrument, not system" prior demands. It correctly self-flagged the frontier arms as source-inspection-only.

**Genuinely clean negative, which I believe: context assembly on ordering.** It checked `select-tools` / `tool-surface` / `tool-schemas` for the non-deterministic-ordering pattern that would break caching, and found that Sets are used only for membership tests with output order derived from stable source-array `.filter()`. This is a **specific, falsifiable, mechanism-level check with a named method**, and its result is load-bearing for F10 (it rules out an alternative cause). I believe this one. The audit was not thin; it just found a healthy subsystem and said so.

**Weakest, and I do not believe its negative: observability's cross-provider token/cost half.** It verified Anthropic (already fixed and pinned by `cached-input-tokens-are-counted.test.ts`), found LiteLLM by inspection, and then declared **OpenAI and Gemini "independently correct by their own API semantics but have zero regression coverage"** — an assertion by reading, with no probe and no test. Given that `D-2026-07-28-A` is *precisely* a case where token accounting was wrong by inspection-passes-but-reality-differs, "correct by inspection, untested" on token accounting is the exact claim that has already failed once in this repository. **This is the one negative in the whole set I would not accept.** Two arithmetic probes against recorded usage payloads would settle it.

**Notable structural miss: loop control did not look at the data.** It produced an excellent 9-file static trace of LC-1, but it never opened `wiki/Research/Harness-Reports/2026-07-28-rung*.json` — where 22 cells of live evidence about termination behavior were sitting, in the directory it was pointed at. The cross-tier audit opened the data but did not trace the mechanism to `harnessAuthoredOutput` / `resolveCompletionStatus`. **Two audits held the two halves of Cascade B and neither had both.** This is a process finding, not a system finding: the audit decomposition (by subsystem) cut across the defect (which spans termination + verification + receipts + cross-tier data), so no single auditor could see it. If you run this again, add one auditor whose scope is *a boundary* rather than *a subsystem*.

**Cross-tier audit: strong on data, weak on mechanism.** It correctly identified the 88% signal and correctly refused to grade on `status`, but stopped at "the status field lies," which is the *least* actionable form of a finding that turns out to be about a deliberate honesty rule colliding with an ungrounded deliverable check. Its CT-4 finding also over-claims: it reads as "someone wired a dead parameter" when the source explicitly documents it as staged incomplete work.

**Subsystems nobody audited (state this explicitly before anyone reads the clean sections as reassurance):** memory/recall, cost-aware routing, HITL/durable-runs, MCP integration, structured output, and — most consequentially — **strategy switching**, which §2c shows is silently multiplying a declared iteration budget by the number of passes and is implicated in the cost variance of §2b and the `harness_synthesis` terminals of Cascade B′. Six audits ran; strategy switching sits in the blast radius of three of them and was scoped to none.

---

## 5. STATE OF THE HARNESS

**Structural.** I would not have written that word if the evidence supported "isolated rough edges," and there are genuinely excellent parts of this system — the ledger substrate, the compaction protected-classes design, the tool-surface resolver's ordered pipeline, the deterministic tool ordering, the retry policy itself, the honesty rule in `completion-status.ts` that refuses to call an unverified partial "completed." These are not the work of a careless team; several are better than what most production harnesses ship. But the defects are not distributed like a system with rough edges. They are distributed like a system with **one architectural incoherence expressing itself repeatedly, plus a process that systematically ships fixes to the paths currently under measurement rather than to the set of paths that structurally do the same thing.** The incoherence is this: the harness decides whether the world changed by reasoning over a reconstruction of what it *believes* it did — ledger entries, recorded tool-call arguments, authorship heuristics, LLM-inferred required-tool sets — and it never once looks at the world. That single choice produces an 88% false-failure rate on three tiers, a false-success path on plan-execute, a guaranteed false-negative on code-action delegation, and a benchmark suite that had to write `// Grade on DISK, not on the model's claim about the disk` in order to measure its own product. No number of point fixes to `isArtifactProduced` resolves that, because the problem is not that the reconstruction is buggy — it is that four different authorities each own a piece of a decision that should have exactly one owner and exactly one ground truth. The second pattern is process, and it is equally structural: Wave C.2 was wired at three of four delegation sites; the F6 opt-in fix landed at the resolver but not the config layer that feeds it and was then *pinned as correct by a test*; the token-accounting sweep covered three of four providers; the tool-calling driver's Stage B was never built while its target models became the benchmark; the local tier's four compensating mechanisms are all inert. Every one of those is "fixed where we were looking." And the newest instance — §2b, where a methodologically careful report argues for a confidence exception that its own raw data refutes — is the sixth consecutive instrument fault in this project's ledger, but the first that is not a broken probe: it is a correct probe with a wrong confidence model, which is a harder failure to catch and a more honest sign of where the team's remaining blind spot is. The good news is that all of this is legible, and the two highest-leverage moves are cheap and independent: **one commit that gives the success authority a single owner with access to ground truth (fixing CT-1 and LC-1 together, because separately they trade one error direction for the other), and one commit that removes the classifier default so the next measurement session is measuring the system rather than the confound.** Until the second one lands, treat every 2026-07-28 arm comparison as provisional — including F8, which the catalogue currently ranks #1 and which was scored on the field this audit just showed is wrong 88% of the time.