---
type: harness-report
status: complete
created: 2026-10-29
tags: [harness-report, tool-calling, healing, chat-history, root-cause]
warden: harness-warden
---

# Tool calls emitted as text: root cause report (2026-10-29)

## Verdict

The defect is not specific to Cortex rerun. It has three stacked causes, ranked by measured leverage. The rerun path adds no code path of its own; it only looks worse because it is applied to the turn that just failed and to a history that may already carry earlier failures.

1. **Acceptance gap (primary, harness).** When a model writes a tool call as text and the call cannot be resolved (hallucinated tool name, unfenced JSON, array, truncated or garbled JSON, Hermes `<tool_call>` markup, bare `name(...)`), the resolver classifies the text as `final_answer`. The kernel then ends the run with raw call text as the answer. The same situation with a native call and an unknown name correctly reprompts (`thinking` plus unavailable-tool hint). The asymmetry is the bug.
2. **History contamination (amplifier, runtime + cortex).** The bad "answer" is recorded in engine history and persisted to the Cortex DB, then replayed on every later turn as `Assistant: {"name": ...}` in the conversation history block. Measured: 0/15 text-final with clean history vs 7/15 with one contaminated prior turn, same prompt. This is the self-reinforcing loop visible in the user's own DB.
3. **Model-intrinsic tool-happiness (trigger, not fixable in framework except by guard).** llama3.2:3b emits a text tool call with invented names on most prompts that need no tool. qwen3:4b and Nemotron-3.5-Bolt-E4B did not (0/5 on both non-tool prompts) and called the real tool natively when one was needed (5/5).

Not causes (measured): rerun/rewind cold rebuild vs warm session; empty tool descriptions from the compact `local` profile; native-vs-text driver flipping; missing `tools` in the request.

## Evidence

Artifacts: `2026-10-29-text-tool-call-probe-llama32-3b.jsonl`, `2026-10-29-text-tool-call-probe-multimodel.jsonl`, `2026-10-29-text-tool-call-healing-matrix.txt` (this directory). Scripts: `wiki/Research/Prototypes/text-toolcall-2026-10-29/{probe,reprompt-viability,desc-ablation,healing-matrix}.ts`.

Instrumentation: `probe.ts` builds the agent through `buildCortexAgent` with the exact config of the user's chat sessions (ollama, `tools:["web-search"]`, metaTools todo only, reactive, memory off), drives `session.runStream`, and patches `globalThis.fetch` to record every `/api/chat` request (tools count, message role shape) and response (native `tool_calls` count). The request body was inspected directly. Reasoning package resolves to `dist` (built 09:36); the only later src change in reasoning/tools is `additionalProperties` forwarding, which does not touch these paths. The tools resolver ran from src.

### E1. Real user data (Cortex DB, copied to /tmp, read-only)

`apps/cortex/.cortex/cortex.db`, `cortex_chat_turns`, all llama3.2:3b, tools `["web-search"]`:

- Rows 966, 968, 970 (session 01M63W...): final assistant replies are raw `{"name": "explain-hash-map", "parameters": ...}`, `{"name": "wikipedia-search", ...}`. Stored as ordinary replies.
- Rows 978, 980, 982 (session 01M642...): `Reply with exactly the word pong` and `Say hello in one word.` both answered with `{"name": "wikipedia", "parameters": {...}}`. Neither tool exists. The history grows contaminated: three consecutive text-call replies, the last two identical.

### E2. Fresh session, no history, no rewind (llama3.2:3b, n=5 per cell, final output is tool-call-shaped)

| prompt | text-final | native tool run | plain answer |
|---|---|---|---|
| "Say hello in one word." | 3/5 | 5/5 (web-search called anyway) | 2/5 |
| "Reply with exactly the word pong" | 0/5 | 0/5 | 5/5 |
| "What is 12 x 15? Answer with the number only." | 5/5 | 0/5 | 0/5 |

Examples: `{"name": "math-product", "parameters": {"x": "12", "y": "15"}}`, `{"name": "eval", ...}`. The run completed "successfully" with this as output. Requests carried `tools` (2 of them) in every call; only the synthesis call carried 0 tools by design.

### E3. Rewind path vs normal path

Rerun evicts the cached session and rebuilds it from DB rows via `initialHistory` (`chat-session-service.ts:665`). Arms: fresh agent + clean 2-turn history, fresh + warm in-memory session after a real turn. 12x15: 5/5 vs 5/5 text-final. pong: 0/5 vs 0/5. No difference. Request message shapes identical (`su` ...). Rerun is not mechanistically special.

