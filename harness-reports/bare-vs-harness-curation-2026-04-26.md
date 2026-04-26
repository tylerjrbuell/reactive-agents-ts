# Bare-vs-Harness Curation Probe — gemma4:e4b

Date: 2026-04-26
Script: `.agents/skills/harness-improvement-loop/scripts/bare-vs-harness-probe.ts`
Task: "List the top 15 Hacker News posts as a numbered markdown list, one line per post, using this exact format: '1. TITLE (score: SCORE)'."
Model: gemma4:e4b (Ollama, temperature 0.3)

## Six probe variants

| Lvl | Shape | Composite | Faith | Format | Echo | Time | Tokens |
|-----|-------|-----------|-------|--------|------|------|--------|
| **B** | bare + standard tool-calling loop | **100%** | 100% | 100% | · | 3.9s | 1,725 |
| **E** | tool-calling + post-tool synthesis nudge (planning_interval) | **100%** | 100% | 100% | · | 4.2s | 1,859 |
| **A** | bare + inlined data (no tool call) | 95% | 93% | 100% | · | 7.4s | 1,825 |
| **F** | tool-calling + reframe-on-synthesis (curator collapse to A-shape) | 95% | 93% | 100% | · | 3.8s | 2,073 |
| **D** | tool-calling + smolagents few-shot system | 33% | 7% | 100% | · | 6.4s | 1,160 |
| **C** | our harness (ReactiveAgents) | **0%** | 60% | 0% | ★ | 46.7s | 11,148 |

## What this empirically demonstrates

### 1. Bare Ollama tool-calling **already works** on gemma4:e4b
Level B (no system prompt scaffolding, no curation) hits 100% on this task. The model is fully capable of calling a tool, receiving the result via the standard `role: "tool"` channel, and synthesizing a clean numbered list. No "tool message format mismatch" hypothesis holds for this model on this task.

### 2. Our harness is the bottleneck — and it's adding active harm
Level C hit **0% composite** with a **compression-marker echo**:
```
[get-hn-posts result — compressed preview]
Type: Array(15) | Schema: id, title, score, by, descendants, url
Preview (first 8):
  [0] id=47911350  title=Clay PCB Tutorial  score=64  by=j0r0b0
  ...
```

The model literally returned the framework's internal compression preview as its answer. This is the harness *teaching* the model bad output, not just failing to help.

It also took **46.7s vs. 3.9s for B** (12× slower) and used **11,148 tokens vs. 1,725** (6.5× more) for a strictly worse answer.

### 3. Smolagents-style few-shot system prompt actively hurts gemma4:e4b
Level D scored **33%** with faith=7%. The worked Thought/Action/Observation example confused the model into producing a single-line output instead of the requested numbered list. **smolagents-style scaffolding is not universally portable across model families** — gemma4:e4b's training distribution doesn't match.

### 4. Per-iteration curation hypothesis: PARTIALLY confirmed
Level E (post-tool synthesis nudge) and Level F (reframe-on-synthesis) both reach the capability ceiling. But so does Level B with no curation at all. The marginal value of curation is zero for tasks the model can already handle bare.

The real question is: **for the tasks where bare B fails, do E or F close the gap?** This probe doesn't answer that — every variant that doesn't add scaffolding (B, E, F) hit 100%. We need a second probe with a task that defeats bare B.

### 5. The methodology trap: "ambiguous task spec" can mask the real signal
The first run of this probe scored A=100% / B,D,E,F all ≈38%, leading to "hypothesis NOT supported." The cause: the task didn't specify `count=15`, so the model called the tool with default count=5 in B/D/E/F while A had all 15 inline. Fixing the task to say "top 15" reversed the ranking.

**Lesson**: when comparing curation strategies, hold information density constant across variants — otherwise faith-percentage differences reflect tool-arg choices, not synthesis quality.

## Investigation: where does the compressed-preview echo come from?

