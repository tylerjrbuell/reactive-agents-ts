---
type: design-spec
status: proposed
created: 2026-11-03
tags: [kernel, tool-calling, extraction, deliverable, h3]
owner: kernel-warden (boundary + consumers), tools-warden (parser), runtime-warden (knob), harness-warden (trace + H3)
---
# Canonical tool-call extraction: one boundary, one parser, one deliverable view

## Problem
H3 baseline (bf8f6333) finding 1: cogito:8b ends runs with a printed tool call in `run-completed.output`. The traces show three different defects. There are also two duplicate parser stacks.

## Root cause (evidence)
Traces are under packages/benchmarks/benchmark-traces/h3/cogito_8b/ra-default/.

RC-1: deliverable leak (this is the visible symptom).
- normalize-think-response.ts:281 records the thought step with the raw text.
- Extraction runs later, at dispatch-think-response.ts:314-423, and never annotates that step.
- assembleOutput Rule 2 (output-assembly.ts:94-126) prepends a code block from an earlier thought when the final answer is 200 chars or less and has no code.
- chooseFallbackThought (unresolved-tool-call.ts:200) and lastDeliverableThought (unresolved-steps.ts:85) exclude only UNRESOLVED-tagged thoughts.
- Evidence:
  - required-tools run0 (01M6HVWT4P8VPVTHH0CY0XW0BD): seq1177 text call, seq1187 call executed, seq1250 clean final, seq1284 output = code block + final.
  - exact-value run0 seq1566; required-tools run3 seq2902.
  - exact-value run2 seq1383 (harness_synthesis) and run3 seq3255 (dispatcher_early_stop) deliver the consumed-call thought.
  - 14/60 cogito outputs have a printed call; 0/60 qwen3:4b outputs do.

RC-2: argument corruption for the `name({ k: "v" })` form.
- Tier order in native-fc-strategy.ts: pseudo-code (:394) runs before the F5 bareCall (text-dialect-parsers.ts:177, lenient).
- pseudo-args.ts:33/98 keeps the literal as an `input` string.
- param-structure-healer.ts:100 remaps it to `path`; path-resolver.ts:43 joins it to the working root, so the read hits ENOENT.
- 20 of 32 failed cogito tool calls have this shape.
- The healer turns a parse failure into a plausible-looking call.

RC-3: forms nothing parses.
- camelCase `fileRead(...)`: name-resolution.ts:3 tokenizer, and the pseudo regex is built from exact names (native-fc-strategy.ts:405).
- Shell-fence `file-read path=".."`, `file-read /abs`, `--path`.
- Runs affected: exact-value run4 (4 turns, 0 calls, abstained), rw-2 runs 0-2.

RC-4: structure.
- Two text-parse stacks: TextParseDriver.extractCalls (text-parse-driver.ts:48) and the NativeFCStrategy text tiers.
- Two copies of the cascade inside NativeFCStrategy (:58-114 and :199-268).
- Two argument grammars for `name(args)` (pseudo-args vs parseLenient).
- Shape detection is a separate pass (tool-call-shape.ts:58).
- Text-parse-driver models get no extraction unless REACTIVE_AGENTS_TEXT_PARSE=act (text-parse-mode.ts:38; dispatch :115-253).
- Unresolved replies use a "twin" content-prefix match (unresolved-steps.ts:33,71).

Not a cause:
- Routing. cogito:8b has toolCallDialect native-fc (calibrations/cogito-8b.json, runsAveraged 5), so it gets NativeFCDriver + NativeFCStrategy.
- required-tools 0/5. These are made-up means (true 21.83); the extraction fix does not touch it.
- rw-6. Mostly invented file content, not calls.

