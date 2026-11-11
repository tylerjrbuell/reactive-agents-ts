---
type: harness-report
status: complete
created: 2026-11-10
tags: [harness, prompts, model-adaptive, calibration, census, user-control, zero-token]
---

# Internal prompt audit: what the model sees, what adapts, what misleads

Zero-token audit. No product code edited, no live model calls. Scripts and raw outputs: [2026-11-10-internal-prompt-audit/](2026-11-10-internal-prompt-audit/).

- **Corpus.** `~/.reactive-agents/traces` (3,165 files) plus `wiki/Research/Ablations/**` traces (98 files). 3,262 runs carry events. **701 real-model runs** have think turns (`llm-exchange`, `requestKind: stream`). Scripted test-model runs are excluded from every count below.
- **Static render.** `render.ts` imports the workspace `src` builders (persona, tool reference, rules, final-answer description, tool definitions) and measures them. Token counts are chars/4 estimates.
- **Git state.** `dev` at `69aa37a6a`, dirty tree (other wardens editing). Line anchors are from this tree. `think.ts` changed under me once during the audit, so its line numbers may drift.

## Verdict (short)

1. **The prose barely adapts.** Tier (local / mid / large / frontier) and tool-call dialect are the only axes that change model-visible text. No calibrated field changes the prose a native-FC model sees.
2. **The calibration data cannot drive adaptation yet.** All 9 shipped calibrations give the same values for `steeringCompliance` (`hybrid`), `systemPromptAttention` (`strong`) and `optimalToolResultChars` (2000). The probes cannot tell models apart (see section 3). Cloud models (grok, claude, gpt, gemini) have no calibration at all.
3. **The biggest prose-caused misread is a harness nudge, not model-family behaviour.** The "you have tool results, give your final answer now" nudge (`conversation-assembly.ts:258-264`) fires in **449 of 701 runs (64 %)**. It was on the decisive turn of **all 20** grok-4 `umami-explore` runs in the family-disclosure ablation. In the base arm, 10 of 10 stopped right there with a menu. In the nofam arm, 5 of 10 stopped there. So the ablation's "family disclosure reads as a menu" hypothesis is confounded by this nudge.
4. **Builders cannot see or control most of it.** Of about 30 model-visible text sources, 2 can be replaced at fragment granularity (persona, loop-detected line). Wire tool descriptions and the provenance of the top guidance line are recorded nowhere.

Recommendation: run C1 (finish-nudge ablation) next, and build the fragment registry (section 7). Do **not** build per-family hand-written prompts. The evidence does not support them: the one family effect measured (grok) traces to a general nudge.

## 1. Inventory of model-visible internal text

Sizes are measured (`render.txt`, `turn0.txt`, `phrase.txt`). "Runs" counts real-model runs in the corpus where the text appeared at least once (out of 701). Builder control and trace visibility are in section 6.

### 1a. System prompt (cached prefix), assembled by `assembly/stages/system-prompt.ts:systemPromptStage` and then `think.ts` (parts at ~549-639)

| # | Text | file:symbol | Size | When it fires |
|---|---|---|---|---|
| S1 | `Environment:` (date, tz, platform, custom keys) | `reasoning/src/context/context-engine.ts:buildEnvironmentContext` | 94 chars + custom | every think, all tiers |
| S2 | Default persona | `reasoning/src/kernel/capabilities/attend/context-utils.ts:80 buildSystemPrompt` | local 82 / mid 214 / large and frontier 292 chars with tools. 28 / 46 / 123 chars with no tools | every think with no custom system prompt |
| S3 | In-prompt tool reference | `context-engine.ts:buildToolReference` | 4 tools: local 380, mid 221, large and frontier 2,157 chars | only when dialect is not `native-fc` (`system-prompt.ts:69`) |
| S4 | `RULES:` block | `context-engine.ts:buildRules` | 671 chars | opt-in `verboseRules` |
| S5 | Skills header and catalog XML | `system-prompt.ts:83-94` | header ~70 chars + catalog | when skills are configured |
| S6 | `Goal: <task>` | `system-prompt.ts:96` | task length | every think |
| S7 | Text-parse call grammar | `tools/src/drivers/text-parse-driver.ts:buildPromptInstructions` | 2,468 chars for 4 tools | text-parse dialect only |
| S8 | Decision Rationale block | `think.ts` (`rationaleInstructions`) | ~900 chars | opt-in `auditRationale` |
| S9 | Tool index | `think.ts` `buildToolIndexText` | varies | opt-in `toolIndex` |
| S10 | Checklist system line | `think.ts` `checklistSystemLine` | ~110 chars | opt-in `checklistGuidance.systemLine` |
| S11 | Brief/pulse harness content | `reason/resolve-think-surface.ts:263` | varies | brief or pulse meta-tools on and task is non-trivial |