The advisor was right that the curator/architecture conclusion was premature — there's a bug. Methodical instrumentation on the C path found:

1. **G-4 fix at conversation thread IS working.** Instrumented `act.ts:914` (`DEBUG_TOOL_RESULT=1`):
   - `storedKey=_tool_result_1`, `fullFromScratchpad=2711 chars`, `resolvedContent.head=[{"id":47911350,"title":"Clay PCB Tutorial",...`
   - The `tool_result` message in the model's conversation thread has the full raw JSON.
2. **G-4 fix at curator IS working.** Captured the iteration-2 system prompt (`DEBUG_PROMPT=1`):
   - `Recent tool observations:\n<tool_output tool="get-hn-posts">\n[{"id":47911350,...}, ...]\n  ...truncated (711 chars). Full content available via recall("_tool_result_1").\n</tool_output>`
   - Truncated to maxChars=2000 per local tier — JSON is real, not preview.
3. **Output gate's synthesis call did NOT fire** in the failing run — model called `final-answer` itself with the preview-formatted string as the `output` argument.
4. **The literal phrase `[<tool> result — compressed preview]` is NOT in any captured prompt** (system + 3 think iterations). The model is producing it from somewhere.

### Lead: synthesis-retry feedback contains the exact echo phrase as a negative example

`arbitrator.ts:634`:
```typescript
const feedback = grounding.compressionEchoDetected
  ? `Your previous answer contained framework internal markers ... Do not echo any "[recall result — compressed preview]" or "Type: Array" structures — write a real synthesis.`
  : ...;
```

If the model previously emitted a compressed-preview-style answer that triggered `compressionEchoDetected`, this feedback gets injected. Local models often **literally copy negative-example strings** ("don't say X" → model outputs X). The model output (`[get-hn-posts result — compressed preview]`) is structurally derived from this example phrase but with the actual tool name substituted.

Need to confirm whether this feedback fired (capture pendingGuidance in iteration logs) and whether removing the literal example fixes the echo.

### Other open candidates

- Memory recall surfacing prior compressed previews into context (agent has `.withMemory()`)
- `pendingGuidance.errorRecovery` from synthesisQualityRetry being injected into a later think
- Some other code path constructing the preview phrase that DEBUG_PROMPT didn't capture (the iter=1 prompt only showed 3 conversation messages but the tool was already called — meaning there may be earlier ICS or context-engineering that injects context)

## Methodology lessons (preserve for future probes)

1. **Don't pivot to architecture from n=1.** Initial run had A=100%, B/D/E/F ≈ 38%. Looked like "tool calling kills synthesis." Was actually "task didn't specify count and bare B chose 5/15." Fixed task → B jumps to 100%.
2. **Both versions of the task are useful.** Ambiguous-count is exactly where curation would prove value. Keep both.
3. **D=33% verdict on smolagents needs the raw output checked** — the few-shot template literally says `FINAL: produce ONLY the answer`, model may have copied the literal `FINAL:` prefix and produced one line. Not a portability finding — a template-following finding.

## Diagnostic results — root cause found

Sequence of binary tests, each n=3:

### Test 1: Arbitrator-feedback hypothesis — RULED OUT
Removed the literal `"[recall result — compressed preview]"` quoted string from `arbitrator.ts:634` synthesisQualityRetry feedback. **3/3 runs still echoed.** Not the source.

### Test 2: Memory channel — RULED OUT
Built C without `.withMemory()`. **3/3 still echoed.** Memory recall isn't surfacing the preview format.

### Test 3: Provider-layer byte capture — DEFINITIVE
Instrumented `local.ts` `stream()` to scan every Ollama-bound message for `compressed preview`, `Type: Array`, or `Preview (first`. **0 matches across all 3 stream() calls.** The preview phrase is NOT in the bytes Ollama receives. The model is GENERATING this format, not echoing it.

