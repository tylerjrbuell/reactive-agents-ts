---
type: harness-report
status: complete
created: 2026-10-29
tags: [harness-report, tool-calling, verification, before-after]
warden: harness-warden
---

# Text tool-call fixes F1-F5: after-fix verification (2026-10-29)

Baseline: [[2026-10-29-text-tool-call-root-cause]]. Verdict: **F1/F5 verified at the resolver; F2/F3 do NOT deliver the user-visible outcome. Shaped final output is still produced in the default (no-required-tools) path.** Success criterion (zero shaped final outputs) is NOT met. Verdict for the fix set as shipped: PARTIAL / REWORK of the integration, not of F1/F5.

## Build freshness

`reasoning`, `tools`, `runtime` dists were rebuilt (`bun run build` in each) at 13:08-13:09. reasoning dist had been built before the F2 commit finished (1060944 B vs 1061228 B after rebuild); runtime dist unchanged size; tools rebuilt. `require.resolve` from `apps/cortex` -> `packages/{reasoning,tools}/dist/index.js`. All results below are post-rebuild.

## Before / after (llama3.2:3b, fresh Cortex-config agent, n=5 per cell; "shaped" = final output is a tool-call JSON)

| prompt | before shaped | after shaped | after native-call runs | after notes |
|---|---|---|---|---|
| "Say hello in one word." | 3/5 | **0/5** | 5/5 | web-search called anyway; 4-6 tool calls, 2.8-3.6k tokens, 11-15 iterations; 1/5 hit max_iterations with an honest "could not complete" message. Tokens up from ~300 (shaped run) to ~3k. |
| "Reply with exactly the word pong" | 0/5 | 0/5 | 0/5 | 1 LLM call, 278 tokens |
| "What is 12 x 15?..." | 5/5 | **5/5** | 1/5 | 4/5 end after exactly 1 LLM call, `end_turn`, shaped output; no reprompt, no withheld-tools call |
| "Explain hash map" (new) | n/a | 5/5 | 0/5 | same, 1 call |
| Tokyo web-search prompt | 0 shaped (5/5 native) | 1/5 | 4/5 | 1 shaped on iteration 1 (`parameters{` garbled) |
| "JSON with name, age" (legit-JSON ask) | n/a | 5/5 hallucinated `{"name":"person","parameters":...}` | 0 | model confuses; this is a call-shaped reply, not a legit answer |
| "code block add fn" | n/a | 3/5 shaped | 0 | 2/5 recovered to a code block (llmCalls=2, one no-tools call) |
| "return this literal JSON ..." | n/a | 3/5 | 5/5 native | ambiguous prompt; 2/5 clean answer |

text-hist arm ("pong" after a prior shaped assistant turn): before 7/15 (+1/5 earlier); after **8/10** shaped. clean-hist: 0/10. Replay healing is live (request shows `Assistant: [Previous reply was an unexecuted tool-call attempt and was omitted.]`), but an additional arm with neutral `(no response)` gives the same 8/10, so the placeholder text is not the cause: after any non-answer prior turn the 3B model emits a text call, and the fast path then publishes it. F3 prevents persistence of new contamination (not measured live here; unit-level only) but cannot alone move this rate.

Other models (n=5 per cell): qwen3:4b and Nemotron-3.5-Bolt-E4B: 0/5 shaped on hello-class (12x15), 5/5 native on Tokyo, 0/5 shaped on code-block. The 5/5 on "JSON name+age" is a **legit JSON answer** (`{"name":"Liam Carter","age":28}`); the probe's coarse regex flags it, the F1 detector does not (see FP check). No regression on these models; no information gain either (they never leaked).

Tools-withheld retry fired: 0 times in all default-path cells (only no-tools calls observed were synthesis-type: code-block cells, 2/5 recoveries and Tokyo/literal-JSON synthesis). Iterations bounded: yes (max 15). Native-call rate and recovery: recovery from a shaped first reply in the default path = 0/17 llama cells where first reply was shaped (they terminate on it).

## Healing matrix diff (resolver, `NativeFCStrategy.resolveWithDialect`)

Artifact: `2026-10-29-text-tool-call-after-fix-healing-matrix.txt`. Baseline LEAK rows now:

| shape | before | after |
|---|---|---|
| JSON after prose, JSON array, 2 unfenced objects, `<function=>` XML, `[TOOL_CALLS]`, `<\|python_tag\|>`, bare `web-search(query="x")`, OpenAI function shape, `{"tool_calls":[...]}`, truncated JSON, trailing comma, single quotes | LEAK | HEALED to real calls |
| `<tool_call>{json}</tool_call>` | REPROMPT | HEALED |
| hallucinated name JSON, name with spaces, garbled `parameters{`, bare `web_search("x")` | LEAK | REPROMPT (`thinking`, reason unresolved-tool-call) |
| native alias param `q` for `query` | not healed | **still not healed at resolver** (`web-search({"q":"x"})`); downstream remap only |
| native `maxResults:"5"` | passed through | still passed through (downstream coerceTypes) |

Still-leaking shapes at the resolver: none. Resolver-level is clean. `121` tools/tool-calling + guard tests pass.

## Remaining gap 1 (the caveat, confirmed): fast path ends on first shaped reply

