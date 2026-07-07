# Architecture Sweep 2026-07-07 — 06-compression-grounding-verification

Advisor unavailable. My two load-bearing claims are confirmed from source (the `:full` ref returns `step.result` at plan.ts:184; receipts live at execute-stream.ts:411 / reactive-agent.ts:1500 vs honesty labels offline in trace/analyze.ts). Writing the report.

---

## Findings (ranked by leverage)

1. **Preview/full duality is the core disease family, and FM#3 has a live sibling.** A tool result is stored in ≥6 places with two different representations (compressed preview vs full), and only ONE consumer resolves the full form correctly (`buildEvidenceCorpusFromSteps`, evidence-grounding.ts:28-31). **Remaining FM#3 site:** `resolveStepReferences` `{{from_step:sN:full}}` returns `step.result` (the compressed preview) at `types/plan.ts:184`, even though `step.fullResult` exists (plan.ts:82) and is populated (plan-execute.ts:710). `:full` is documented as "transfers whole content (e.g. file-write `content`)" (plan.ts:162-163) but hands back the truncated preview — a silent data-loss bug for the exact case it was built for. `resolveStepReferences` has no access path to `fullResult` at all (signature takes `PlanStep[]` but only reads `.result`).

2. **Semantic memory is fed the compressed preview, not the full result** (tool-execution.ts:613 passes `result.content`, tool-execution.ts:743 passes `result.content` with `extractedFact` preferred). The "memory of past tool calls" mechanism persists lossy previews; only the deterministic one-liner `extractedFact` is high-fidelity.

3. **5-6 independent, uncoordinated compaction paths with different trigger thresholds and NO post-compaction outcome check.** Nothing verifies that what survived compaction still supports the eventual answer.

4. **Verification is already graded but fragmented across three homes with inconsistent evidence sources**, and the live "receipt" (`TrustReceipt`) uses a different vocabulary than the offline honesty label — the same run is graded twice by two disconnected systems.

5. **A "ledger" concept already exists in the code** (post-conditions.ts calls `state.steps[]` "the run LEDGER") but it stores previews, so it is not authoritative for content-level checks. The append-only-ledger idea in Q6 is a rename+enrichment away, not a greenfield build.

---

## Compaction path census

| # | Path | Trigger | Location | Coordinated? | Outcome check? |
|---|------|---------|----------|--------------|----------------|
| 1 | **Sliding message-window compact** — folds old turns to `[Prior: called X → brief]` | est. tokens > **0.75**·maxTokens | `context/message-window.ts:48` (`applyMessageWindowWithCompact`), called `attend/context-utils.ts:285` | independent | none |
| 2 | **Tool-result compression + scratchpad store** — `compressToolResult` → preview + `_tool_result_N` full store | per-call, if result > budget (`toolResultMaxChars`, default 800) | `act/tool-execution.ts:554,706`; `attend/tool-formatting.ts` (`compressToolResult`,`nextToolResultKey`) | independent | none |
| 3 | **Context-pressure tool-narrowing** — offer final-answer only / prune tool schemas | est/max ≥ tier threshold **0.80–0.95** | `reason/think.ts:95-110` (`shouldNarrowToFinalAnswerOnly`, `computePromptSchemas`) | independent (narrows TOOLS not content) | none |
| 4 | **Observation fact-extraction** — distills long results to key facts | LLM pass when result > budget (`tool-execution.ts:843`); deterministic always (`extractFactDeterministic:781`) | `act/tool-execution.ts` + `tool-observe.ts:302` | independent | none |
| 5 | **from_step ref capping** — splice preview into downstream tool args, capped | on `{{from_step}}` resolution | `types/plan.ts:162` (`BARE_REF_MAX_CHARS=380`, `distillStepResult`) | independent | none |
| 6 | **`truncateForDisplay`** head+tail fallback | when structured compression unavailable | `act/tool-execution.ts:167` | independent | none |

Triggers are **inconsistent** (0.75 window vs 0.80-0.95 narrowing vs per-call byte budget). All six share only the coarse `CHARS_PER_TOKEN=4` heuristic (message-window.ts:19, mirrored in tool-formatting). **No path re-checks whether the answer is still derivable post-compaction** — answer to Q1: there is no post-compaction outcome check anywhere.