Measured turn 0 on native-FC (`turn0.txt`): the system prompt is 400-600 chars for every family when the builder sets no custom prompt. Example: grok-4 umami was 399 chars. The wire tool array dominates the request, not the system prompt.

### 1b. Message tail (after the last cache breakpoint)

| # | Text | file:symbol | Size | Runs |
|---|---|---|---|---|
| T1 | `Outstanding requirements:` + items | `reasoning/src/assembly/standing-frame.ts:269`, placed by `stages/volatile-tail.ts` | ~90 chars for the default `[answer]` item | **645** (every run with a contract) |
| T2 | `Requirements not yet satisfied:` (tools withheld) | `standing-frame.ts:269` | ~50 chars | 10 |
| T3 | Prior context / strategy handoff | `standing-frame.ts:227,240` | varies | rare |
| T4 | `Guidance:` block (13 kinds, render order fixed) | `reasoning/src/kernel/state/guidance-channel.ts:renderGuidance`, attached as a trailing user message at `think.ts:644` | 1 line ≈ 60-400 chars | see rows G* |
| G1 | **Finish nudge, no contract** ("You have tool results above. If you have what you need … give your final answer now …") | `kernel/capabilities/act/conversation-assembly.ts:243,258-264` (`hasNoContractButUsedTools`) | 190 chars | **449** |
| G2 | Finish nudge, required tools satisfied | `conversation-assembly.ts` (`REQUIRED_TOOLS_SATISFIED_PREFIX`) | ~190 chars | 36 |
| G3 | "You must still call: X" | `conversation-assembly.ts:205` | ~80 chars | 16 |
| G4 | Retry: "correct tool name shown in the system prompt" | `conversation-assembly.ts:272` | 170 chars | 0 |
| G5 | `REQUIRED tools not yet called` | `guidance-channel.ts:171` | ~90 chars | 2 |
| G6 | Loop detected | `guidance-channel.ts:153` | 104 chars | 1 |
| G7 | Evidence gap | `guidance-channel.ts:184` | ~120 chars + claims | 0 |
| G8 | Environment update | `kernel/capabilities/reflect/environment-update.ts` | ~60 chars | 106 |
| G9 | `Recovery required:` (loop, arbitrator, stall) | `kernel/loop/runner-helpers/loop-resolution.ts:206`, `stall-deliverable.ts:378`, `decide/arbitrator.ts:610-630` | ~150 chars | 30 |
| G10 | Duplicate gather | `act/act.ts:1028` | ~120 chars | 13 |
| G11 | Checklist reminders | `reflect/checklist-reminder.ts:33,73` | 110 / ~90 chars | 3 |
| G12 | Plan posture | `policy/run-posture.ts:planPostureGuidanceParts` | ~150 chars | 12 |
| G13 | Think-guard redirects ("Not done yet …", "files are not written yet", "diminishing returns", figures not in observations) | `reason/think-guards.ts:200,258,394-398,458,540` | 80-250 chars | 0 |
| T5 | Exit-gate denial ("⚠️ Not finished yet. Still outstanding: … Do not describe a next step or ask for permission.") | `kernel/loop/exit-gate.ts:543-550` (harness_signal step) | ~200 chars + items | 65 |
| T6 | Answer-turn and withheld-call refusals | `exit-gate.ts:546`, `reason/unresolved-tool-call.ts:238-243` | 55-200 chars | 10 |
| T7 | Unresolved tool-call text: "answer in plain prose" | `unresolved-tool-call.ts:79-81` | 230 chars | 1 |
| T8 | Stall escalation ("despite N reminders … will fail the task") | `runner-helpers/stall-deliverable.ts:75-83` | ~200 chars | ≤20 (marker too generic to count exactly) |

### 1c. Tool-result text and adapter hooks (`llm-provider/src/adapter.ts`, tier-selected)

| # | Text | file:symbol | Size | Runs |
|---|---|---|---|---|
| R1 | `[Recovery guidance: …]` suffix on a failed tool result | `act/tool-observe.ts:721` plus `adapter.ts:localModelAdapter.errorRecovery` (local tier only) | 80-200 chars | 83 (mimo 51, bonsai 19) |
| R2 | Legacy "Try an alternative approach or use a different tool" | removed from code. Still present in old traces | — | 18 (pre-fix) |
| R3 | `continuationHint` (local / mid / default) | `adapter.ts:110,169,254`, called at `reason/continue-thinking.ts:72`, `think-guards.ts:190` | 40-200 chars | 0 phrase hits |
| R4 | `synthesisPrompt` | `adapter.ts`, called at `conversation-assembly.ts:192` | ~150 chars | 0 |
| R5 | `qualityCheck` | `adapter.ts`, called at `think-guards.ts:341` | ~250 chars | 0 |