### Test 4: Curator's "Recent observations" section — STRONG CONTRIBUTOR
Set `recentObservationsLimit: 0` (no curator-injected observations section). Results:
- Run 1: echoed
- Run 2: **CLEAN — perfect 15-line numbered list with all titles + scores**
- Run 3: echoed

So the curator section is one contributor; removing it makes correct synthesis *possible* but not consistent.

## Diagnosis

**The model is *generating* the preview format on its own, induced by the harness's bloated prompt structure.**

- Bare Ollama (B): system prompt is 1 sentence, conversation is `system + user + assistant + tool + assistant`. Hits 100% across runs.
- Harness (C): system prompt is **4463 chars** with sections for Meta-Tools Quick Reference, Environment, 14 Available Tools (most unused), 6 RULES, Progress, Guidance, Recent observations wrapped in `<tool_output>` XML tags, etc. The conversation thread is correct (full JSON in tool_result), but the system prompt's structural complexity steers the model toward a structurally-similar artificial output (Python-repr style `Type: Array(15) | Schema: ...`).

The exact phrase `[<tool> result — compressed preview]` is the model's *invented* attempt to format an answer in a way that "matches" the framework-style scaffolding it sees in the prompt. It's a fluent-but-wrong response shape because the prompt-shape itself is wrong.

This empirically confirms the user's hypothesis: **the harness is overcomplicating things and that overcomplication is what makes capable models fail.** The model isn't broken. The prompt is.

## Implication for the path forward

The curator architecture goal is right but the framing was wrong. The curator's job isn't to "add per-iteration scaffolding" — it's to **subtract noise from the prompt**. Specifically for local tier:

1. **System prompt should be minimal** — task + tools + (optional) one-line rule about tool usage. No environment dump, no meta-tools quick reference unless the model used a meta-tool, no rules unless violated.
2. **No "Recent observations" section** when the conversation thread already carries the data.
3. **No XML wrapper** (`<tool_output>`) on tool results — adds noise, primes structural-style outputs.
4. **No truncation hint** that says "use recall(...)" if the model can't reliably do that.
5. **Tier-aware**: frontier models can handle (and benefit from) richer prompts. Local models need bare-bones.

The probe data establishes the empirical baseline. Next: a single-PR experiment that reduces local-tier system prompt to ~500 chars and re-runs C three times. Target is to consistently match B's 100%.

## Methodology lessons (preserve for future probes)

1. **Don't pivot to architecture from n=1.** Initial run had A=100%, B/D/E/F ≈ 38%. Looked like "tool calling kills synthesis." Was actually "task didn't specify count and bare B chose 5/15." Fixed task → B jumps to 100%.
2. **Run n=3 minimum at every fix step.** Three runs revealed the per-run instability (Run 2 produced perfect output even with the harness when the recent-observations section was removed) — n=1 would have called the fix dead.
3. **Instrument the bytes, not the abstractions.** Conversation-thread debug (DEBUG_TOOL_RESULT) showed the right data, prompt-builder debug (DEBUG_PROMPT) showed the right prompt, but the symptom persisted. Provider-layer byte capture was what conclusively ruled out "echo from prompt" and pointed at "model generates from prompt-shape."

## Test 5: Minimal-prompt experiment — partial fix, more noise found

Added `RA_MINIMAL_PROMPT=1` to `context-manager.ts` `buildIterationSystemPrompt()` and `context-curator.ts` (skip recent-observations section). This bypasses Environment, RULES, Progress, Prior Work, Guidance, Recent Observations sections — emits only `Tools:\n- name(params)\n...\n\nTask: ...`.

Provider-layer byte capture revealed two more noise floors that minimal-prompt didn't address:

### Tool-list pollution (the larger noise)
The user registered **1 tool** (`get-hn-posts`). Ollama actually receives **14 tools** in the first stream call:
```
Tools:
- web-search(query: string, maxResults: number?)
- crypto-price(coins: array, currency: string?)
- http-get(url: string, headers: object?)
- file-read(path: string, encoding: string?)
- file-write(path: string, content: string, encoding: string?)
- code-execute(code: string, language: string?)
- git-cli(command: string)
- gh-cli(command: string)
- gws-cli(command: string)
- get-hn-posts(count: number)        ← the only one user asked for
- brief(section: string?)
- pulse(question: string?)
- recall(...)
- find(query: string, scope: string?)
```