## Inventory
| # | Mechanism | Where | Runs when |
|---|---|---|---|
| 1 | Provider native tool_calls + adapter `parseToolCalls` hook | llm-provider adapter.ts:88; local.ts:340; openai/anthropic/gemini | every provider response |
| 2 | NativeFCStrategy.extractWithDialect: native, then fenced/bare JSON, nameless-shape, pseudo-code, marker, F5 dialects | tools/tool-calling/native-fc-strategy.ts:36-119, text-dialect-parsers.ts:200 | native driver; dispatch:314-351; resolver injected at runner.ts:189 only when supportsToolCalling |
| 3 | NativeFCStrategy.extract: second copy of the cascade + shape check | native-fc-strategy.ts:121-283 | resolve(); base case of #2 |
| 4 | detectToolCallShape / isToolCallShaped | tool-call-shape.ts:58; unresolved-tool-call.ts:49; dispatch:284 fast-path veto | every turn |
| 5 | F2 strike guard, UNRESOLVED tag + twin, fallback chooser | unresolved-tool-call.ts; reflect/unresolved-steps.ts | shaped-unresolved turns; every fallback delivery |
| 6 | TextParseDriver.extractCalls tiers 1-3 | tools/drivers/text-parse-driver.ts:48-176 | supportsToolCalling===false (select-driver.ts:55) AND env act/shadow (default off) |
| 7 | act.ts re-extraction from meta.lastThought | act.ts:227-261 | text-parse driver |
| 8 | HealingPipeline (ToolName, unwrap, ParamName, single-missing remap, PathResolver, TypeCoercer) | tools/healing/healing-pipeline.ts:19; act.ts:199-224; tool-observe.ts:410; judgment-healing.ts | every executed call, both sources |
| 9 | Meta-tool arg healing | act/meta-tool-arg-healing.ts | meta tools |
| 10 | rescueFromThinking | kernel/utils/stream-parser.ts:220; normalize:227 | content under 50 chars, thinking over 100 chars |
| 11 | ReAct ACTION/Observation strip | normalize-think-response.ts:287-295 | legacy text |
| 12 | Act-time gate + policy choke point | gateNativeToolCallsForRequiredTools (dispatch:376, mirrored :169); act.ts / tool-execution.ts | every call batch |
| 13 | Terminal checks | verifier output-is-model-authored (verifier.ts:352-369); assembleOutput Rule 2 (output-assembly.ts:94) | terminal |

## Design
D1. One parser (tools-warden): `parseAssistantToolCalls(content, surface): TextCallParse`.
- Result: `{_tag:"parsed", calls: ExtractedToolCall[]} | {_tag:"unparseable", names, reason} | {_tag:"none"}`.
- Tiers, ordered by fidelity: taught markup (`<tool_use>`, legacy `<tool_call>`, bare `tool:` lines), dialect markers, JSON objects/arrays (lenient), call form `name(args)`, CLI form in shell fences (schema-anchored: tokens must match declared params, or a single positional to the sole required param).
- ONE argument grammar `parseCallArgs`: JSON, then lenient JSON including unquoted identifier keys, then key/value pairs, then a positional value only when the schema has exactly one required param.
- A non-literal expression value (e.g. `roundedMean.toString()`) makes the call `unparseable`. It is never wrapped into a string.
- Names resolve only against this turn's callable surface. Add camelCase splitting to `resolveToolName`, and use one resolver for both the parser and ToolNameHealer.
- Every call carries `{source:"native"|"text", dialect, tier, argParse, span:{start,end}, form:"standalone"|"embedded"}`.
- Replaces items #3, #6 and the pseudo/bareCall split. #4 becomes the `unparseable` branch of the same parse.

D2. One kernel boundary (kernel-warden): new module `kernel/capabilities/reason/assistant-turn.ts`.
- `resolveAssistantTurn({nativeCalls, content, surface, driverMode}) -> AssistantTurn`.
- Called once per turn in normalize-think-response, BEFORE the thought step is created, so the step is born annotated.
- Streaming and complete responses both converge on accumulatedContent/accumulatedToolCalls before normalize, so one call site covers both (pinned).
- Native calls win; text is parsed only when zero native calls resolve. This is today's semantics.
- dispatch-think-response consumes `turn.calls`. The in-dispatch resolver call and the env-gated text-parse block are deleted, so this ceiling-pinned (800 LOC) file shrinks.
- The rest of the path is unchanged: gateNativeToolCallsForRequiredTools, then act.ts HealingPipeline, then the policy choke point. No second executor.

D3. Typed deliverable view.
- Step metadata `assistantTurn: {disposition:"prose"|"calls"|"mixed"|"unresolved", consumedSpans, callIds, deliverableText}`.
- One accessor `deliverableTextOf(step)` is read by assembleOutput, chooseFallbackThought, lastDeliverableThought, deliverable.ts evidence containment and loop-resolution.
- `step.content` stays raw, because steps are the system-observation record.
- `disposition:"unresolved"` replaces the twin-prefix hack.
- This also covers K3's "exclude shaped thoughts from trailing delivery".