### 1d. Wire tool descriptions (the largest internal text)

| # | Text | file:symbol | Size | When |
|---|---|---|---|---|
| W1 | Built-in and meta tool descriptions | `packages/tools/src/skills/*.ts` (`webSearchTool` … `discoverToolsTool`) | full wire **129-508 tok each; all 22 ≈ 5,836 tok** | full profiles (mid / large / frontier) |
| W2 | Compact description = `callConstraintNote` | `reasoning/src/kernel/capabilities/attend/tool-formatting.ts:139`, applied at `think.ts:700` | all 22 ≈ 1,082 tok. 19 of 22 tools keep 0 chars of prose | local profile (`toolSchemaDetail: names-and-types`, `context-profile.ts:146`) |
| W3 | final-answer description | `tools/src/skills/final-answer.ts:buildFinalAnswerDescription` | 779 (strong or unset) / 608 or 501 (moderate) / 330 (weak) chars | **off the native-FC wire** (META filter `think.ts` ~655). Reaches text-parse and `none` dialect models only |
| W4 | Hidden-tool summary when the index promotes a tool | `tool-formatting.ts:compactToolDescription("summary")` | first sentence + constraints | opt-in `toolIndex` |

### 1e. Side-call templates

`packages/prompts/src/templates/**`: 27 files, 22 KB. The only kernel consumers are the adaptive classifier and the reflexion and ToT side calls (`reasoning.adaptive-classify`, `reasoning.reflexion-*`, `reasoning.tree-of-thought-*`). The reactive loop's own text (all of the above) is hardcoded and does not use the template service. `packages/prompts` has **no owning warden** (`bun run repo scope`).

## 2. Calibration and capability read map

| Field | Read sites (non-test) | Changes model-visible text? |
|---|---|---|
| `steeringCompliance` | **none** outside calibration plumbing (`llm-provider/src/calibration.ts:54`, `calibration-runner.ts:344,372`, `runtime/src/calibration-resolver.ts:38`) | **DEAD** |
| `systemPromptAttention` | `reasoning/src/kernel/policy/harness-plan.ts:190` adds a scaffolding level. `tools/src/skills/final-answer.ts:173` trims the final-answer description. | **Effectively dead.** (a) `scaffoldingLevel` has no consumer outside `harness-plan.ts` (written at :230, read only by its own recompile at :350/:379), and the plan only compiles under `adaptiveHarness` (default off, `runner.ts:484`). (b) final-answer is not on the native-FC wire, and every calibration says `strong`, which gives the same text as uncalibrated. The claim in `adapter.ts:21` ("weak attention → harness-plan scaffolding bump" as a live channel) is false. |
| `observationHandling` | `reason/think.ts:441` (recall stays on the wire), `decide/tool-call-refusals.ts:173`, `harness-plan.ts:194` (write-only scaffolding). Passed into the final-answer context at `runtime/.../tool-schemas.ts:196` | Tool-surface only. **The final-answer prose ignores it.** The docstring at `final-answer.ts:98-112` says it appends guidance. It does not. |
| `parallelCallCapability` | `strategies/blueprint.ts:141-143` (plan-execute worker concurrency) | No. The persona's parallel-batching sentence (`context-utils.ts:117`) is tier-gated, not calibration-gated. |
| `optimalToolResultChars` | `llm-provider/src/calibration.ts:261` sets `profileOverrides.toolResultMaxChars`, merged at `kernel/loop/runner.ts:204-210` | **Yes**: the tool-result compression budget (2000 on all 9, replacing local 1200) |
| `toolCallDialect` | `llm-provider/src/providers/local.ts:226` sets the driver mode. That gates S3 and S7 (`system-prompt.ts:69`, `think.ts` driver) and the META wire filter. Also `blueprint.ts:142` | **Yes**, and it is the largest prose switch |
| `actOrAnswer` | `reasoning/src/harness-config.ts:178-203`, `reason/act-or-answer.ts:118` | No (a `tool_choice` re-ask) |
| `classifierReliability` | `strategies/adaptive.ts:188`, `reflect/strategy-evaluator.ts:41-45`, `runtime/.../classifier.ts:85-137` | No (skips the classifier call) |

Capability and tier reads that do change prose: persona S2, tool reference S3, compact wire descriptions W2 (`context-profile.ts:146`, the largest single delta: ≈5.4× fewer tool tokens on local), adapter hook selection (`adapter.ts:341`), tool-result budget (`context-profile.ts`: local 1200, mid 1200, large 800, **frontier 600**), and disclosure mode (index / hybrid / discover).