These come from `packages/tools/src/skills/builtin.ts` (`builtinTools` array — 9 capability tools auto-registered) plus `metaToolDefinitions` (brief/find/pulse/recall/etc — registered by the kernel for self-management).

Bare Ollama (B=100%) sees **only 1 tool**. This 14× signal-to-noise difference is significant.

### Task duplication
The same task string is sent in both system prompt AND user message — pure redundancy.

### Tool-list narrowing on "stuck" guidance can prematurely force final-answer
After 2 think iterations with no progress, the harness:
- Trims the tool list to only `final-answer` (1 tool)
- Injects "[Harness] IMPORTANT: You appear to be stuck repeating the same reasoning..."

The model then calls `final-answer(output: "[get-hn-posts result — compressed preview]\nType: Array(15) | Schema: ...")` because it's been told it's stuck and only final-answer remains. With richer tool options it might have called more tools or self-corrected. With `final-answer` as the only escape and "stuck" pressure, it dumps a JSON-shape summary as the answer.

### Minimal-prompt n=3 results

With `RA_MINIMAL_PROMPT=1`, no `.withMemory()`, default tier:
- Run 1: echoed (`Preview (first 5)`)
- Run 2: echoed (`Preview (first 5)`)
- Run 3: **PERFECT 100% — 15/15 titles, 15/15 scores, 15 numbered lines**

Improvement from baseline C (0/3 perfect) to 1/3 perfect — same as removing recent-observations alone. Removing the system-prompt sections wasn't the key signal; the tool-list bloat and "stuck" pressure are bigger factors.

## Curator architecture sketch — signal optimizer per iteration

The user's framing: *"context curation should be boosting and optimizing the prompt signals — removing what reduces signal, adding what enhances it, removing the noise."*

A Curator that operationalizes this for local tier:

| Signal | Default | Curator decision |
|--------|---------|------------------|
| Task | always | keep (in user message only — drop from system prompt) |
| User-registered tools | always | keep |
| Auto-registered capability tools (web-search, crypto-price, …) | currently always | **drop unless used** |
| Meta-tools (recall, brief, pulse, find, checkpoint, …) | currently always | **drop unless model has invoked one** (lazy registration) |
| `final-answer` tool | always present | keep but don't inject as the *only* tool when stuck |
| `<tool_output>` XML wrapper around observations | currently always | **drop for trusted user-registered tools** |
| RULES block (4-7 verbose rules) | currently always | **drop unless violation observed** (then targeted reminder) |
| Environment dump (date/time/timezone/platform) | currently always | **drop unless task references temporal/platform context** |
| Recent observations duplicate | currently always | **drop when conversation thread already carries the data** |
| Progress section | always when tools used | keep terse (one line) |
| "Stuck" guidance | aggressive (2-iter trigger) | **soften** — provide guidance but don't narrow tools to final-answer-only |

The principle: **start from minimum, add only what THIS iteration needs based on observed state**. Each addition pays a token tax AND a noise tax. The curator chooses additions based on:
1. Did the model violate a rule? → add the specific rule
2. Did the model invoke a meta-tool? → add other meta-tools to the schema list
3. Is the task time-sensitive? → add environment context
4. Is the model stuck? → add a softer hint, not a tool-list narrowing

## Next steps