D4. Healing safety.
- The healer gets typed args or nothing. Unparseable calls never reach act; they go to the existing F2 strike/reprompt path with a hint naming the tool and its params.
- Pin: a text-sourced literal can never be remapped into `path`.

D5. Trace events (harness-warden owns the packages/trace schema; coordinate with the in-flight edit).
- `tool-call-extracted {iter, source, dialect, tier, argParse, form, name, healed: HealingAction[], executed, gatedBy?}`
- `tool-call-unparseable {iter, names, reason, tier}`

D6. Config knob (runtime-warden).
- Typed `.withHarness({ textToolCalls: "off" | "extract" })`, default `"extract"`. This is today's de facto native-path behavior.
- `"off"` is the ablation arm.
- It retires `REACTIVE_AGENTS_TEXT_PARSE` after P3 is measured.

D7. False-positive controls.
- (a) Parse the assistant's own content only. Never tool results or retrieved text; the signature takes an AssistantTurn.
- (b) Names must be on the callable surface.
- (c) An `embedded` form (inside an expression or assignment) executes only for tools with `riskLevel: "low"` (tools/src/types.ts:172). For other tools an embedded form is `unresolved` (reprompt), never executed.
- (d) If the deliverable contract expects a code artifact, the consumed-span view still keeps code blocks that were not consumed, so a legitimate code answer is never stripped.
- (e) Policy, approval and forbidden-tools gates run unchanged.

## Deletion list
- NativeFCStrategy.extract text cascade duplicate (:199-268).
- extractPseudoCodeToolCalls + parsePseudoArgs positional-literal path (merged into parseCallArgs).
- TextParseDriver.extractCalls tiers (taught grammar moves into D1 tier 1; buildPromptInstructions stays).
- detectToolCallShape as a separate pass.
- dispatch:115-253 env text-parse block.
- act.ts:227-261 lastThought re-extraction.
- text-parse-mode.ts flag reader (after P3).
- Twin-prefix matching in unresolved-steps.ts.

## Phasing
- P1: D2 + D3 + D5. Parser behavior unchanged; fixes RC-1. Correctness gate: no regression, tokens within 15%.
- P2: D1 + D4. Fixes RC-2 and RC-3. This is the new mechanism and goes under the lift rule.
- P3: text-parse driver default to extract, env retired. Separate ablation.
- Serialize with Plan 8 K1/K2/K3 (iterate-pass/runner).

## Verification
- Pins (red-on-cut; each shown red under a temporary mutation, then reverted):
  - Parser corpus built from the real cogito texts (object literal, camelCase, CLI fence, fenced JSON, embedded assignment), plus negatives: a JSON answer `{"result":180}`, a code-answer fence, prose naming a tool.
  - seam-assistant-turn: (a) a native-text turn's step carries assistantTurn; (b) a scripted replay of required-tools run0 outputs the final sentence with no code block (cut deliverableTextOf, red); (c) the object literal parses to `{path, encoding}`; (d) an embedded effectful call is not executed; (e) stream/complete parity gives an identical AssistantTurn; (f) existing F2/strike tests stay green unmodified.
- Replay corpus: run the new parser offline over all 120 H3 traces' llm-exchange contents and diff against recorded tool-call-end args.
  - Expect the 20 OBJLIT failures to become 0 malformed.
  - Hand-audit every turn where the new parser extracts and the old did not, especially the 288 qwen3:4b turns, for false positives.
- H3 before/after: qwen3:4b + cogito:8b, k=5, 12 tasks, against baseline bf8f6333, using billed tokens.
  - Honest expectation: cogito lift is concentrated in h3-exact-value and rw-2. Per-cell gaps under 26pp are noise, so judge on pooled results.
  - qwen3:4b is expected at about 0 (10 text-extracted calls, 0 leaks). The 2-tier lift rule will likely NOT be met by P2, so P2 is a no-regression plus cogito-lift claim. ablation-warden rules on whether that suffices for default-on, or whether P2 ships behind `textToolCalls`.

## Open question
The provider thread (conversation-assembly.ts:94 uses lastThought) keeps the raw printed call. Rewriting it as a synthesized native tool_call could teach native FC, but it is a separate ablation.
