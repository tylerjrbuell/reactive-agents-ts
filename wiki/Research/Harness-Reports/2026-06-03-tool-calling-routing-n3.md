---
title: Tool-Calling Routing — Capability-First Stage A Validation (N=3 local)
date: 2026-06-03
type: harness-report
status: stage-A-passed (local); cloud-tier deferred
related:
  - "[[2026-06-03-tool-calling-driver-redesign]]"
  - "[[Framework-Architecture-Index]]"
tags: [harness-report, tool-calling, regression, validation, ollama]
---

# Tool-Calling Routing — Capability-First Stage A Validation

Validates the Stage-A fix (commit `11996c5a`) that keys the tool-calling driver
on `capabilities.supportsToolCalling` instead of `calibration.toolCallDialect`,
re-aligning it with the resolver injection and tools-attach (the coherent
triple). Spec: [[2026-06-03-tool-calling-driver-redesign]].

## Repro harness

`apps/examples/spot-test.ts`, Ollama, strategy `reactive`, switching off.
Task: *"Write a file ./hello.txt containing exactly the text: Hello World"*,
`SPOT_TOOLS=file-write` (local-only, no docker/MCP). One required tool call.

## Gate 1 — regression repro flips (PASS)

| | toolCalls | success | terminatedBy | iters/steps | tokens |
|---|---|---|---|---|---|
| **Before (HEAD `152b6e59`, gemma4:e4b)** | `[]` | **false** | max_iterations | 21 | 13000 |
| **After (`11996c5a`, gemma4:e4b)** | `[file-write, final-answer]` | **true** | final_answer_tool | 6 | 4594 |

Before, the model emitted the *correct* TextParseDriver format
(`<tool_call>\ntool: file-write\npath: ./hello.txt\ncontent: Hello World\n</tool_call>`)
and it was rendered as the `error`/output (the wrong-answer face) while the loop
ran 21 times (the loop face). After, the model emits native FC events the
resolver executes.

## Gate 1b — local stability N=3 (PASS)

gemma4:e4b, identical task, 3 consecutive runs:

| run | success | terminatedBy | toolCalls | steps | tokens |
|---|---|---|---|---|---|
| 1 | true | final_answer_tool | file-write, final-answer | 6 | 4603 |
| 2 | true | final_answer_tool | file-write, final-answer | 6 | 4605 |
| 3 | true | final_answer_tool | file-write, final-answer | 6 | 4593 |

3/3 success, tight variance (4593–4605 tok). Stable.

## Cross-model characterization (the Ollama-capability-lie boundary)

Ollama's `capabilities()` returns `supportsToolCalling: true` for **every** model
unconditionally (`local.ts:951`). Capability-first therefore routes every Ollama
model to native — correct for models that genuinely support tools, exposed-as-error
for those that don't. Direct probe `POST /api/chat` with a `tools` array
distinguishes them:

| model | Ollama `tools` support | before (482c11e4) | after (`11996c5a`) | verdict |
|---|---|---|---|---|
| gemma4:e4b | ✅ supported | loop 21/13k/fail | **success 6-step/4.6k** | **fixed** |
| cogito:14b | ✅ supported | (482c11e4's trigger) | **success, file-write called** | **fixed** |
| gemma3:12b | ❌ `"does not support tools"` | silent loop 13k/garbage | `llm_error` 1.4s/0 tok | fail-fast (see below) |

**cogito:14b** — the model whose gateway stall *motivated* `482c11e4` — works
under capability-first (native FC executes). `482c11e4`'s text-parse "fix" for it
never actually executed (text-parse had no think→acting transition), so this is
the first time cogito's tool call lands.

**gemma3:12b** — genuinely lacks Ollama tool support. Under capability-first it
gets native `tools`, Ollama rejects with
`"registry.ollama.ai/library/gemma3:12b does not support tools"`, surfaced as a
**fast, loud `llm_error`** (1.4s, 0 tokens) — vs `482c11e4`'s silent 13k-token
loop returning garbage. This is the **pre-482c11e4 behavior restored** (native-for-all
always errored on this model class) and is a net improvement (fail-fast > silent
garbage). The genuine fix is **Stage B**: narrow `local.ts:951` to a per-model
`/api/show` probe so gemma3:12b reports `false` → routes to the (Stage-B-completed)
text-parse path. Documented broken-until-Stage-B; not a Stage-A blocker.

## Gate 2 — native model unaffected (PASS, by construction + local proof)

The change flips only the uncalibrated/`none` branch from text-parse→native.
Already-native models (calibrated `native-fc`, all cloud providers) were native
before and remain native — a structural no-op for them. gemma4:e4b and cogito:14b
serve as live native-path witnesses.

## Gate 3 — cross-tier N=3 (PARTIAL: local proven, cloud deferred)

Local tier proven (above). **Mid/cloud tiers not run here — no API keys present
in this environment** (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY` all
unset). Cloud verification is deferred to a keyed environment / CI bench. Risk is
low: the change is a no-op for native-calibrated cloud models (they never hit the
flipped branch). Recommend a single cloud `reactive` run before the branch merges
to close the gate formally.

## Suites (PASS)

`tools` 819/0 · `reasoning` 1576/0 · `runtime` 907/0 (1 pre-existing skip).
`tools`+`reasoning` typecheck clean.

## Verdict

**Stage A regression killed for tool-capable models; net-positive for
tool-incapable models (fail-fast).** Local gate fully green. Cloud-tier gate
deferred to a keyed run. Stage B (capability honesty + text-parse completion)
remains the path to make tool-*incapable* Ollama models work.