1. **Cross-reference with other open-source frameworks** before designing the curator interface — DONE. See `oss-prompt-curation-research-2026-04-26.md`. Key adoption pattern: Pydantic AI's `Toolset.get_tools(ctx)` per-step rebuild + stable-ref prompt-part rewriting.
2. **Build a tool-list curation pass** as the highest-impact change — currently 14×-too-large by default — IMPLEMENTED behind `RA_LAZY_TOOLS=1`. See "Test 6" below.
3. **Soften "stuck" guidance** so it doesn't narrow tools to `final-answer` alone — pending
4. **Drop task duplication** between system prompt and user message — pending
5. After all four: re-run task-quality-gate. Target: 5/5 tasks at ≥90% on gemma4:e4b without per-task tuning

## Test 6: discover-tools + lazy schema disclosure — 2/3 perfect

Implementation:
- New meta-tool `discover-tools` (`packages/tools/src/skills/discover-tools.ts`) — lists registered tools, optionally ranked by query, marks discovered names in a per-run `Set<string>` ref.
- `discoveredToolsStoreRef` exported from `@reactive-agents/tools` so the kernel can read it.
- `tool-capabilities.ts` registers `discover-tools` when `RA_LAZY_TOOLS=1` is set; resets the discovered set per run.
- `think.ts` schema-pruning: when `RA_LAZY_TOOLS=1`, **always prune** to `requiredTools ∪ relevantTools ∪ state.toolsUsed ∪ discovered ∪ META_TOOL_SET`. No `PRUNE_MIN_TOOLS` gate, no classification requirement. Pydantic-AI-style per-iteration `get_tools(ctx)`.

Results (gemma4:e4b, n=3 each):

| Mode | Composite |
|------|-----------|
| Baseline C (no flags) | 0/3 perfect |
| `RA_MINIMAL_PROMPT=1` only | 1/3 perfect |
| **`RA_LAZY_TOOLS=1` only** | **2/3 perfect** |
| `RA_LAZY_TOOLS=1` + `RA_MINIMAL_PROMPT=1` | 2/3 perfect |

Tool-list curation alone explains most of the win — minimal-prompt sections add little on top once tools are lazy-disclosed.

The remaining 1/3 failure mode is identical across the failing runs: model echoes `[get-hn-posts result — compressed preview]\nType: Array(15) | Schema: ...\nPreview (first 5):...`. This is the **stuck-pressure-narrowing** path: when iterations stall, the harness narrows tools to `final-answer` only AND injects "[Harness] You appear to be stuck repeating the same reasoning". The model then calls `final-answer(output: <JSON-summary-shape>)`. Tool-list curation doesn't help here because the harness *deliberately* narrows the list at this point.

## Step 3 (next) — violation-triggered rules + soften stuck handling

Per the OSS research recommendation 11: rules block should be omitted by default, injected only when a specific violation is observed. Combine with: when stalled, surface a **soft hint** instead of narrowing tools to final-answer-only. Validate this closes the remaining 1/3 gap.

## Test 7: Step 3 changes — 5/5 perfect, B-parity achieved

Implementation:
- `context-engine.ts buildStaticContext()` — when `RA_LAZY_TOOLS=1`, omit Environment + RULES sections by default. Restore them on observed violations (curator hook for future iterations).
- `think.ts` — when lazy mode is active, **bypass the pressure-narrow-to-final-answer-only path**. The curator's filtered set already includes `state.toolsUsed`, so the model can always re-invoke tools it's used. Narrowing to final-answer-only on local models induces panic dumps when fired prematurely.
- `stall-detector.ts` — rewrote the stall nudge text. Old: `"...call final-answer with what you know so far"` (primed JSON-shape dump). New: `"...the tool observations above contain the actual data — read the specific values from them and write the answer in the format the user requested. If you need additional information, call a tool you haven't used yet."` Points at observations as source of truth, doesn't prime panic-dump.
- **Root cause of pressure-narrowing fired prematurely**: `CONTEXT_PROFILES.local.maxTokens = 4096` was hardcoded. Pressure threshold for local is 0.80, so narrowing fired at 3277 tokens — any non-trivial tool result trips it. Bumped to 32768 to match the conservative probe ceiling. The dynamic Ollama probe already returns 32K-128K for any modern model; this default just ensures the gate doesn't fire prematurely even before per-run probe-derived overrides land in the profile.