Tier assignment is inconsistent across close siblings (`turn0.txt`): grok-4 = frontier but grok-4.3 = mid. claude-haiku-4-5 = mid in some runs and large in others. gpt-oss-20b = mid, gpt-oss-120b = large. The text a model gets depends on these labels, so the label is a hidden prompt variable.

## 3. Calibration probes cannot tell models apart (`llm-provider/src/calibration-runner.ts`)

- **`steeringCompliance`.** `:106-109` returns `hybrid` both when all three channels pass and when none pass. It cannot separate a model that obeys everything from one that obeys nothing. 9 of 9 = `hybrid`.
- **`systemPromptAttention`.** The probe is a trivial 5-turn "count to N, end with [VERIFIED]" task (`:212-232`). `moderate` is reachable only through a fall-through that a 5-turn loop never hits, so the probe is binary. 9 of 9 = `strong`.
- **`optimalToolResultChars`.** The probe finds a needle in Lorem ipsum. The largest length tried is 2,000 (`:239`), so 2000 is the ceiling. 9 of 9 = 2000.
- **Ollama only.** `ollamaChat` is the only transport. Hosted families get no calibration (`runtime/src/calibration-resolver.ts:31` returns `undefined`).

Consequence: "calibration-driven adaptation" is the right *architecture* (measured dimensions beat hand-written family prompts), but today's measurements carry no signal on the prose-relevant axes. Fix the probes first (C3) before wiring any prose to them.

## 4. Turn-0 render diff across tiers and models

From real wire captures (`turn0.txt`) and the static render (`render.txt`):

| Model (tier) | System prompt on native-FC, no custom prompt | Tool descriptions on the wire |
|---|---|---|
| cogito:8b, qwen3:4b, mimo-v2.6, gemma4 (local) | Environment + "You are a helpful assistant. Use the provided tools…" (82) + Goal. **No "think step by step".** | compact: `callConstraintNote` only (0 chars for most tools) |
| qwen3.8-27b, gemini-2.5-flash, gpt-oss-20b, grok-4.3, haiku (mid) | + "Think step by step…" + parallel hint (214) | full |
| gpt-4o, sonnet-4-6, gpt-oss-120b (large); grok-4 (frontier) | + "expert reasoning agent… **Prefer concise, direct answers once you have sufficient information.**" + parallel hint (292) | full |
| any text-parse model (qwen2.5-coder, dialect `none`) | + tool reference (S3) + call grammar (S7, ~2.5 K chars for 4 tools) + final-answer on the wire | n/a (text) |

The only family-specific prose is none: two families on the same tier get byte-identical internal text. Differences come from tier labels and dialect.

Prose-truth defects found while diffing (no ablation needed, just correct the text):

1. `conversation-assembly.ts:272` says "retry with the correct tool name shown in the system prompt". On native-FC the system prompt shows no tool names (`system-prompt.ts:69`).
2. `guidance-channel.ts:184` says "using only data from the Observations above". The native-FC thread has no section called Observations.
3. `context-utils.ts:100` says "Think step by step" is kept in every branch. The local branch (`:113-116`) has none.
4. `final-answer.ts:98-112` documents `observationHandling` and `toolCallDialect` effects that the function never reads.
5. `adapter.ts:21` and `calibration.ts:245` claim live channels that are write-only (section 2).

## 5. Misread census (counts per family, trace ids)

Runs with think turns per family: mimo 179, gemma 80, qwen 80, bonsai 80, cogito 68, xai 60, openai 53, nemotron 44, gemini 27, anthropic 22, llama 3.

### 5a. Stop-and-menu after the finish nudge (G1). Prose-caused, cross-family

On the turn carrying G1 (`nudge_end.txt`, first G1 turn per run):

| Family | Runs nudged | Ended on that turn | …after ≤1 tool result | …ending on a question or menu |
|---|---|---|---|---|
| xai | 51 | 29 | 22 | **19** |
| gemma | 48 | 34 | 32 | 5 |
| qwen | 36 | 23 | 21 | 1 |
| bonsai | 72 | 37 | 21 | 5 |
| nemotron | 35 | 19 | 19 | 0 |
| openai | 34 | 16 | 13 | 0 |
| cogito | 34 | 13 | 9 | 1 |
| mimo | 113 | 15 | 8 | 0 |
| gemini | 20 | 2 | 2 | 0 |
| anthropic | 3 | 2 | 2 | 0 |

