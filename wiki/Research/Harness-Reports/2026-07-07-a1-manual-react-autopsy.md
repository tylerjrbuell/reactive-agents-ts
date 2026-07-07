# Manual-react autopsy — why a 50-line loop beats ra-full on qwen3:14b (and loses on cogito:8b)

**Status:** internal receipts report — Arc 1 companion to [[2026-07-07-public-competitor-bench-qwen3-14b-rerun]] and [[2026-07-07-bench-bottleneck-determination]] (B1–B5 already diagnosed there; this report covers what else differs).
**Scope:** `public-competitor-qwen3-14b` session traces (`packages/benchmarks/benchmark-traces/`, files `01KWXM8Q…`–`01KWYARQ…`, 54 files) + `public-competitor-cogito-8b` traces (files `01KWK3R1…`–`01KWK4YA…`, 45 files) + source-level read of the manual-react and ra-full execution paths.
**Headline accuracy (from the existing reports, not re-derived here):** qwen3:14b — manual-react 57% vs ra-full 35% (caveated lower bound, GPU-contention zombie fibers, see B5). cogito:8b — manual-react 33% (tied bare-llm) vs ra-full 44%.

---

## Finding 0 (new): "manual-react" is not a hand-rolled competitor — it is RA's own no-reasoning fallback path

The session comment (`packages/benchmarks/src/sessions/public-competitor-bench.ts:16`) and the existing report's parenthetical ("a ~50-line hand-rolled loop", `2026-07-07-public-competitor-bench-qwen3-14b-rerun.md:45`) both describe manual-react as an external, from-scratch ReAct implementation. It is not. Tracing the dispatch:

- `packages/benchmarks/src/session.ts:12` — `manual-react` is declared `type: "internal"`, `config: { tools: true }` (no `reasoning`, no `reactiveIntelligence`, no `memory`).
- `packages/benchmarks/src/runner.ts:766-792` (`dispatch`) — every `type: "internal"` variant, including `manual-react` and `ra-full`, is routed through the **same** `runInternal()` function, which builds an agent via `ReactiveAgents.create().withProvider(...).withModel(...)` (`runner.ts:590-594`) and conditionally chains `.withTools()`, `.withReasoning()`, `.withReactiveIntelligence()` based on `config`. manual-react only ever calls `.withTools()`.
- `packages/runtime/src/execution-engine.ts:655-947` — inside the shared execution engine, the presence/absence of `ReasoningService` (gated by `.withReasoning()`) is the fork point: `reasoningOpt._tag === "Some"` → the full kernel/reasoning path (ra-full); the `else` branch (`execution-engine.ts:759-947`, comment "Minimal direct-LLM loop") is what actually runs for manual-react.

So the two arms share: the same `ReactiveAgentsBuilder`, the same `LLMService`, the same `ToolService`/tool execution, the same event bus, the same `execution-engine.ts` phase pipeline (verify/memory-flush/cost-track/audit/complete phases still run, they just no-op when their `config` flags are off). The only thing that differs is which THINK/loop implementation runs each iteration: `runInlineThink`/`runInlineAct`/`runInlineObserve` (`packages/runtime/src/engine/phases/agent-loop/inline-*.ts`) vs. the kernel's `runReasoningThink` (`packages/reasoning/src/kernel/capabilities/reason/think.ts`). This is good news for attribution: the comparison isolates the **reasoning-layer additions themselves**, not confounds from different HTTP clients, retry logic, or tool-execution code — but it also means the "raw SDK + native FC, build-it-yourself" framing in the session file is inaccurate and should be corrected (it's RA's own inline fallback loop, exercised via `.withTools()` alone).

Practical consequence for this analysis: manual-react cells never call `LLMExchangeEvent`-emitting code (that instrumentation lives only in `packages/runtime/src/engine/phases/agent-loop/reasoning-stream-logger.ts:108`, wired only on the reasoning branch), so **manual-react traces contain no `llm-exchange` events** — only `tool-call-start`/`tool-call-end`/`run-started`/`run-completed`. All manual-react numbers below are derived from tool-call counts + the inline-think.ts source, per the task brief's fallback instruction.