Results (gemma4:e4b, n=5):

| Mode | Perfect runs |
|------|--------------|
| Baseline C (no flags) | 0/3 |
| `RA_MINIMAL_PROMPT=1` only | 1/3 |
| `RA_LAZY_TOOLS=1` only (Step 1+2) | 2/3 |
| **`RA_LAZY_TOOLS=1` + Step 3 fixes** | **5/5** |

This achieves bare-Ollama parity (Level B = 100%). The harness no longer over-scaffolds the model into producing a structurally-summarized JSON-shape final answer.

## Chat mode treatment — verified separate, no interference

- **Direct chat path** (`directChat`, conversational messages): unchanged — sliding chat history + compact contextSummary as system prompt. No tool schemas, no kernel, no per-iteration curation. Already minimal.
- **Tool-capable chat path** (`react-loop`, imperative messages): chat history is *flattened* into the agent run's task string (only `_lastDebrief` + `_lastRunObservations` summarized in). Then the kernel runs fresh — our lazy curator applies normally without intermixing with chat history.
- **Implication**: the two are deliberately separated. Chat history = multi-turn session state. Agent thread = single-run reasoning trace. Our changes don't conflict.
- **Open future question** (acknowledged backlog): when chat routes to react-loop, only the LAST debrief is surfaced to the agent. Earlier chat turns are lost across tool-using turns. This becomes a real limitation when sessions get longer and the agent needs full task + debrief lineage. Revisit as part of an "agent sessions" iteration — sessions should preserve the running task context AND debrief chain, not just the most recent run's summary. Tracked as a follow-up; not blocking the curator work.

## Step 4: full task-quality-gate validation, gemma4:e4b

Comparison vs the pre-fix baseline (`task-quality-gate-findings-2026-04-26.md`):

| Task | Baseline (no flags) | Step 3 (`RA_LAZY_TOOLS=1`) | Δ |
|------|---------------------|----------------------------|---|
| T1-knowledge-recall (no tools) | 100% | **100%** | 0 |
| T2-single-tool-synthesis | 2% (★ catastrophic) | **100%** | **+98** |
| T3-selective-filter | 35% | **78%** | **+43** |
| T4-multi-criteria | 30% | 48% | +18 |
| T5-long-form-synthesis | 9% (★ catastrophic) | 32% | +23 |
| **Average composite** | **35%** | **72%** | **+37** |