Many of the ≤1-result stops are correct: single-lookup tasks such as crypto prices or a file write. That is the case G1 was added for (2026-08-16, gemma XRP). The defect is the subset where the single call was **a listing, discovery or meta call** and the task needed more: **36 runs**. xai 19 (e.g. `01M6FE2R2K6SFFDP5E59QHQHAZ`, `01M6V5YT9KHP7FMH51G8WYCJ7F`, `01M73QB8QPHQ0XED2Y74Z2RE4W`), openai 6 (`01M6Q9QF7TQEGY0PWF4220Z81X`, `01M6RN8PPJ3FM6NXN1SB77MHMD`), gemma 5 (`01M64GE8C5F46EXK22GHSERYJD`, `01M6KBND0H6ZDZV46MQA32M2JE`), cogito 3 (`01M6S4DCCR4X2MAK2DBK49V736`), qwen 2 (`01M73P02AA5330RS11EC1Z1Q9E`), gemini 1 (`01M6FDK0QVDHK07WAN5WE2Z0TD`: "Now I can proceed with analyzing…" and then it stopped).

**grok-4 family-disclosure ablation, turn by turn** (`results/traces-{base,nofam}-wide/grok-4/umami-explore/run*`):

```
base  (10/10): i0 get_websites → i1 [G1] END with menu
nofam ( 5/10): i0 get_websites → i1 [G1] END with menu
nofam ( 5/10): i1 [G1] discover-tools → i2 3-4 data calls → i3 answer
```

G1 sits on the decisive turn in 20 of 20 runs. The persona line "Prefer concise, direct answers once you have sufficient information" (large and frontier only) points the same way. The ablation's attribution to family disclosure is not wrong, but it is untested against this confound. The cheapest discriminating run is C1 arm B on the same cell.

### 5b. Other prose-linked classes

| Class | Counts per family | Ids | Linked prose |
|---|---|---|---|
| Wrong argument after a hidden constraint | mimo 105 arg errors, bonsai 4, gemma 4, cogito 3 | `01M6Z7ZWX83F4XYNED5H5ZEMJ0`, `01M70AN31C6NGS2EG540E4GQQC`, `01M6GTXNARK8XKDR6EW05GNMNN` | W2 compact descriptions dropped value constraints. **Fixed 2026-11-10** (`callConstraintNote`, the 8/8 → 0/8 ablation). Recheck after more traffic. |
| Retry steered away from the right tool | legacy R2: bonsai 12, gemma 4, qwen 2 | `01M64GFPC0JVY9BETA7PN5ARN0` | removed text. No current hits. |
| Narration without a call ("I will …", no tool) | cogito 5 | `01M6JE4XGPY59FVMCVTGT90R6M`, `01M6JFJKJY5G419Q1EKEVZBFKH` | no single fragment. 14 of 14 cogito turns under plan posture "Call todo…" ended without calling (`nudge.txt`) |
| Repeated identical narration | gemini 1 | `01M6MQ9F9KFCPQRFW2WCGCC1KA` | none (too rare) |
| Ask instead of act at turn 0 (no guidance yet) | openai 4 (gpt-4o "How many pictures": `01M6QGJPVTM1WAFP5S7AY22AVJ`), xai 7, cogito 4, bonsai 5, gemma 3 | in `nudge.txt` | no persistence or act-first sentence in any persona (see vendor guidance) |
| Ignored REQUIRED-tools guidance | mimo 0 of 2. G3: 16 of 16 called | — | works where it fires |

Mimo's 50 "menu" endings with no guidance are mostly legitimate chat ("What tools do you have?" followed by an offer). The regex counts trailing offers. Only the hand-checked subsets above are claimed as misreads.

## 6. User control: override, disable, inspect

Composition surfaces that exist today:

- **Compose tags.** `core/src/services/harness-types.ts:31-38`: `prompt.system`, `prompt.guidance`, `nudge.loop-detected`, `nudge.healing-failure`, `message.tool-result`, plus non-text tags. Call sites: `reason/resolve-think-surface.ts:270`, `think.ts:211,602`, `act/act.ts:986`, `act/tool-observe.ts:424`.
- **`.withHarness({...})`.** `runtime/src/harness-schema.ts:13-51`: boolean or number switches only (`verboseRules`, `auditRationale`, `toolIndex`, `stableToolList`, `promptDumpPathPrefix`, …). No text fields.
- **`.withSystemPrompt` / persona.**
- **Adapter hooks.** `selectAdapter` is hard-wired at `think.ts:140`, `act.ts:160`, `runner.ts:204`. **Builders cannot inject an adapter.**
- **`packages/prompts` templates.** Side calls only.