Rerun does repeat the same prompt that failed seconds earlier (selection bias) and keeps all earlier persisted bad turns.

### E4. History contamination effect (llama3.2:3b, "Reply with exactly the word pong")

- clean history (France/Paris pair): 0/15 text-final, 0/15 native tool calls, 15/15 plain.
- one prior assistant turn containing a text tool call: 7/15 text-final, 5/15 native web-search calls, 3/15 plain. (An earlier n=5 pair showed 0/5 vs 1/5; combined with n=15 pooled 0/20 vs 8/20, Fisher p about 0.002.)

Mechanism: `withHistoryBlock` (`reactive-agent.ts:86`) folds history into the task as `Assistant: <content>` text. A previous reply that is a JSON call teaches the format.

### E5. Other models, other tasks (fresh, n=5)

| model | non-tool prompts (hello, 12x15) | tool-needed prompt (web-search Tokyo) |
|---|---|---|
| qwen3:4b | 0/10 text, 0 native | 5/5 native |
| Nemotron-3.5-Bolt-E4B | 0/10 text, 0 native | 5/5 native |
| llama3.2:3b | text on 8/15 (12x15 5/5, hello 3/5) | 5/5 native |

Larger tiers (qwen3:14b, frontier) were not probed; claim limited to these three models. This is single-family evidence for the trigger (cause 3); causes 1 and 2 are harness-side and model-independent by construction (code read plus matrix E7).

### E6. Descriptions are not the cause

The `local` profile sends `"description":""` and no param descriptions (`think.ts:468-471`, `:657`, `wire-parameter-schema.ts:23`). Raw Ollama ablation, same system/user as the kernel sends, n=20: descriptions empty 20/20 text-tool-shaped; descriptions present 20/20 text-tool-shaped. No effect. Empty descriptions still look poor for small models in general; flagged but not a cause of this defect.

### E7. Would a reprompt recover? (llama3.2:3b, 12x15, raw Ollama, n=15)

11/15 first replies were text-tool-shaped. After appending the exact `buildUnavailableToolHint` style message: with tools still offered, 7/11 recover with a plain answer, 2/11 still tool-shaped, 2/11 other; with tools removed on the retry, 11/11 recover. So fix design is: one reprompt, and on a second strike drop tools for the next call.

### E8. Healing coverage (executed matrix, `NativeFCStrategy.resolveWithDialect`, tools: web-search, http-get, file-read, todo)

Legend: HEALED = becomes a real call. REPROMPT = `thinking`, loop continues. LEAK = `final_answer` with call text.

