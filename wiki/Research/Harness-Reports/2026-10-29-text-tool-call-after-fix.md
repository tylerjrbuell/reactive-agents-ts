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

## After-after (kernel gap 1+2 in c649605c5, F3 revised in e397b8dca)

Rebuilt before running: `packages/reasoning` (dist 13:23:54 predated c649605c5 at 13:24:32) and `packages/runtime` (dist 13:29:01 predated e397b8dca at 13:30:55). `tools` dist (13:11) was current. Cortex dev server untouched. Artifacts: `2026-10-29-text-tool-call-after-after-{runs.jsonl,healing-matrix.txt,shape-fp.txt,required-tools-trace.jsonl}`. Models: llama3.2:3b, qwen3:4b, Nemotron-3.5-Bolt-E4B.

### Per cell

| cell | n | shaped finals | tools-withheld call before termination | terminal labels | iters / tokens | native |
|---|---|---|---|---|---|---|
| llama fresh, 12x15 | 5 | **0** (360/180 answers; one `The answer is 180.`) | 5/5 (noToolCalls=1) | end_turn x5 | 5 iters, 3 LLM calls, ~780-800 tok (was 1 call, ~300 tok, shaped 5/5) | 0/5 |
| llama fresh, hash map | 5 | **0** (prose answers) | 5/5 | end_turn x5 | 5 iters, ~820-910 tok (was shaped 5/5) | 0/5 |
| llama fresh, JSON name+age | 5 | 0 true shaped. Probe regex flags 4/5 but outputs are `{"name":"Evelyn Thompson","age":32}`, i.e. legit JSON answers (FP of the probe regex, not the F1 detector) | 5/5 | end_turn x3, `abstained` x2 | 5-8 iters, 0.8-2.2k tok | 2/5 ran native web-search first |
| llama text-hist (pong after shaped turn) | 10 | **0/10** (was 8/10) | n/a, no shaped reply emitted | end_turn x10 | 1 call, 278 tok each | 0 |
| llama required-tools, 12x15 | 5 | **5/5 STILL shaped** | 5/5 (noToolCalls=1) | max_iterations x5 (honest label never reached) | 8 iters, 8 calls, ~1.87k tok | model calls web-search natively at iter 1-4 |
| qwen3:4b 12x15 / code | 5+5 | 0 / 0 | n/a | end_turn | 1 call, 410-750 tok (code 1/5 detours via 1 native call) | 0 |
| qwen3:4b Tokyo | 5 | 0 | n/a | end_turn | 2 calls, 1.3-1.5k tok | 5/5 native (unchanged) |
| qwen3:4b JSON name+age | 5 | 0 (legit JSON passes, regex FP 5/5) | n/a | end_turn | 1 call, 410-510 tok | 0 |
| Nemotron 12x15 / Tokyo / JSON | 5 each | 0 / 0 / 0 (JSON legit) | n/a | end_turn | 340-360 / 1.0-1.2k / 320-350 tok | Tokyo 4/5 native (1 run no native but finished) |

Healing matrix: 0 LEAK rows (unchanged, resolver clean). Detector FP check: same as before (legit JSON, fenced JSON, prose, code, `foo(bar)`, config JSON: not shaped; literal call text and hallucinated-name JSON: shaped).

Net: gap 1 closed. Fast-path shaped finals 12x15 / hash map / text-hist all go to 0 (n=5/5/10), tools-withheld retry now fires live (5/5 in each llama fresh cell), recovery to a real answer in all 15 trivial-prompt runs. Cost: ~+500 tokens and +2 LLM calls per trivial llama run (800 vs 300). No regression or leak on qwen3:4b / Nemotron; legit JSON answers and native Tokyo calls pass through. Terminal labels `tool_call_unresolved` was never seen (never needed on the recovered cells); `abstained` seen twice (JSON-ask cells), though the outputs there were ordinary answers (`John Doe is a 32-year-old...`, `{"name":"Alex","age":30}`), so the `abstained` label on a delivered answer is odd and worth a look by kernel-warden.

### Criterion: NOT fully met