| # | Override path | Class |
|---|---|---|
| S1 Environment | custom keys can be added. `RA_ENV_TIME_PRECISION`. Cannot be removed or replaced | a |
| S2 Persona | `withSystemPrompt` replaces it. `prompt.system` can replace it, but its payload is the custom prompt or `""` (`resolve-think-surface.ts:263-270`), so the default text cannot be inspected in the hook | b |
| S3 Tool reference, S7 call grammar | none (dialect-driven) | a |
| S4 RULES, S8 rationale, S9 index, S10 checklist line | boolean on or off via `withHarness`. Text fixed | b |
| S5 Skills header, S6 Goal line | none | a |
| S11 Brief/pulse content | passes through `prompt.system` (whole string) | b |
| T1-T3 Outstanding / handoff tail | none (`volatile-tail.ts` sits outside every hook) | **a** |
| T4 / G1-G13 Guidance | `prompt.guidance` can replace or suppress the **whole block** (`think.ts:600`). The hook gets no per-kind ids, so one line cannot be targeted without string surgery. G6 alone is replaceable (`nudge.loop-detected`) | b |
| T5-T8 Exit-gate, answer-turn, unresolved, stall text | none | **a** |
| R1 Recovery suffix | `message.tool-result` string surgery only. Adapter not injectable | b (barely) |
| R3-R5 Adapter hooks | none | **a** |
| W1 Built-in and meta tool descriptions | none. A builder can only register its own tools | **a** |
| W2 Compact descriptions | `harness.compactCallConstraints` (mode switch). Text derived | b |
| W3 final-answer description | none | **a** |
| Side-call templates | PromptService templates (registration path not verified this audit) | b |

**(a) No override path. These are hidden nudges the user cannot turn off or replace:** S1 (removal), S3, S5, S6, S7, **T1-T3 outstanding tail (645 runs)**, **T5 exit-gate denial (65 runs)**, T6, T7, T8, R3-R5 adapter hooks, **W1 tool descriptions (the largest internal text)**, W3.

**(b) Can be disabled but not replaced, or replaced but not inspected:** S2 (replace, default not inspectable), S4, S8, S9, S10 (disable only), S11, **G1 (the top nudge, 449 runs) and every other guidance kind except G6: block-level only**, R1, W2.

**(c) Invisible to the user (no event, or not in the trace or prompt dump):**

- **W1-W4 wire tool descriptions.** `llm-exchange` records only `toolSchemaNames`. `guard-fired wire-request` records names and provenance. The 2026-11-10 ablation had to recover them statically.
- **Provenance of G1, G3, T5.** No `harness-signal-injected` or `signal-rendered` event is emitted for G1. The corpus has 617 injected and 68 rendered events against 629 G1 lines. The text exists only as raw strings inside recorded messages.
- **Recorder caps.** Recorded messages are capped at 2,000 chars (`trace/src/attribution-facts.ts:59` `RECORDER_MESSAGE_CAP`). The system prompt is capped at 4,000 chars (126 exchanges truncated in the corpus). So late-message guidance and long system prompts can fall off the trace.
- **`RA_PROMPT_DUMP` is not the request.** `think.ts:414` writes `systemPromptText` and `conversationMessages`. Those are taken *before* the driver grammar, rationale, tool index and checklist line join the system prompt (`:549-639`), and before the Guidance message is appended (`:644`). It also writes no tool schemas. The dump promised for diffing what the model saw omits the per-turn nudges.

## 7. Closing mechanism: one prompt-fragment registry

Build on what exists (the typed `GuidanceKind`, the compose pipeline and the signal ledger). Do not add a parallel system.

1. **Fragment type (core, `core-warden`).** Add a `PromptFragmentId` literal union and a `PromptFragment = { id, slot: "system" | "tail" | "guidance" | "tool-result" | "tool-description", render(vars) => TextPart[] }` in `packages/core` next to `harness-types.ts`. Returning `TextPart[]` keeps it modality-neutral (Plan 9 principle 8). Add one compose tag, `prompt.fragment`, with ctx `{ id, slot, vars, defaultText }`: return a string to replace, `null` to disable, `undefined` to pass through. The default text is in ctx, which closes the inspect gap. `prompt.guidance` and `nudge.loop-detected` become aliases.
2. **Registry and call sites (reasoning, `kernel-warden`).** Add one module, `reasoning/src/prompt-fragments.ts`, holding every default text from section 1 under a stable id (`guidance.finish.no-contract`, `tail.outstanding`, `exit-gate.deny`, `persona.frontier`, …). Every site calls `renderFragment(id, vars)`. Migrate in waves: guidance kinds first (already typed), then tail and exit gate, then persona and environment. Every default must render byte-identical. Pin the boundary with a check script modelled on `check-dialect-aware.sh`: no model-visible literal outside the registry.
3. **Tool-description overlays (`tools-warden`).** Built-in and meta tool descriptions are fragments with slot `tool-description` and id `tool.<name>.description`, so builders can rewrite or trim built-in tool prose without forking the tool.
4. **Config surface (`runtime-warden`).** Add `.withHarness({ prompts: { "<id>": string | null } })`, JSON-serialisable for AgentConfig persistence. Functions go through `.compose()`.
5. **Trace (`harness-warden` schema; `kernel-warden` emits).** Add one `prompt-assembled` event per think: `{ iter, fragments: [{ id, slot, chars, hash, overridden }], toolDescriptions: [{ name, chars, hash, mode }] }`. Hashes cost almost nothing and survive the recorder caps. `rax-diagnose attribute` can then attribute a misread to the fragment on the decisive turn (the 5a analysis becomes a query, not a regex). Fix `RA_PROMPT_DUMP` to dump the actual request (system with driver + `messagesForRequest` + wire tools): a `kernel-warden` edit at `think.ts:414`.
6. **Adapter hooks (`provider-warden` + `kernel-warden`).** Fold R3-R5 into fragments (`adapter.local.continuation`, …) so tier variants are registry entries keyed by tier. Delete the hard-wired `selectAdapter` text paths once migrated. `parseToolCalls` stays as it is.
7. **Docs.** Generate the fragment id list into the docs from the registry, so the docs stay truthful (Golden Rule 6).