| Shape | Result |
|---|---|
| native exact / `web_search` / `WebSearch` / `search` / `functions.web-search` | HEALED |
| native unknown name | REPROMPT (hint) |
| native args as JSON string | HEALED |
| native args alias `q` for `query` | not healed at resolver; downstream `remapSingleMissingRequired` handles one-missing-required case |
| native `maxResults:"5"` | passed through; downstream `coerceTypes` converts string to number |
| text bare JSON `name`+`arguments`/`parameters` | HEALED |
| fenced ```json | HEALED |
| two fenced blocks | HEALED (2 calls) |
| marker `<|tool_call>call:NAME{k:v}<tool_call|>` | HEALED |
| fenced pseudo `web-search(query: "x")` | HEALED |
| nameless JSON matching one tool's params | HEALED |
| args as string-valued JSON, name-only call | HEALED |
| JSON after prose, unfenced | LEAK |
| JSON array of calls | LEAK |
| two unfenced JSON objects | LEAK |
| `<tool_call>{json}</tool_call>` (Qwen/Hermes) | REPROMPT (marker detected, not parsed) |
| `<function=..><parameter=..>` XML | LEAK |
| `[TOOL_CALLS][...]` (Mistral) | LEAK |
| `<|python_tag|>{...}` (Llama 3.1) | LEAK |
| bare `web-search(query="x")` / `web_search("x")` (no fence) | LEAK |
| OpenAI shape `{"type":"function","function":{name,arguments}}` | LEAK |
| `{"tool_calls":[...]}` wrapper | LEAK |
| hallucinated tool name JSON | LEAK (E1, E2) |
| name with spaces | LEAK |
| truncated JSON, garbled `parameters{` (observed live: model echoing the schema), trailing comma, single quotes | LEAK |
| empty content + stop | REPROMPT |

Not covered by the matrix (code read only, unverified by run): a call placed in the provider `thinking` field. `ResolverInput` has no thinking field (`tools/src/tool-calling/types.ts:35`), so none is scanned. No thinking-model occurrence was reproduced (qwen3:4b clean).

Downstream pipeline (`tools/src/healing/healing-pipeline.ts`): tool-name = exact, alias map, edit distance <= 2 over all registered names (including meta-tools; risk of over-healing short names such as `todo`); param-name = alias, edit distance <= 2; single-missing-required remap; wrapper unwrap; path resolve; type coercion only string->number and string "true"/"false"->boolean (no string->array/object, number->string, JSON-string->array, scalar->array). Tests: name healer, param healer, structure, path, property tests exist (`packages/tools/tests/healing/`). The resolver's `native-fc-strategy.test.ts` pins the bug: "ignores fenced JSON when tool name not in available tools" expects `final_answer` (line 258-266).

## Root cause anchors

- `packages/tools/src/tool-calling/native-fc-strategy.ts:222-232` — after all text tiers fail, only `<tool_call>`/`<tool_use>` markers reprompt; every other tool-call-shaped text falls to `final_answer` at `:229-236`.
- `packages/reasoning/src/kernel/capabilities/reason/dispatch-think-response.ts:426-473` — the `final_answer` branch runs guards (premature, completion gaps, quality, grounding) and terminates `llm_end_turn`. No guard asks "is this a tool call".
- `packages/runtime/src/chat/engine.ts:482` (stream), `:364` (tool path), `:384` — `#recordBothTurns` records whatever `event.output` is.
- `apps/cortex/server/services/chat-session-service.ts:585-596`, `persistTurn :598-611` — persists the reply verbatim; `turnsToChatMessages :73` replays it into `initialHistory`.
- `packages/runtime/src/reactive-agent.ts:86-93` and `gateway-context-formatting.ts:86-92` — render `Assistant: <raw>`.

## Fix specs, ranked by leverage

### F1 — tools-warden (highest leverage, closes causes 1 and most of 3)

File `packages/tools/src/tool-calling/native-fc-strategy.ts`. Add one pure helper `detectToolCallShape(content): { shaped: boolean; names: string[] }` used at the tail of `extract()` (`:222`). Rules: whole content (or fenced block) is JSON-ish with a `name`/`tool`/`tool_name`/`function.name` key, or begins with `[`/`{` containing such, or `[TOOL_CALLS]`, `<|python_tag|>`, `<function=`, bare `identifier(...)` where the sole line matches `^\s*[\w.-]+\(.*\)\s*$`. If shaped and not parsed: return `{ _tag: "thinking", content: <unavailable-tool hint via buildUnavailableToolHint(names) or "your reply looked like a tool call but could not be parsed; call a listed tool natively or answer in plain text"> }`. Never `final_answer`. Keep prose containing an incidental `{` as final_answer (anchor on whole-content shape).

Pin red-on-cut: flip the test at `native-fc-strategy.test.ts:258` to expect `thinking` with "unavailable"; add the E8 LEAK rows as table-driven cases (hallucinated name, array, garbled `parameters{`, bare call, Mistral, python_tag) expecting not `final_answer`; add negative cases (prose with braces, a legit JSON answer such as `{"result": 180}`) expecting `final_answer`. Cutting the helper turns these red.

### F2 — kernel-warden (second strike drops tools; bounded)

File `dispatch-think-response.ts` near `:570` (`thinking` branch) and think tool-surface resolution. On two consecutive `thinking` results caused by F1 shape detection in the same run, set a per-run flag so the next think call is made with tools withheld (the existing synthesis path already makes a 0-tools call, so the mechanism exists) and a plain-text instruction. Evidence E7: 7/11 recover with tools, 11/11 without. Cap at one such step; if still shaped, terminate with `terminatedBy` marking tool-text and an honest output, not the JSON.

Pin: runner test with a scripted model returning a hallucinated-name JSON twice then plain text; assert iteration 3 request has no `tools` and output is plain; cut the flag and the assertion on `tools` fails.

### F3 — runtime-warden (history hygiene; closes cause 2)

Files `packages/runtime/src/chat/engine.ts:554` (`#recordBothTurns`) and `reactive-agent.ts:86` (`withHistoryBlock`). Do not record a tool-call-shaped assistant reply as history content: record a neutral marker or skip the pair (keep a `degraded: true` flag if the type allows). Share the F1 detector via a small exported function from tools rather than copying a regex (boundary-first rule). Also sanitize on replay: when rendering `Assistant:` lines drop or neutralize shaped content, so already-persisted contaminated DBs recover.

Pin: engine test that a stream completing with `{"name":"x","parameters":{}}` leaves `history()` without that assistant text; `withHistoryBlock` test that a shaped assistant turn is not rendered verbatim. Cut either and red.

### F4 — cortex (via runtime-warden dispatch of `apps/cortex`; no cortex warden exists)

`chat-session-service.ts:585-596`: do not `persistTurn` a shaped reply (or persist with a flag the UI shows as "tool call not executed"); `turnsToChatMessages :73` filter shaped assistant rows so the existing user DB heals on next rebuild. UI: rerun should not be treated as clean slate; no change needed to the rewind logic itself.

Pin: `chat-session-service.test.ts` scripted-turn case.

### F5 — tools-warden (healing breadth, ordered by observed or documented frequency)

In `native-fc-strategy.ts` add parsers for: Hermes/Qwen `<tool_call>{json}</tool_call>` (currently detected then wasted as a reprompt turn; this is the most common local-model dialect), `{"tool_calls":[...]}` and OpenAI `function` wrapper, JSON arrays of calls, multiple unfenced JSON objects, JSON embedded after prose (balanced-brace scan), bare `name(...)` for exactly known tool names, Mistral `[TOOL_CALLS]`, `<|python_tag|>`, `<function=..>` XML, lenient JSON repair (trailing comma, single quotes, unquoted keys, missing closers by balanced append). Each parser must output only names resolvable by `resolveToolName` (unresolvable still goes to F1 reprompt). In `tools/src/healing/path-resolver.ts coerceTypes`: add string->array/object via JSON parse, scalar->single-element array when schema says array, number->string when schema says string, `integer` type if schema emits it (verify), "5,000" style numerics. In `tool-name-healer.ts`: restrict edit-distance healing to names with length >= 6 or distance 1, and prefer the capability tools over meta-tools to avoid `task`->`todo` style misroutes (unverified risk; add property test first).

Pin: extend `dialect-observed.test.ts` with one case per dialect; each parser removal turns its case red.

### F6 — provider-warden (low, optional)

Ollama: when `message.tool_calls` is empty and `message.content` is tool-shaped for a name in the request's `tools`, Ollama already converted valid ones; hallucinated names reach us as content. No provider change needed for this defect. Not verified: behavior for thinking-model `thinking` channel; add a probe before any change.

### F7 — kernel-warden / prompts (defer)

Compact-profile empty descriptions (`think.ts:468`, `:657`) are a general quality issue; E6 shows no effect here, so do not ship under this defect. Candidate for its own ablation (ablation-warden) with a task that requires tool selection among many tools.

## Test-gap table

| Gap | Existing test | Needed |
|---|---|---|
| Unknown-name text call must not finalize | test at `native-fc-strategy.test.ts:258` pins final_answer (wrong) | invert |
| Tool-call-shaped but unparsed content | only `<tool_call>` marker path | table of E8 LEAK rows |
| Legit JSON answer not mistaken for call | none | negative cases |
| Hermes `<tool_call>{json}` parse | none (reprompts) | dialect case |
| Arrays / multiple unfenced / wrappers | none | cases |
| JSON repair (trailing comma, quotes, truncation) | none | cases |
| Bare `name(args)` unfenced | test says prose ignored (fence required) | decide rule, pin |
| thinking-channel tool call | none | probe then test |
| History hygiene (engine, replay, DB) | `chat-engine-initial-history.test.ts` covers seeding only | shaped-reply cases |
| Two-strike tools-off step | none | runner test |
| Type coercion breadth | string->number/boolean only | array/object/string cases |
| Edit-distance over-healing | none | property test |

## Caveats

- Cells are Bernoulli. n=5 per cell is coarse; the decisive contrasts (E2 12x15 5/5, E4 0/15 vs 7/15, E6 20/20 vs 20/20, E7) are large. The "rerun is not special" claim rests on n=5 per arm on two prompts; effect sizes smaller than about 40pp would be missed.
- Only llama3.2:3b reproduced the trigger. Whether larger or frontier models ever emit unparsed text calls was not measured; F1 and F3 are cheap and tier-independent guards regardless.
- The user's Cortex server was not touched; DB was read from a copy.
- No fix was applied or A/B-verified. After domain wardens land F1-F3, re-run `probe.ts` fresh arm (12x15) and text-hist arm, same models, to produce the mandatory before/after diff; success = text-final output rate 0 and bounded iterations.