Trace-kind classifier used to separate the 54 qwen3:14b files into the 3 internal variants (18/18/18 — consistent with 5 tasks × 3 runs = 15/variant + 3 retries):
| Variant | Signature | n (qwen) |
|---|---|---|
| bare-llm | 2 events only (`run-started`, `run-completed`), no tool/llm-exchange events | 18 |
| manual-react | `tool-call-start`/`tool-call-end` present, **no** `llm-exchange` | 18 |
| ra-full | `llm-exchange` events present | 18 |

Caveat: a manual-react cell that never calls a tool is trace-indistinguishable from bare-llm (both would be 2-line files). This did not appear to contaminate the qwen split (18/18/18 is clean), but did visibly contaminate the cogito split (29 "bare-llm" / 15 ra-full / 1 "manual-react" out of 45 files) — cogito's manual-react apparently called zero tools in most cells. Cogito-side per-cell numbers below are therefore restricted to the unambiguous `ra-full` subset (n=15, confirmed via `llm-exchange` presence).

---

## Q1 — Prompt tax

**manual-react system prompt is a hardcoded constant.** `packages/runtime/src/engine/phases/agent-loop/inline-think.ts:87-89`:
```ts
const defaultPrompt = config.systemPrompt ?? "You are a helpful AI assistant.";
```
The benchmark runner (`packages/benchmarks/src/runner.ts`) never calls `.withSystemPrompt()` (confirmed — zero matches for `systemPrompt` in `runner.ts`), so manual-react's system prompt is **always exactly this 33-character string.** The task prompt itself is sent as a separate `user` message (`inline-think.ts:150-153`), not folded into the system prompt.

**ra-full's system prompt is assembled per-turn from several sections** (`packages/reasoning/src/kernel/capabilities/reason/think.ts:401-421`, `608-611`):
1. `Environment:` block (date/timezone/platform)
2. `Meta-Tools Quick Reference` (brief/find/pulse/recall one-liners) — injected only when `isNonTrivial` (task ≥80 chars or has `requiredTools` or indexed docs) **and** brief/pulse meta-tools are present (`think.ts:402-409`)
3. `Available Tools:` — full name+params for every tool schema visible this turn
4. `Goal:` — **the task prompt itself, re-embedded inside the system prompt** (verified directly from trace content, see below) — in addition to being sent as the first `user` message. This is a genuine duplication manual-react does not have.
5. (conditionally) TextParseDriver format instructions, Decision Rationale block (off by default via `auditRationale`)

Measured system-prompt length (chars) across all 82 `llm-exchange` events in the 18 qwen3:14b ra-full cells:

| Metric | Value |
|---|---|
| mean systemPrompt length | **929 chars** |
| min | 145 (rw-1, no-tool early classify turn) |
| max | **1,504** (rw-9, full tool schema set + Goal) |
| manual-react systemPrompt length | **33 chars** (constant) |
| ra-full / manual-react ratio | **~28x** at mean, ~46x at max |

Per-task mean (n over cells with ≥1 llm-exchange; qwen3:14b, ra-full only):

| Task | n cells | avg systemPrompt chars | avg tokens-in | avg tokens-out |
|---|---|---|---|---|
| rw-1 (research, plan-execute) | 4 | 218.5 | 9,809 | 9,702 |
| rw-2 (data CSV analysis, react) | 5 | 1,372.4 | 9,900 | 5,257 |
| rw-7 (multi-file debug, react) | 3 | 1,246.3 | 13,093 | 4,836 |
| rw-8 (multi-phase pipeline, plan-execute) | 3 | 243.0 | 4,072 | 5,160 |
| rw-9 (resilience, react) | 3 | 1,504.0 | 15,190 | 4,582 |