Side benefit: every candidate in section 9 becomes a config-only ablation arm (`prompts: { "guidance.finish.no-contract": null }`), with no code edit per arm.

## 8. Vendor guidance by family

Not re-fetched this session (no web tool in my authority). These are from documentation I know as of mid-2026. Verify before quoting externally. **V** = vendor advice. **M** = measured, published evidence.

| Family | Guidance | Source |
|---|---|---|
| Anthropic (Claude 4.x) | V: be explicit. Claude 4 follows instructions literally: "tell it what to do", and say so if you want action rather than suggestions. Avoid ALL-CAPS "CRITICAL/MUST" (newer models overreact). XML tags to separate sections. Tool descriptions are the main steering surface: write them like onboarding docs, use namespaces, return token-efficient, meaningful results. | docs.anthropic.com "Claude 4 prompt engineering best practices" and "Use XML tags"; anthropic.com/engineering "Writing effective tools for agents" and "Effective context engineering for AI agents" |
| OpenAI GPT-5 / GPT-4.1 / o-series | V: control "agentic eagerness" explicitly ("keep going until the query is resolved; do not hand back to the user" vs low-eagerness). Contradictory instructions waste reasoning tokens on GPT-5. Tool preambles. GPT-4.1 guide: three agentic reminders (persistence, use tools rather than guess, plan) reported ~20 % SWE-bench gain (vendor-reported). Reasoning models: avoid "think step by step", keep prompts simple, use delimiters. | cookbook.openai.com "GPT-5 prompting guide", "GPT-4.1 prompting guide"; platform.openai.com "Reasoning best practices" |
| Google Gemini 2.5 / 3 | V: put the instruction after long context ("Based on the information above…"). Concise, direct prompts. Function calling: clear descriptions, strong types and enums, keep the active tool set small (~10-20). Gemini 3: keep temperature at the default 1.0. | ai.google.dev "Prompting strategies", "Function calling" |
| xAI grok-4 | V (sparse): grok-4 is reasoning-only (no reasoning-effort control, some sampling penalties unsupported). Prefer native tool calling. Give explicit goals and context. Little public agent-prompt guidance: **low confidence**. | docs.x.ai model and guide pages |
| Qwen3 | V: thinking and non-thinking modes (`/think` and `/no_think` switches). Recommended sampling: thinking T 0.6 / top-p 0.95 / top-k 20, non-thinking T 0.7 / top-p 0.8. No greedy decoding. Do not keep thinking content in history. Hermes-style tool template. | Qwen3 model cards and qwen.readthedocs.io |
| Llama 3.x and small local | V: Meta recommends 70B+ for chat combined with tool calling. 8B "cannot reliably maintain a conversation alongside tool calling definitions". | llama.com Llama 3.1 prompt-format docs |

Measured, cross-family evidence relevant here:

- (M) Format and spurious-feature sensitivity is large on small models and smaller on frontier: Sclar et al. 2023, arXiv 2310.11324, up to 76 pp. He et al. 2024, arXiv 2411.10541.
- (M) Fewer tools improves small-model function calling: "Less is More", arXiv 2411.15399.
- (M) Mid-context instructions lose attention: Liu et al., arXiv 2307.03172. Longer inputs degrade reasoning: Levy et al., arXiv 2402.14848.
- Internal (M): compact descriptions cut tool tokens 5.4× but dropped constraints (fixed). Additive final-answer clauses regressed cogito (94 → 87 %, `final-answer.ts:118`). The zero-tool doctrine tax cost +449 % tokens (`context-utils.ts:87`).

