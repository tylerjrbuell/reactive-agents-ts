# Harness Improvement Report — Multi-Model Pass 2

## Session Header

| Field | Value |
|-------|-------|
| Pass number | multi-model-2 |
| Date | 2026-04-15 |
| Focus area | post-subagent-return parent looping + nameless-JSON tool calls |
| Probes run | scratch.ts (qwen3:4b static subagent, cogito dynamic subagent), multi-model-test (convergence+strategy+subagent, accuracy+reasoning+tools+intelligence+robustness) |
| Follow-up to | Pass 1 (2026-04-14) |
| Driver script | `.agents/skills/harness-improvement-loop/scripts/multi-model-test.ts` |

## Issue Identified and Fixed

### Issue #5 — Nameless JSON tool calls from weak models

**Symptom:** On the Dynamic subagent test, cogito output full `spawn-agent` argument JSON inside a fenced block but never identified the tool:

```json
{
  "task": "Calculate 5!",
  "name": "factorial-calculator",
  "role": "mathematician",
  "tools": ["code-execute"]
}
```

The model inferred "you have a spawn-agent tool, here are the args" and trusted the harness to route. Without a `name`/`tool` field the resolver dropped it, the kernel saw pure thinking, 6 consecutive no-tool iterations triggered loop-detection failure.

**Root cause:** The `ToolCallResolver.resolve()` signature only received tool *names*, so there was no way to attempt parameter-shape matching. The three existing fallback tiers (native FC → fenced JSON with name field → pseudo-code `tool-name(args)`) all required explicit tool identification.

**Fix:**

1. **Widened the resolver contract** (`types.ts`):
   `readonly { name: string }[]` → `readonly ResolverToolHint[]` where each hint carries optional `paramNames: readonly string[]`.
2. **Plumbed parameter names through `think.ts`**:
   `{ name }` → `{ name, paramNames: ts.parameters?.map(p => p.name) ?? [] }`.
3. **Added fourth-tier fallback `toToolCallSpecByShape()`** in `native-fc-strategy.ts`:
   - Require ALL JSON keys to exist in a tool's declared parameter set
   - Require at least one real overlap
   - Require exactly one candidate tool (ambiguous matches → reject)
4. **4 new unit tests**: happy path, ambiguous rejection, unknown-keys rejection, missing-paramNames disables fallback.

**Result (cogito Dynamic subagent probe):**

| Metric | Before | After |
|---|---|---|
| Iterations | 15 (loop-detected failure) | **6** |
| Tokens | 15,873 | **5,536** (−65%) |
| Tool calls | 0 | spawn-agent + final-answer |
| Output | error message | `"120"` (correct) |

## Multi-Model Pass 2 Final Status

### Convergence + Strategy + Subagent (9 tests/model)

| Model | Pass 1 | Pass 2 |
|-------|--------|--------|
| gemma4:e4b | 11/11 (100%) | **11/11 (100%)** |
| cogito | 9/11 (82%) | **11/11 (100%)** ✓ |
| qwen3:4b | 10/11 (91%) | **11/11 (100%)** ✓ |

### Accuracy + Reasoning + Tools + Intelligence + Robustness (15 tests/model)

| Model | Pass 2 | Remaining failures |
|-------|--------|--------|
| gemma4:e4b | 17/17 (100%) | — |
| cogito | 16/17 (94%) | Multi-part question: didn't list Australia/Oceania (model knowledge, not harness) |
| qwen3:4b | 16/17 (94%) | Same multi-part question failure |

## Test Coverage

- `packages/tools/tests/tool-calling/native-fc-strategy.test.ts`: **31 pass** (was 27, +4 shape-match tests)
- Full suite: **3925 pass / 22 skip / 0 fail** (up from 3921)

## Cumulative Passes 1+2 — What the Harness Now Handles

1. **Required tools always visible** — pressure-narrow gate only fires when required tools are satisfied
2. **Native FC tokens** — canonical path
3. **Fenced JSON with name field** — `{"name": "web-search", "arguments": {...}}`
4. **Pseudo-code call syntax** — `tool-name(key: value, ...)` inside fenced blocks
5. **Nameless JSON with shape match** — `{"task": "...", "name": "...", ...}` → `spawn-agent`
6. **Factual-knowledge questions** — classifier returns `required: []`
7. **Explicit tool mentions** — "use/ask/delegate to X" → X is required
8. **Subagent input** — typed as required `string`, no schema-metadata leak

## Open Follow-ups

1. **Parallel-call calibration from observed runs** — still pending from pass 1. Worth implementing now that harness correctly routes all tool-call shapes.
2. **Classifier regression suite** — fixture-based tests for "should require X" / "should NOT require Y" to catch over-eager classifications.
3. **Deeper probe: `accuracy` + Multi-part question** — gemma4:e4b 100%, others 94%. May be a prompt-framing issue (test expects all continents listed when model gave a subset).

## Next Pass Targets

- Empirical `parallelCallCapability` update after N runs (previously discussed, now appropriate since the harness reliably routes weak-model outputs)
- Run full 33-test suite (all categories) per model for a true end-to-end baseline
- Investigate whether `plan-execute-reflect` strategy benefits similarly from these fallback chains