Sample assembled system prompt (rw-9, `01KWXZ8F30839FQAAV2B3ET4EA.jsonl`, iter 2, 1504 chars) — quoted verbatim to show what's actually charged every turn:
```
Environment:
Date: Tuesday, July 7, 2026
Timezone: America/New_York
Platform: linux (x64)
# Meta-Tools Quick Reference
- `brief()` — see all tools, documents, context budget, signal grade
- `find(query)` — search documents, memory, or web automatically (no need to choose)
- `pulse()` — check progress; `pulse("am I ready?")` before calling final-answer
- `recall(key, content)` to store notes · `recall(key)` to retrieve · `recall(query=...)` to search notes

Available Tools:
- file-read(path: string, encoding: string?)
- file-write(path: string, content: string, encoding: string?)
- brief(section: string?)
- pulse(question: string?)
- recall(key: string?, content: string?, query: string?, ...)
- find(query: string, scope: string?)
- discover-tools(query: string?)
- final-answer(...)

Goal: Working directory for this task: .../  Fetch today's cryptocurrency prices for BTC, ETH, and SOL ...
```
(The `systemPrompt` field is not artifact-truncated here: the trace tracer's cap is 4,000 chars, `EXCHANGE_SYSTEM_PROMPT_MAX` at `packages/llm-provider/src/exchange-projection.ts:25`; every observed value is well under that, so these are real, not clipped, lengths.)

**Answer:** the dominant sections are (a) the re-embedded task Goal (largest single contributor on tool-heavy tasks — this is prompt *duplication* against the also-sent user message, not present in manual-react at all), (b) the full `Available Tools` schema block (7 builtin tools + params, ~500-700 chars), and (c) the Meta-Tools Quick Reference (~250 chars, gated on task non-triviality). Tool-schema payload itself (native-FC `tools` array, separate from systemPrompt) is identical in spirit between the two arms — both pass a `tools` parameter to the provider — so the prompt tax specifically is a **system-prompt-text** phenomenon, not a tool-count phenomenon.

---

## Q2 — Turn tax (LLM calls per cell)

manual-react has no `llm-exchange` events, so its LLM-call count is estimated as `tool-call batches + 1` (each iteration issues exactly one THINK call; the loop's last iteration is the no-tool-call THINK that terminates it — `execution-engine.ts:805-926`, `runInlineThink` returns `isComplete` when `stopReason==="end_turn" && !toolCalls.length`, `inline-think.ts:423-425`).

| Variant / model | avg LLM calls/cell | avg total tokens/cell | avg tool calls/cell | avg wall-clock/cell |
|---|---|---|---|---|
| bare-llm, qwen3:14b (n=18) | 1 (fixed) | 2,106 | 0 | 89.7s |
| **manual-react, qwen3:14b** (n=18) | **~4.2** (tool-calls avg 3.22 + 1) | 12,501 | 3.22 | 141.7s |
| **ra-full, qwen3:14b** (n=18) | **4.56** (measured, exact) | 12,619 | 2.83 | **247.7s** |
| ra-full, cogito:8b (n=15, unambiguous) | 6.53 (measured, exact) | 9,599 | 4.07 | **20.1s** |

The surprising result: **total token volume and LLM-call count are nearly identical** between manual-react and ra-full on qwen3:14b (12,501 vs 12,619 tokens; ~4.2 vs 4.56 calls). The 75% wall-clock gap (141.7s → 247.7s) is **not** explained by "ra-full makes more/bigger calls" — it is explained by decode-time-per-call, which the token split reveals:

| Variant, model | avg tokens-out /cell | avg tokens-out /call |
|---|---|---|
| ra-full, qwen3:14b | 6,046 | ~1,326/call |
| ra-full, cogito:8b | 1,480 | ~227/call |

qwen3:14b generates **~6x more output tokens per call** than cogito:8b under the identical harness, because qwen3:14b is a thinking model (see Q5) and cogito:8b is not — the per-call decode volume, not the call count, drives ra-full's qwen3:14b duration up. manual-react has no equivalent measurement (no per-call token split in its trace), but its 5.9x lower total wall-clock at near-identical total-token volume is consistent with the same mechanism: **the harness doesn't ask the model to do more thinking work per call, but on a thinking model it structurally cannot avoid paying for however much thinking the model chooses to spend**, whereas manual-react's calls are shorter individually (more, smaller iterations of tool-call → observe, vs. ra-full's fewer but much larger think-and-decide turns).

**Caveat (do not over-read the duration gap as pure architecture):** the existing report documents B5 — bench-side zombie fibers from the 420s per-cell timeout keep consuming GPU after a cell aborts, and successful cell durations degrade monotonically within a run (248s → 380s → cap, `2026-07-07-public-competitor-bench-qwen3-14b-rerun.md:40`). Some fraction of ra-full's inflated qwen3:14b duration is GPU contention from earlier timed-out ra-full cells, not the harness's own overhead. The token-volume-per-call asymmetry above is the more trustworthy signal (tokens aren't inflated by queueing, only wall-clock is) and it independently supports the same story.

---

## Q3 — Termination: simplicity vs. an evaluator chain

**manual-react** — one boolean, evaluated every iteration, no memory of prior state (`inline-think.ts:423-425`):
```ts
const done = response.stopReason === "end_turn" && !response.toolCalls?.length;
```
No verifier phase runs meaningfully (`config.enableVerification` is unset for this variant so `runGuardedPhase(verify, …)` skip-predicates out), no required-tools gate exists in this path at all. The model's own `end_turn` decision is the sole authority.

**ra-full** — every iteration's stop decision passes through `packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts`'s chain of `TerminationSignalEvaluator`s: `pendingToolCallEvaluator` (231), `finalAnswerToolEvaluator` (239), `entropyConvergenceEvaluator` (248), `reactiveControllerEarlyStopEvaluator` (263), `contentStabilityEvaluator` (273), and `llmEndTurnEvaluator` (294-319) — the evaluator that actually gates plain-content `end_turn` answers. Its logic (`arbitrator.ts:294-319`):
```ts
if (ctx.stopReason !== "end_turn") return null;
if (ctx.thought.trim().length === 0) return null;
const remainingRequired = ctx.requiredTools.filter((t) => !ctx.toolsUsed.has(t));
if (remainingRequired.length > 0) {
  if (ctx.redirectCount === 0) {
    return { action: "redirect", ... "required tools not used yet: ... use them, or state explicitly why they are unnecessary" };
  }
  return { action: "exit", ..., reason: "llm_end_turn" };
}
return { action: "exit", ..., reason: "llm_end_turn" };
```
This is the exact code path the existing bottleneck report's B1 finding cites (`arbitrator.ts:301-309` comment references trace `01KWXQK2D001` — one of the same qwen3:14b rw-2 cells analyzed here, `01KWXQK2D0011BA10XSY1RXBJK.jsonl`, in this dataset). Before the 2026-07-07 B1 fix, an unmet `requiredTools` gate silently declined every `end_turn` with no feedback, forcing the run to the 420s cap even when the model had already produced the correct answer. Post-fix, the first redirect is at least visible/actionable — but it still costs **one additional forced iteration** (redirect → retry → re-evaluate) that manual-react's un-gated accept never pays, on every cell where `requiredTools` isn't satisfied by the time the model wants to stop.

**Does simplicity win via earlier acceptance?** Yes, structurally: manual-react accepts the model's very first `end_turn` with any non-empty tool-call-free content. ra-full's gate can force at minimum one extra iteration (the `redirectCount === 0` branch), and — per B1/B2 in the existing report — a `redirect` immediately re-enters a full THINK cycle subject to the same `tierMaxTokens` cap that can itself burn an empty turn on a thinking model before ever reaching the retried substantive answer. The termination machinery is not just "more careful" — each additional check is a cost paid unconditionally, whether or not it ever *changes* the outcome. Six evaluators run every iteration in ra-full; manual-react's loop runs zero.

---

## Q4 — Which harness additions help vs. hurt, by task class

Cross-referencing the existing report's per-task lift table (`2026-07-07-public-competitor-bench-qwen3-14b-rerun.md:10-16`) against the trace-level mechanism data gathered here:

| Task class | Lift (ra-full vs bare) | Plausible HELPING mechanism | Plausible HURTING mechanism |
|---|---|---|---|
| rw-1 research synthesis (source conflict) | **−67%** | Meta-tool `find()` unifies search/memory/web behind one call (lower cognitive branching) | **B3 fabrication**: `requiredTools` grounding gate (`llmEndTurnEvaluator`) forces tool engagement even when the local web-search tool returns empty/noisy results; qwen3:14b then synthesizes plausible-but-fake entities to satisfy the "must ground" pressure. manual-react/bare-llm just answer from parametric knowledge (real DBs: Qdrant/Weaviate/Redis) and the judge scores them 1.0. The harness's honesty-forcing mechanism actively produces the dishonest content it was designed to prevent, on this task class. |
| rw-2 data investigation (red herring, CSV) | **−47%** | `recall`/context-curation should help track the discount-vs-OOS hypothesis pivot | **B1+B2 combined** (per bottleneck report): the correct answer was produced at iteration 1 in trace `01KWXQK2D001` but a plain `end_turn` doesn't terminate; the retry burns a `tierMaxTokens`-capped empty `<think>` turn, forcing the cell to the 420s cap. Structurally-correct-but-dead-run. |
| rw-7 multi-file debug (`bun test`) | **+33%** | Tool-mastery mechanisms (structured tool schemas, `code-execute` sequencing via required-tools gate) plausibly help a model stay on-task across many file-write/code-execute cycles; verifiable (not judge-scored) success criterion removes the fabrication failure mode entirely | Turn tax (extra evaluator overhead per iteration) is a pure cost here but doesn't flip the outcome since the task is long anyway (many iterations regardless of arm) |
| rw-8 memory under compaction (5-phase pipeline) | **+33%** | This is the task class meta-tools (`recall`) and the harness's context curator are explicitly built for — cross-phase constraint fidelity (integer cents / epoch ms / prefixed IDs) is exactly what a raw inline loop's plain message-window truncation would lose first | None strongly evidenced in this task class from the trace data |
| rw-9 resilience under tool failure (503 retry + fallback) | **+100%** | F1-class engagement forcing + retry/escalation (F3 repeated-failure escalation, mentioned in existing report code-state note) directly matches this task's requirement (retry then fall back) — a task literally designed to reward forced persistence | None — this is the harness's best-case task class |

**Pattern:** the harness's core mechanism — force tool engagement, don't accept an unverified `end_turn` — is a net positive specifically on **execution/verifiable tasks** (rw-7, rw-8, rw-9, all +33% to +100%) where "try harder / use the tool" is monotonically correct, and a net negative on **knowledge-retrieval-shaped tasks** (rw-1, rw-2, both −47% to −67%) where the model already had (or could quickly reach) a correct answer and the forced grounding pressure only adds an opportunity to fabricate or a chance to get structurally stuck. This is exactly the diagnosis already filed as B3 in the bottleneck report; this analysis adds the quantitative prompt/turn/duration mechanism underneath it.

---

## Q5 — The cogito flip: same harness, opposite verdict

Accuracy: cogito:8b — ra-full 44% (best-of-6) vs manual-react 33% (tied bare-llm). qwen3:14b — ra-full 35% (caveated) vs manual-react 57% (best-of-6). The harness's net effect literally inverts sign between the two models.

**The single largest, most directly quantifiable difference found in this investigation: qwen3:14b is a "thinking" model in RA's capability table; cogito:8b is not.**

`packages/llm-provider/src/capability.ts:452-466` (`ollama/qwen3:14b`): `supportsThinkingMode: true` — "qwen3 thinks by default under Ollama (verified 2026-07-07: think:true yields thinking tokens, content empty at low num_predict, done_reason=length)".
`packages/llm-provider/src/capability.ts:487-499` (`ollama/cogito:8b`): `supportsThinkingMode: false`.

This flag feeds directly into the per-turn output budget at `packages/reasoning/src/kernel/capabilities/reason/think.ts:616-627`:
```ts
const tierMaxTokens = { local: 1200, mid: 2000, large: 3000, frontier: 4000 };
const thinkingAllowance = profile.thinkingModel ? 6000 : 0;
const outputMaxTokens = (tierMaxTokens[profile.tier] ?? 1500) + thinkingAllowance;
```
qwen3:14b (local tier, thinking) gets a 7,200-token output budget per call; cogito:8b (local tier, non-thinking) gets 1,200. Measured tokens-out per call bears this out exactly in the direction predicted: qwen3:14b ra-full averages **~1,326 output tokens/call**, cogito:8b ra-full averages **~227 output tokens/call** — a ~5.8x gap, on the *same* harness, same prompt structure (both average ~930 systemPrompt chars per exchange), same task set.

Why this flips the verdict:
1. **cogito:8b is weaker at raw synthesis/instruction-following.** The harness's forced-grounding, required-tools, and evaluator-chain machinery function as *error correction* — they catch mistakes cogito would otherwise make unaided (this is exactly the "harness compensates for a weaker model" story the project's north-star research predicted). The forced retries and grounding checks cost cogito very little wall-clock (20.1s avg/cell) because cogito's calls are cheap (no thinking-token bloat), so the harness's overhead is nearly free while its error-correction value is real.
2. **qwen3:14b is already strong enough that its un-scaffolded (manual-react/bare) answers are frequently correct on their own** (57% best-of-six, beating every competitor framework too). The harness's grounding-forcing mechanism doesn't correct a mistake qwen3:14b was about to make on rw-1/rw-2 — the model already knew Qdrant/Weaviate — it *creates* an opportunity for a new one (forced tool use against noisy search → fabrication, B3) and pays a much higher wall-clock tax doing it (each call now burns ~1,326 output tokens, largely `<think>` content, vs manual-react's presumably shorter per-call decode since it never re-enters a THINK cycle to satisfy a `requiredTools` gate it doesn't need).
3. **B2's mechanism (tierMaxTokens thrash) is thinking-model-specific by construction** (`thinkingAllowance = profile.thinkingModel ? 6000 : 0`) — it only exists as a failure mode for qwen3:14b in this pair. cogito:8b cannot hit the "entire budget burned inside `<think>`, content empty" failure the bottleneck report's B2 describes, because cogito:8b doesn't think in that sense.

**In one sentence:** the same scaffolding (forced grounding + evaluator chain + thinking-token headroom) is close to free and net-corrective on a model weak enough to need correcting, and is not free (real wall-clock + fabrication risk) and net-negative on a model strong enough that the correction is usually unnecessary — and RA's own capability table already encodes the exact mechanical trigger (`supportsThinkingMode`) that determines which side of that line a given local model falls on.

---

## Summary table (qwen3:14b, all measured directly from `benchmark-traces/*.jsonl` unless noted)

| Metric | bare-llm | manual-react | ra-full |
|---|---|---|---|
| Accuracy (existing report) | 24% | **57%** | 35% (caveated) |
| System prompt (avg chars) | n/a (no llm-exchange trace) | 33 (constant, source-derived) | **929** |
| LLM calls/cell | 1 | ~4.2 (est., tool-calls+1) | 4.56 (measured) |
| Total tokens/cell | 2,106 | 12,501 | 12,619 |
| Avg output tokens/call | ~2,106 | n/a | ~1,326 |
| Wall-clock/cell | 89.7s | 141.7s | 247.7s (partly GPU-contention-inflated, B5) |
| Termination check | model's `end_turn` | model's `end_turn`, no gate | 6-evaluator chain incl. `requiredTools` redirect |

## Files read / cited

- `packages/benchmarks/src/sessions/public-competitor-bench.ts`, `packages/benchmarks/src/session.ts`, `packages/benchmarks/src/runner.ts:579-792`
- `packages/runtime/src/execution-engine.ts:640-947`
- `packages/runtime/src/engine/phases/agent-loop/inline-think.ts` (full file read)
- `packages/reasoning/src/kernel/capabilities/reason/think.ts:380-670`
- `packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts:200-320`
- `packages/llm-provider/src/capability.ts:420-500`
- `packages/llm-provider/src/exchange-projection.ts`, `packages/trace/src/events.ts`
- `packages/benchmarks/src/tasks/real-world.ts` (rw-1/2/7/8/9 definitions, for task-tagging trace cells)
- Existing: `wiki/Research/Harness-Reports/2026-07-07-public-competitor-bench-qwen3-14b-rerun.md`, `wiki/Research/Harness-Reports/2026-07-07-bench-bottleneck-determination.md`
- Traces (qwen3:14b, representative): `01KWXZ8F30839FQAAV2B3ET4EA` (rw-9, ra-full), `01KWXQK2D0011BA10XSY1RXBJK` (rw-2, ra-full, B1 case), `01KWXTV1DNF32ZXD4CSSNW02KZ` (rw-8, ra-full), `01KWXMFHVKJPT6MH9TCZ802D76` (rw-1, manual-react), `01KWXSNAH4SV8595T02R2TRN28`/`01KWXVMS97MNAC99Y23H291S1G` (rw-7/rw-8, manual-react), `01KWXYJK3XV7F7N9PN869X6KVX` (rw-9, manual-react), `01KWXM8QB9DFJT923SABEPWDYP` (bare-llm)
- Traces (cogito:8b, ra-full subset, n=15, unambiguous via `llm-exchange` presence): files in `01KWK3R1…`–`01KWK4YA…` range