What this supports: **adaptation should be keyed on measured properties** (reasoning model or not, tool-count tolerance, dialect, how much the model wants to hand back to the user), not on family names. The vendor advice converges across families on three points the harness violates today:

1. Do not push a reasoning model toward stopping or toward CoT boilerplate (S2 "Think step by step" plus "Prefer concise…" on reasoning models, and G1).
2. State persistence or act-first explicitly when tools are present (no persona does).
3. Steer through tool descriptions (W1 is the biggest surface, and builders cannot touch it).

## 9. Ranked candidates (expected lift × breadth ÷ cost)

| Rank | Candidate | Evidence | Ablation design | Owner |
|---|---|---|---|---|
| **C1** | Make G1 two-way and evidence-neutral, or drop the no-contract branch. Today's text: "give your final answer now — you don't need to call anything else". Proposed: "If these results answer the task, answer it. If not, make the next call." | 449/701 runs carry it. 36 stops after only a listing or discovery call. 20/20 decisive grok turns | Arms: A current, B no-contract branch off, C neutral wording. Tiers: qwen3:4b, cogito:8b (local); grok-4, gpt-4o-mini or haiku (frontier). Tasks: `umami-explore` (k=10, where it fires), H3 required-tools, plus the gemma XRP single-lookup task G1 was added for (guard against reintroducing the `harness_deliverable` fallback). Gate: ≥3 pp aggregate lift across ≥2 tiers, no single-lookup regression, ≤15 % tokens. Spike already done (trigger frequency above). | kernel-warden (`act/conversation-assembly.ts:243-264`); ablation-warden runs it |
| C2 | Fragment registry + `prompt-assembled` trace event (section 7) | closes lists (a), (b), (c); makes C1/C4/C5 config arms | Infrastructure: byte-identical-default test. No lift gate (default unchanged) | core, kernel, tools, runtime wardens; harness-warden (trace schema, diagnose) |
| C3 | Fix calibration probe discrimination before any calibration-driven prose: three-state steering, a harder multi-turn attention probe with a graded outcome, tool-result lengths up to 16 K, a hosted-provider transport | 9/9 identical on 3 fields | Zero-token gate first: rerun the probes on ≥6 Ollama models. Pass = ≥2 distinct values per field. Only then propose prose wiring, with its own ablation | provider-warden (`llm-provider/src/calibration-runner.ts:82-109,212-268`) |
| C4 | Reasoning-model persona: drop "Think step by step" and "Prefer concise… once sufficient" when the capability marks a reasoning or thinking model. Add one act-first sentence when tools are present. | vendor V across OpenAI, Anthropic, Google. Turn-0 ask-instead-of-act: openai 4, xai 7. Interacts with C1 | Run **after** C1 (one fix per cycle). Arms: current vs reasoning-aware persona. Tiers: grok-4, gpt-5-class, sonnet (frontier) + qwen3 thinking (local). Tasks: explore, H3. Same gate | kernel-warden (`attend/context-utils.ts:80-127`) |
| C5 | Prose-truth fixes (section 4, items 1-5) | static | None needed (text and doc corrections). Pin with unit tests | kernel-warden (1-3), tools-warden (4), provider-warden (5) |
| C6 | Make `RA_PROMPT_DUMP` dump the real request (think.ts:414). Record wire-description hashes | section 6c | Instrument change. Verify by diffing the dump against the `llm-exchange` request on one run | kernel-warden (emit); harness-warden (trace schema) |
| C7 | Re-derive the tool-result budget ladder (frontier 600 < local 1200 < calibrated 2000) | `context-profile.ts:174-184`. 17 frontier truncations seen | Spike first: count frontier runs that `recall` after truncation or answer missing truncated data. Ablate only if the spike shows misses | kernel-warden |
| C8 | Make tier labels consistent for siblings (grok-4 vs grok-4.3, haiku mid vs large) | `turn0.txt` | Zero-token: list the resolved tier per catalog model. Fix the catalog | provider-warden (model catalog / capability) |

Not recommended: hand-written per-family prompt variants. The only family-shaped effect in the corpus (grok menu-back) traces to a general nudge (C1). Per-family text would multiply the surface section 6 already shows builders cannot control.

## Limitations

- Classifications are regex-plus-hand-check over traces. Menu regexes overcount trailing offers, so only hand-checked subsets are claimed. Recorder caps (section 6c) can hide late guidance, so counts are lower bounds.
- Corpus mix is skewed (mimo 179 runs, anthropic 22). Per-family rates for small families are indicative only.
- Wire tool descriptions are not in traces. W1 sizes are static renders of built-ins, not of MCP tools.
- Vendor guidance was not re-fetched this session.
