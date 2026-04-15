# Harness Improvement Report — Multi-Model Pass 1

## Session Header

| Field | Value |
|-------|-------|
| Pass number | multi-model-1 |
| Date | 2026-04-14 |
| Focus area | weak-model harness adaptation (cogito, qwen3:4b, gemma4:e4b) |
| Probes run | scratch.ts (cogito convergence + subagent), multi-model-test (efficiency, accuracy/reasoning/output, tools/intelligence/robustness, convergence/strategy/subagent) |
| Changes since last pass | first multi-model improvement pass |
| Driver script | `.agents/skills/harness-improvement-loop/scripts/multi-model-test.ts` |

## Models Tested

| Model | Tier | Notes |
|-------|------|-------|
| gemma4:e4b | local | Calibrated, parallel reliable, strong system attention |
| cogito | local | 8B, no native FC reliability (emits pseudo-code) |
| qwen3:4b | local | 4B, sequential FC |

## Issues Identified and Fixed

### Issue #1 — Required tools hidden behind final-answer-only narrow gate

**Symptom:** `Available Tools: - final-answer(...)` shown to model from iter 4+ even when required tools (web-search, code-execute) were still pending. Created an unsatisfiable state — model nudged to call missing tools but couldn't see them.

**Root cause:** `shouldNarrowToFinalAnswerOnly` in `phases/think.ts` compared cumulative `state.tokens` to the context-window `maxTokens` (4096 for local tier). After 3 iterations cumulative usage exceeded the 0.80 threshold, narrowing schemas to just final-answer.

**Fix:** Skip the narrow gate when `getMissingRequiredToolsFromSteps()` returns non-empty. Context pressure is real but the fix is compression, not hiding required tools.

**Result:** All iterations now show the full required tool list. Same probe went from `missing_required_tool` failure to actually executing the tools.

### Issue #2 — Pseudo-code tool calls ignored on weak models

**Symptom:** Cogito emitted ```javascript blocks containing fake tool calls like `web-search(query: "XRP", maxResults: 1)`, but native FC tokens were absent. Resolver returned `final_answer` (text only), so the harness never executed the calls.

**Root cause:** `NativeFCStrategy.extract()` only had two paths: native `tool_calls` array and fenced JSON. No fallback for `tool-name(key: value, ...)` syntax that small Ollama models tend to emit.

**Fix:** Added `extractPseudoCodeToolCalls()` as third-tier fallback in `native-fc-strategy.ts`. Only matches inside fenced blocks (so narrative prose like "I'll use web-search to..." is ignored). String-aware paren balancing, supports `key:value` and `key=value` syntax, plus positional single-arg form for code execution payloads. 7 new unit tests.

**Result:** Cogito's pseudo-code now executes as real tool calls. Web-search ran 4× / 919ms avg on the multi-currency probe.

### Issue #3 — Classifier over-required tools for factual-knowledge questions

**Symptom:** "What is the speed of light?" classified as needing `code-execute`. Cogito then thrashed for 16 iterations / 12,375 tokens trying to satisfy the requirement.

**Root cause:** Classifier prompt said "required = tools that MUST be called" but didn't carve out a clear exception for knowledge questions answerable from training data.

**Fix:** Two-part prompt update in `infer-required-tools.ts`:
1. **Factual-knowledge rule**: "what is X / explain Y / define Z / who-when-where" → required: [] (with 4 canonical examples)
2. **Explicit-mention override**: "use X / ask X / delegate to X" → X is required regardless of question shape

**Result:**
- "What is the speed of light?" → 1 iter / 1709 tok (was 16 / 12,375), correct answer from cogito's knowledge
- "Use your research-assistant to explain linked lists" → still correctly required research-assistant

### Issue #4 — Agent-tool input parameter typed as object → schema metadata leak

**Symptom:** Cogito called the `research-assistant` agent-tool with `{"input":{"type":"object"}}` — copying the JSON Schema metadata as the value. Sub-agent ran with `JSON.stringify({type:"object"})` as the task and produced generic content.

**Root cause:** `deriveInputSchemaFromCapabilities()` typed the `input` parameter as `"object"` with description "Accepts a string OR an object with 'query' field". Mixed signals confused weak models, and `type: "object"` invited the schema-as-value mistake.

**Fix:** Changed `input` to `type: "string"`, `required: true`, with concrete example. The sub-agent executor already handled string input as the primary path.

**Result:** cogito Static subagent test went from 20 iters / 10,227 tok / failed to 6 iters / 3,324 tok / passed with a real linked-list explanation.

## Final Multi-Model Status

| Category | gemma4:e4b | cogito | qwen3:4b |
|----------|-----------|--------|----------|
| efficiency | 7/7 (100%) | 7/7 (100%) | 7/7 (100%) |
| accuracy/reasoning/output | 11/11 (100%) | 9/11 (82%)* | 10/11 (91%)* |
| tools/intelligence/robustness | 11/11 (100%) | 11/11 (100%) | 11/11 (100%) |
| convergence/strategy/subagent | 11/11 (100%) | 10/11 (91%)** | 10/11 (91%)** |

*Two model-knowledge failures (TypeScript release year `/2012/`) — not harness issues.
**Cogito Dynamic subagent: 16 iters, didn't compute 120 (factorial of 5). Qwen3:4b Static subagent: 14 iters (over 12 budget) but completed correctly. Open follow-ups.

## Test Coverage

- `packages/tools/tests/tool-calling/native-fc-strategy.test.ts`: 27 pass (was 20, +7 pseudo-code)
- `packages/reasoning/tests/strategies/kernel/utils/tier-guard-config.test.ts`: 23 pass (was 17, +6 resolveMaxSameTool)
- Full reasoning + tools suites: 1427 pass / 0 fail
- Whole repo: 3921 pass / 22 skip / 0 fail (last full run)

## Open Follow-ups

1. **Post-subagent-return parent looping**: After a sub-agent returns a complete answer, the parent doesn't always recognize task completion and oracle-nudges into extra iterations. Affects qwen3:4b Static (14/12 over) and cogito Dynamic.
2. **Dynamic subagent on cogito**: 16 iters with no tool call observed — cogito may not be invoking spawn-agent at all. Needs targeted probe.
3. **Classifier improvement metric drift**: Currently we update the prompt and re-test. A regression-test suite for the classifier (with fixture tasks and expected required/relevant outputs) would catch over-eager classifications earlier.

## Next Pass Targets

- Probe `robustness` and `subagent` categories with deeper traces to fix the post-return looping pattern.
- Add `parallelCallCapability` empirical-update from per-run observations (was discussed but not implemented).
- Run the full 30+ test suite per model once subagent regression is closed.