Evidence: llama cells 12x15 / hash map: `llmCalls=1, iters=1, terminatedBy=end_turn`, output `{"name":"math-product",...}`. Cause: `packages/reasoning/src/kernel/capabilities/reason/dispatch-think-response.ts:278-285`, the `FAST-PATH: trivial task exit` block (`!hasRequiredTools && ... stopReason==="end_turn"`), runs BEFORE the resolver at `:312`. It arbitrates `fast-path-completed` with `output = thought.trim()`, so F1/F2 never see the reply. Not tested by any guard test (the F2 tests use required tools or scripted resolver paths).

## Remaining gap 2 (found via required-tools arm, `required-tools-arm.ts`, n=5 llama 12x15): F2 never terminates live

With requiredTools set (fast path off), 5/5 runs still end shaped (`end_turn`, 5 LLM calls, 0 no-tools calls, `harness_synthesis`). Trace (`...-required-tools-trace.jsonl`): strikes fire 1, 2 (iters 1, 2), then the consecutive-thoughts loop detector (pattern c) fires, triggers `strategy-switched reactive -> plan-execute-reflect` (state reset: steps 5 -> 2), strike counter restarts at 1, tools never withheld, and `loop_resolution` delivers the trailing shaped thought as `model_synthesis`/`harness_synthesis` output (`guard-fired loop_resolution`, output includes the resolver hint text appended). So three interacting defects: (a) loop detector counts unresolved-tagged thoughts toward consecutive-thoughts (`kernel/capabilities/reflect/loop-detector.ts:96` pattern C) and preempts strike 3; (b) strategy switch discards strike history; (c) loop-resolution delivers a shaped thought (`kernel/loop/runner-helpers/loop-resolution.ts:248-258`, `kernel/loop/iterate-pass.ts:~1081`). Output also leaks the internal hint ("Tool call used unavailable name(s)...") to the user.

## False positives

`shape-fp-check.ts` (detector only): `{"result": 180}`, `{"name":"Alice","age":30}`, fenced JSON, prose, python code block, `print(add(1,2))`, `foo(bar)`, config JSON with `name`/`version`, prose with `{x}` -> all NOT shaped. Shaped: `{"name":"search","parameters":{...}}` (literal-call text, indistinguishable from a call by design) and hallucinated-name JSON. Live: qwen3:4b/Nemotron legit JSON ask 5/5 delivered as normal final answers. Residual FP: a user who asks for call-shaped JSON verbatim (name+parameters/arguments keys) is treated as a tool attempt; acceptable, document it.

## Ranked remaining-fix specs (one per cycle; dispatch kernel-warden)

1. **kernel-warden, `dispatch-think-response.ts:278`**: add `&& !isShapedUnresolved(thought)` to the fast-path condition (use `detectToolCallShape(thought, availableToolNames).shaped` from `@reactive-agents/tools`, reasoning already depends on it), so shaped replies fall through to the resolver/guard. Alternative single-boundary variant: run the resolver first. Pin: runner test with scripted model returning a hallucinated call first with NO required tools; assert not `llm_end_turn`/`end_turn` on the shaped text. Cut the condition -> red. Expected live effect: llama cells 12x15, hash map, JSON ask move from 1-call shaped output to reprompt -> (needs fix 2) honest outcome.
2. **kernel-warden, loop/strike interaction**: (a) in loop-detector pattern C, skip thoughts tagged `UNRESOLVED_STEP_META` or raise their allowance so strike 3 (honest terminate) precedes it; (b) persist strike count across strategy switch (carry in `state.meta` / ledger instead of deriving from `steps`); (c) in `loop-resolution.ts` exclude tagged unresolved thoughts from "trailing thought" delivery and strip hint text; if only shaped thoughts exist, terminate `tool_call_unresolved`. Pin: the existing guard test plus a case where the loop detector would fire at the same iteration.
3. **runtime-warden (low)**: no change required for F3; but note history hygiene alone cannot lift the text-hist rate (8/10 vs neutral marker 8/10). Not a fix target.
4. **tools-warden (low)**: resolver-level alias `q`->`query` not healed (works only via downstream single-missing remap); no live defect observed.
5. Model-intrinsic: llama3.2:3b calls web-search for "hello" (5/5 native) at 3k tokens. Not harness-fixable cheaply; candidate for `requiresTools`-style tool-surface pruning via ablation-warden (do not conflate with this defect).

After fixes 1+2, re-run: `probe.ts llama3.2:3b fresh 5 2,3,5`, `probe.ts llama3.2:3b text-hist 10 1`, `required-tools-arm.ts llama3.2:3b 5 0`; success = zero shaped finals, tools-withheld call observed (noToolCalls>=1) before honest termination.

## Caveats

Bernoulli cells, n=5 (n=10 for history arms): large effects only (12x15 5/5 unchanged; hello 3/5 -> 0/5 is suggestive, within noise at n=5 but mechanism-consistent). Single-tier trigger evidence (llama3.2:3b); qwen3:4b and Nemotron never leak so they cannot validate F1-F3 live. Larger tiers and frontier not probed. The probe `SHAPE` regex over-counts legit JSON (name+age) and under-counts nothing known; "shaped" for llama prompt 5/6/7 should be read with the FP section. Token overhead compared only qualitatively (baseline shaped runs ~300 tokens; native-call route ~3k). The Cortex dev server was not touched. `required-tools-arm.ts` single trace (n=1) was used for the strike/loop-detector diagnosis; 5/5 outcome replicated, the mechanism trace is one run.