- **No regressions.** T1 (no tools) still 100%.
- **T2 catastrophic → perfect.** The class of task that originally exposed the bug now hits 100%. Same for the focused HN probe (n=5 perfect).
- **T3 strong improvement** (+43 pts). Selective filter task is mostly working.
- **T4 + T5 still struggle.** These are harder tasks (multi-criteria synthesis with two sections, long-form thematic clustering) — failure modes are no longer "preview-echo on a simple task" but more like "model didn't execute the multi-step synthesis instruction":
  - **T4** (composite 48%): faith=33% (only cited 5 of 6 required titles), format=0% (didn't produce both `## Highest Score` and `## Most Comments` sections). The model is doing single-section synthesis instead of two-section.
  - **T5** (composite 32%): still shows tool-preview echo on this run. Format=20% (no `# Today on Hacker News` title). Long-form thematic categorization is a much harder synthesis pattern — the model defaults to structural-summary mode under that load.

These remaining failures look like genuine model-capability ceilings on gemma4:e4b for harder synthesis patterns, not over-scaffolding. They're the right next thing to study but are not blockers — the previously-broken simple synthesis class now works.

## Step A: Promoted lazy curation to default-on (2026-04-26)

Flipped all four `process.env.RA_LAZY_TOOLS === "1"` checks to `!== "0"` (default-on, opt-out). Files touched:
- `packages/reasoning/src/kernel/capabilities/act/tool-capabilities.ts`
- `packages/reasoning/src/kernel/capabilities/reason/think.ts` (×2 sites)
- `packages/reasoning/src/context/context-engine.ts`
- `packages/reasoning/src/context/context-curator.ts`

Final task-quality-gate run with default-on (no env flag):

| Task | Baseline | RA_LAZY_TOOLS=1 (Step 3) | **Default-on (final)** |
|------|----------|--------------------------|------------------------|
| T1-knowledge-recall | 100% | 100% | **100%** |
| T2-single-tool-synthesis | 2% (★ catastrophic) | 100% | **100%** |
| T3-selective-filter | 35% | 78% | **78%** |
| T4-multi-criteria | 30% | 48% | **100%** ★ |
| T5-long-form-synthesis | 9% (★ catastrophic) | 32% | **60%** |
| **Average composite** | **35%** | **72%** | **88%** |

**2.5× quality improvement** vs baseline. No regressions on non-tool tasks.

## Step B: T4/T5 deeper diagnosis — model behavior, not curation

Provider-byte capture on a failing T5 run (`DEBUG_OLLAMA_BYTES`):
- **5 LLM calls total** (3 stream + 2 complete)
- **0 of them contained the preview phrase** in any message
- Yet the model output IS the preview format with REAL specific values substituted

The model is **GENERATING our framework's `[<tool> result — compressed preview]\nType: Array(N) | Schema: ...\nPreview (first M):\n  [i] key=value...` format completely from training/internal patterns** — likely a "summarize array data" pattern from training data that happens to look like our framework's compressed output.

This is NOT a prompt-curation issue. We've conclusively shown:
- The conversation thread carries the full JSON (G-4 fix verified working)
- The system prompt has no preview text
- Even the synthesis-time `complete()` call has no preview text in its prompt
- The model still produces the format from scratch

The verifier (`validateGeneralizedGrounding` / `compressionEchoDetected` regex) DOES detect this, but the `synthesisQualityRetry` path appears to either not fire or only retry once before accepting the bad answer. **Tightening the verifier-driven retry is the right next step for T4/T5** — likely:
1. More aggressive retry (≥2 attempts before accepting echo)
2. Better retry feedback that doesn't quote bad strings as negative examples (already partially fixed in Step 3)
3. Possibly: detect the echo at the streaming layer and abort + retry inline

This is tracked as a follow-up; the curator work itself is complete. Further wins on T4/T5 will come from verifier tuning, not prompt engineering.

## Open work (post-curator)

1. **Verifier-driven retry tightening** for T4/T5 — see Step B above.
2. **Stable-key prompt-part rewriting** (Pydantic AI `dynamic_ref`) — last item from original step plan. Not urgent; an optimization.
3. **Chat session lineage** — preserve task + debrief chain across tool-using chat turns (acknowledged backlog).
4. **Capability-derived `maxTokens`** — wire `capability.recommendedNumCtx` into the per-run profile so the static 32K default is replaced by the model's actual ctx when probed.
5. **`discover-tools` registration only when there are MORE registered tools than what's already visible** — minor optimization to avoid the noise when a user registered exactly the tools they need.

## Open work

1. **Promote lazy curation to default** — switch the env-flag to a feature flag in `ContextProfile`, then flip the default after one more validation pass.
2. **T4/T5 follow-up** — instrument these specifically. Hypothesis: harder synthesis tasks trigger the stall handler more often, and even our softened nudge may push the model toward early termination. Worth a per-iteration prompt capture.
3. **Stable-key prompt-part rewriting** (Pydantic AI's `dynamic_ref` pattern) — last item from the original step plan. Not urgent; an optimization, not a fix.
4. **Chat session lineage** (acknowledged backlog above) — preserve task + debrief chain across tool-using chat turns.
5. **Capability-derived `maxTokens`** — wire `capability.recommendedNumCtx` into the per-run profile so the static 32K default is replaced by the actual model's real context window when known.