Required-tools arm (fast path off): 5/5 still end with the shaped thought plus leaked internal hint text, `terminatedBy=max_iterations`, `ok:true` (!). Success criterion was zero shaped finals; this cell fails it. Gap 1 is closed; gap 2 is only partly closed (strikes survive, withheld call fires, but no honest terminal).

### Remaining delivery site (one traced run, n=1; 5/5 outcome replicated)

Trace `...-after-after-required-tools-trace.jsonl`: iter 1 strike 1, iter 2 strike 2, iter 3 tools-withheld call (fires), then the model's next replies (iter 4-5) are NATIVE web-search calls, which break the "consecutive unresolved" count (`countConsecutiveUnresolved` in `capabilities/reason/unresolved-tool-call.ts:~59` counts tagged thoughts trailing the step list). Repeated identical tool call -> loop pattern a -> strategy switch reactive -> plan-execute-reflect (iter 6). Strike 1 recurs at iter 7, iteration cap (8) is reached with strike < 3. `guard terminal_decision outcome=terminate reason=done` with `terminatedBy:null`, then:

- **`packages/reasoning/src/kernel/loop/runner-post-loop-deliverable.ts:205-217` (the "last thought" fallback, `state.status==="done" && !state.output`)**: takes `[...state.steps].filter(thought).pop()` with NO check of `metadata.frameworkInstrumentation === UNRESOLVED_TOOL_CALL_TAG`, and commits it via `modelSynthesisDeliverable`. This is the site that delivered `{"name":"mathMultiply",...}\n\nTool call used unavailable name(s)...` (the content already carries the resolver hint). Of the kernel-warden's listed suspects, this one (not :206 in react-kernel / deliverable.ts:91) is the live one; `run-pass.ts:81-97` `resolvePassOutput` is a second, identical fallback (last thought, only filters continuation intent) that would deliver the same text if `state.output` were empty, and should get the same filter.
- The `verifier-verdict` in the trace says `agent-took-action` FAILED ("shipped output without calling any required data tool"), yet the run is reported `success`/`ok:true`. Verifier rejection did not stop delivery (secondary finding; a required-tools run that never satisfied web-search should not be `ok`). Note the web-search WAS invoked natively (toolsUsed), so the verifier check may itself be wrong (the call failed on `12 x 15` / hallucinated args); needs kernel-warden eyes.

### Ranked remaining fixes (one per cycle, kernel-warden)

1. `runner-post-loop-deliverable.ts:205`: skip thoughts tagged `UNRESOLVED_TOOL_CALL_TAG` in the last-thought fallback (and the identical one in `run-pass.ts:resolvePassOutput`); if the only candidate thoughts are tagged, terminate with `tool_call_unresolved` + `UNRESOLVED_DELIVERABLE`. Pin: runner test, scripted model emits 2 shaped replies then hits maxIterations with no output; assert output is the honest sentinel and no `Tool call used unavailable` text. Cut the filter -> red.
2. `unresolved-tool-call.ts` strike accounting: count "consecutive" as strikes since last NON-tagged *thought* that had a real answer rather than interrupted by a native tool call, or at minimum do not reset on a native call to a failing tool; otherwise a model that alternates shaped text and bad native calls never reaches strike 3 before the iteration cap.
3. Verifier/success: required-tools run that failed `agent-took-action` should not report `ok:true` (check whether the verdict or the run-level success mapping is wrong).
4. `abstained` terminal label attached to runs that deliver an ordinary answer (JSON-ask cells, 2/5 llama): check label correctness.
5. Token tax (+~500 tok / +2 calls on trivial llama prompts, tools-withheld retry then a clean answer): acceptable vs shaped finals, but the real fix for "hello -> web-search" is tool-surface pruning (ablation-warden), not harness.

### Caveats

Bernoulli, n=5 (n=10 text-hist): effects here are 0 vs 5/5 and 8/10 vs 0/10, far beyond noise, but the exact tokens/iteration figures are small-sample. Only llama3.2:3b reproduces the defect; qwen3:4b and Nemotron are non-regression sanity only. Hello (prompt 0) and Tokyo/code on llama were not re-run in this pass (not in the brief); the earlier 1/5 shaped Tokyo and code-block cases are unverified after the fix. The root-cause trace is one run. Probe SHAPE regex over-counts legit name+age JSON.