---

## Tool-result representation map (store → consumers → wrong-representation risks)

**Stores of a single tool result:**
| Store | Representation | Where written |
|-------|---------------|---------------|
| Message thread (`KernelMessage` `tool_result`) | compressed preview + `recall(key)` hint | tool-execution.ts:717-730 |
| `step.content` / obsStep `displayText` | compressed preview (`displayContent`) | tool-observe.ts:340 |
| `step.metadata.storedKey` → scratchpad `_tool_result_N` | **FULL** value | tool-execution.ts:556,710 |
| `step.metadata.extractedFact` | distilled one-liner | tool-observe.ts:343 |
| `PlanStep.result` | compressed preview | plan-execute.ts:708, plan.ts:78 |
| `PlanStep.fullResult` | **FULL** sanitized | plan-execute.ts:710, plan.ts:82 |
| `ToolObserveResult.fullResult` | **FULL** (`exec.fullContent`) | tool-observe.ts:377 |
| Semantic memory `SemanticEntry.content` | **compressed preview** (or `extractedFact`) | tool-execution.ts:117,613,743 |

**Consumers and which representation they get:**
| Consumer | Reads | Correct? |
|----------|-------|----------|
| Next-iteration LLM thread | preview + recall hint | OK (can recall) |
| Evidence-grounding corpus | `storedKey`→scratchpad **FULL**, fallback preview | ✅ **only consumer that resolves full** (evidence-grounding.ts:28-31) |
| Fabrication guard | same corpus (full) | ✅ |
| plan-execute synthesis | `s.fullResult ?? s.result` | ✅ (plan-execute.ts:1076) |
| blueprint synthesis / final output | `s.fullResult ?? s.result` | ✅ (blueprint.ts:477,500) |
| Terminal verifier `ctx.content` | model's final answer text | ✅ (correct object) |
| **`resolveStepReferences` `:full`** | **`step.result` (PREVIEW)** | ❌ **WRONG — live FM#3 sibling** (plan.ts:184) |
| `resolveStepReferences` bare / `:summary` | preview, capped 380/500 | intentional (FM#3 fix, plan.ts:194-196) |
| Semantic memory write | preview | ⚠️ lossy store (tool-execution.ts:613,743) |
| post-conditions `ArtifactProduced`/`ToolCalled` | ledger step preview content | ⚠️ existence-only, so tolerable; content-match would miss truncated data |

**Wrong-representation risks remaining:** (1) `:full` ref → preview (plan.ts:184); (2) semantic memory stores previews (tool-execution.ts:613,743). Both are the same disease as FM#3: a full-content consumer served a lossy projection because there is no single canonical full store keyed for all consumers.

---

## Grounding check inventory

| Check | Where | Enforced | Evidence read | Notes / inconsistency |
|-------|-------|----------|---------------|------------------------|
| `agent-took-action` | verifier.ts:350-395 | terminal, only if `requiredTools` non-empty | `ctx.toolsUsed` (Set) minus META | reads tools-used SET, not steps |
| `hasSuccessfulSubstantiveToolCall` (F1) | grounded-terminal.ts:63-69 | Arbitrator gate + runner §7.5 | `buildSuccessfulToolCallCounts(steps)` minus `HARNESS_PSEUDO_TOOLS` | reads STEPS; **different evidence source than `agent-took-action`** (steps vs toolsUsed Set) — the two "did the agent act" checks can disagree |
| F1 grounded-terminal gate (one-shot redirect) | arbitrator.ts (`applyGroundedTerminalGate`) + `TERMINAL_ANSWER_REASONS` (grounded-terminal.ts:44) | live | steps + requiredTools | rejects terminal once → `grounding-redirect` |
| F1 forced-abstention (2nd ungrounded) | runner §7.5, `force-abstention.ts` | live | steps | converts to `terminatedBy:"abstained"` |
| `evidence-grounded` (numeric) | verifier.ts:594; evidence-grounding.ts:244 | **opt-in** `.withGrounding()` | corpus (full via scratchpad) | off by default |
| `output-not-fabricated-measurement` | verifier.ts:570; evidence-grounding.ts:217 | **always-on** default `block` | corpus (full) | env killswitch `RA_FABRICATION_GUARD` |
| `output-is-model-authored` | verifier.ts:333 | terminal | `ctx.terminatedBy==harness_deliverable` | escalate |
| `output-not-harness-parrot` / scaffold-leak / continuation-intent / shallow-giveup | verifier.ts:397-568; scaffold-leak.ts | terminal, always-on | `ctx.content` + priorSteps | |
| post-conditions (`ToolCalled`/`ArtifactProduced`) | post-conditions.ts + arbitrator.ts:875 | **default-on** (`RA_POST_CONDITIONS` flag deleted, arbitrator.ts:844) | ledger `state.steps[]` | **state-grounded success authority** |

**Inconsistencies:** (a) two "agent acted" gates read different evidence (`toolsUsed` Set at verifier.ts:384 vs `buildSuccessfulToolCallCounts(steps)` at grounded-terminal.ts:66); (b) trace/analyze.ts:219 comment claims "RA_POST_CONDITIONS currently OFF" but arbitrator.ts:844 says the flag was deleted and post-conditions are default-on — **stale offline note contradicts live behavior**; (c) grounding checks split between guards (fabrication always-on), verifier (opt-in numeric), and arbitration (post-conditions, F1 gate) with no single "grounding" entry point.

---

## Verification tier map (live vs offline)

| Tier | Mechanism | Live? | Location |
|------|-----------|-------|----------|
| **Deterministic, pure** | `defaultVerifier.verify` (8+ checks, severity rollup pass/warn/reject/escalate) | LIVE | verifier.ts:284 |
| Deterministic, state-grounded | post-conditions spine (pure over ledger) | LIVE, default-on | post-conditions.ts; arbitrator.ts:875 |
| Deterministic grounding | fabrication guard (always-on), numeric grounding (opt-in) | LIVE | evidence-grounding.ts |
| F1 grounded-terminal invariant | gate + forced abstention | LIVE | grounded-terminal.ts, arbitrator, runner §7.5 |
| **LLM self-critique** | `runCritiquePass` (temp 0.3, thinking-safe) | LIVE inside reflexion + plan-execute-reflect only | critique.ts:89 |
| **Live evidence-grade receipt** | `computeTrustReceipt` (heuristic verdict) | LIVE | receipt.ts:73; invoked execute-stream.ts:411, reactive-agent.ts:1500 |
| Receipt provenance signature | Ed25519 opt-in | LIVE opt-in | receipt-signing.ts |
| **Offline honesty label** | `HonestyCheck` (honest-failure / claimed-success (unverified) / dishonest-success-suspected) | **OFFLINE (bench/trace only)** | trace/analyze.ts:406-430 |
| Offline trust verdict | `trustVerdict(honestyLabel, accuracy)` | **OFFLINE** | benchmarks/diagnose.ts:25 |

**External independent judge:** none live. The only LLM-judge is `runCritiquePass`, but it is *self*-critique (same model family, invoked by the strategy itself), not an independent checker. **Cleanest slot for an independent-checker:** `verifyAndEmit` (verifier.ts:701) is already the single capability-boundary entry point that returns a `VerificationResult` AND emits the trace event; an independent checker added as a new `VerificationCheck` producer (or a post-`defaultVerifier` async tier) would inherit the severity-rollup contract (`verified = overallSeverity==="pass"`, verifier.ts:637) and every existing consumer without touching runner.ts.

---

## Honesty / receipts

- **Live:** `TrustReceipt` (core/types/receipt.ts) — verdict ∈ {tool-grounded, partially-grounded, ungrounded, abstained, failed}, heuristic, computed from in-memory run data at result assembly (execute-stream.ts:411, reactive-agent.ts:1500). Present even with tracing off. Optionally Ed25519-signed.
- **Offline:** the honesty *label* (`honest-failure` / `claimed-success (unverified)` / `dishonest-success-suspected`) is computed only in `packages/trace/src/analyze.ts:406-430` from trace data ("reads the trace only", analyze.ts:8); consumed by benchmarks (`diagnose.ts`, `runner.ts:1174`, `weakness-queue.ts`, `trace/cohort.ts`).
- **What it takes to carry honesty live:** the label's inputs (`claimedSuccess`, `deliverableProduced`, `substantiveWorkDone`) are all derivable from the same in-memory signals `computeTrustReceipt` already consumes (`toolCalls[].ok`, `terminatedBy`, `abstained`, `success`, `goalAchieved`). The live receipt already computes `toolCallStats.ok/failed` and `verdict` — the honesty label is a thin projection over the *same* data. The gap is purely that the label logic lives in the offline trace analyzer, not in `computeTrustReceipt`. Merging it would unify the two grading vocabularies (Finding 4). No new instrumentation needed.

---

## Better shape (keep / merge / delete)

**KEEP (already the right shape):**
- `_tool_result_N` scratchpad as the canonical **FULL** store (tool-execution.ts) — this is effectively the "full projection" already.
- `buildEvidenceCorpusFromSteps` (evidence-grounding.ts:18) — the reference implementation of "resolve every step to its full form"; it is the pattern every other full-consumer should reuse.
- `verifyAndEmit` (verifier.ts:701) as the single verification boundary; severity rollup contract (verifier.ts:621-647).
- post-conditions "ledger" framing (post-conditions.ts) — rename it and it *is* the evidence ledger.
- `computeTrustReceipt` as the live receipt sink.

**MERGE (single evidence ledger + projections):**
- One append-only ledger entry per tool result carrying `{full, preview, extractedFact, storedKey}`. Every current store becomes a **projection**, not a copy:
  - LLM-thread projection = preview + recall hint (today: tool-execution.ts:717).
  - Compaction projection = message-window fold (today: message-window.ts) — make all 6 compaction paths *re-project from the ledger* instead of independently truncating; one trigger, one budget.
  - Grounding/verification projection = full (today only evidence-grounding does this).
  - Receipt/honesty projection = `computeTrustReceipt` + honesty label from one place.
- Route `resolveStepReferences` through the ledger so `:full` reads the FULL projection (fixes plan.ts:184).
- Merge the two "agent acted" evidence sources (verifier.ts:384 `toolsUsed` Set vs grounded-terminal.ts:66 `steps`) onto the ledger's tool-call view.
- Merge honesty label into `computeTrustReceipt` (single grading vocabulary, Finding 4/Q5).

**DELETE / collapse:**
- Redundant compaction truncators once re-projection exists: `truncateForDisplay` (tool-execution.ts:167) and the ad-hoc 2000-char slice in semantic store (tool-execution.ts:110) collapse into the ledger preview projection.
- The stale "RA_POST_CONDITIONS currently OFF" note (trace/analyze.ts:219) — contradicts live default-on (arbitrator.ts:844).

**Graded verification chain to build on:** deterministic (`defaultVerifier`) → state-grounded (post-conditions) → grounding guards → [NEW independent checker tier] → receipt/honesty. All already return or roll into `VerificationResult`/`TrustReceipt`; the chain exists, it just needs the independent-checker rung and a shared evidence source.

---

## Signals worth exploiting

- `extractedFact` (deterministic, tool-execution.ts:781) — already a high-fidelity distilled projection stored per step; underused (only grounding corpus + semantic memory read it). Cheapest reliable "full-ish" signal for compaction.
- `storedKey` → scratchpad is a ready-made content-addressable full store; every lossy consumer already *could* resolve it (only evidence-grounding does).
- `TERMINAL_ANSWER_REASONS` / `HARNESS_PSEUDO_TOOLS` (grounded-terminal.ts:44, kernel-constants) — shared vocabularies that already prevent drift between two sites; the model to replicate for a shared ledger view.
- `VerificationResult.severity` rollup (pass/warn/reject/escalate) — a ready grading scale an independent checker can plug into without new plumbing.
- `computeTrustReceipt`'s deterministic verdict rules (receipt.ts:60-103) and the offline honesty inputs (`claimedSuccess`/`deliverableProduced`/`substantiveWorkDone`, analyze.ts:406) are computed from overlapping in-memory data — a merge is low-risk.

Note: one stale doc signal to distrust — trace/analyze.ts:219 asserts post-conditions are OFF; the live arbitrator (arbitrator.ts:825-844) treats them as default-on with the flag deleted.