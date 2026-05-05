# Cross-Model Failure-Mode Analysis (8 models × 5 tasks)

**Date:** 2026-04-26
**Models:** gemma4:e4b, qwen3:14b, qwen3.5:latest, llama3.1:latest, cogito:14b, cogito:latest, granite3.3:latest, gpt-oss:latest
**Test:** task-quality-gate.ts (T1–T5), default flags (RA_LAZY_TOOLS on)

## Headline scoreboard

| Model | T1 | T2 | T3 | T4 | T5 | Avg |
|-------|----|----|----|----|----|-----|
| **qwen3.5:latest** | 100 | 65 (raw-json) | 77 | 91 | **88** | **84%** |
| qwen3:14b | 100 | 100 | 77 | 100 | 37 (garbage) | 83% |
| cogito:latest | 100 | 65 | 88 | 100 | 59 | 83% |
| gemma4:e4b | 100 | 79 | 77 | 91 | 37 (garbage) | 77% |
| cogito:14b | 100 | 100 | 67 | 30 (fw-json-dump) | 67 (fab) | 73% |
| llama3.1:latest | 100 | 30 (stuck) | 57 | 30 (stuck) | 37 (stuck) | 51% |
| gpt-oss:latest | 100 | 30 (veto) | 35 (veto) | 30 (stuck) | 37 (loop-det) | 46% |
| granite3.3:latest | 72 (LLM-err) | 30 (LLM-err) | 35 (LLM-err) | 30 (LLM-err) | 37 (LLM-err) | **41%** |

T1 (no tools) succeeds for everyone except granite. Spread is on tool-using tasks.

## What the failures actually are — and where they live

The original "failure-mode" classifier surfaced `no-tool-called` as the most-common failure (16/35 cells). **That's a recording bug, not a real failure** — every `result.toolCalls` is `[]` even on successful runs. Real failure modes, ranked:

### A. Harness-side root causes (HIGH IMPACT)

These hit multiple models and represent harness defects, not model quirks:

**A1. Granite "does not support thinking" — pure framework bug. 5/5 of granite's tasks failed with `LLM stream failed at iteration 0: Ollama request failed: "granite3.3:latest" does not support thinking`.** The framework is requesting `think: true` for a model whose Ollama capability list doesn't include `thinking`. **Fix**: probe-once `supportsThinking` from `/api/show.capabilities` (we already do this — just need to actually consult it before sending `think: true`).

**A2. Required-tools classifier over-specifies. `gpt-oss:latest / T4`** received `required=[web-search, crypto-price, http-get×3]` for a Hacker News task. The classifier inferred FIVE unrelated required tools, then the dispatcher early-stopped because the model couldn't satisfy them. Same root cause for `llama3.1 / T2, T4, T5` — all stuck on `missing_required_tool`. **Fix**: classifier should produce 0–1 required tools for tasks that have one obvious tool registered, OR validate inferred tools against the actually-registered set.

**A3. Stall detector too aggressive for some models. `gpt-oss:latest / T2` and `T3`** both terminated via `controller_signal_veto: 2 stall-detect, with tool-failure evidence` — the veto fired after 2 stall events. Some models (gpt-oss especially) reason silently for several seconds before producing tokens, which the stall detector reads as "stuck". **Fix**: per-model stall-threshold calibration, OR change stall-detect from "thoughts repeated" to "no progress in N seconds", which is more model-agnostic.

**A4. Output-gate edge cases producing garbage on T5.** `gemma4:e4b / T5` output `.<channel|>`. `qwen3:14b / T5` output `./today-on-hacker-news.md`. These look like model artifacts (gpt-style channel tokens, filename strings) leaking through the output gate without sanitization or fallback synthesis. **Fix**: when output is <50 chars AND fails format validation, the gate should retry synthesis with the raw observation corpus instead of accepting the garbage.

### B. Model-side patterns (MEDIUM IMPACT — calibration territory)

These genuinely vary by model and are calibration candidates:

**B1. Raw-JSON dump on synthesis tasks.** `qwen3.5 / T2` emitted the raw `[{"id":...}]` array verbatim instead of formatting as a numbered list. faith=100% (all data present) but format=0% (no synthesis). This is a model-style choice — the model thinks "tool returned data → pass it through".

**B2. Long-form thematic fabrication.** `cogito:14b / T5` wrote a coherent ~256-word report titled "# Today on Hacker News" with `## Technology and Innovation` sections — but cited 1/15 real titles. The other "stories" were invented. Same pattern hit cogito:latest earlier. Long-form structured prompts ("group into 2-4 categories with paragraph summaries") trigger creative-writing mode where some models prioritize narrative fluency over data fidelity.

**B3. Framework-internal-shape echo.** `cogito:14b / T4` dumped what looks like a `brief()` or `pulse()` return value:`{"signal":{"grade":"unknown","composite":-1, ...}` as the answer. Model treated a meta-tool return as the deliverable. Adjacent to the gemma4 compressed-preview echo we already characterized — both shapes are "model copies a structural artifact from somewhere in its working memory and presents it as final answer".

### C. Drop-from-probe candidates (rare or single-model)

- **Refusal** (`cogito:3b` only — model literally said "I can't do that"). Static-table flag, not calibration.
- **Loop-detected** (`gpt-oss / T5`). The detector worked correctly; not a probe candidate.
- **Garbled output** (`gemma4 / T5`, `qwen3 / T5`). Output gate fix is harness-side, not calibration.

## Per-task quality patterns

| Task | Median | Range | Failure mode if any |
|------|--------|-------|---------------------|
| T1-knowledge-recall | 100% | 72–100 | granite LLM-err only |
| T2-single-tool-synthesis | 65% | 30–100 | stuck/veto for weaker models, raw-JSON for qwen3.5 |
| T3-selective-filter | 67% | 34–88 | weak across the board (faith=33% common — scoring quirk to investigate) |
| T4-multi-criteria | 60% | 30–100 | classifier over-specifies for weaker models, fw-json for cogito:14b |
| T5-long-form-synthesis | 37% | 37–88 | hardest task; fabrication / garbage / loops |

T3 hitting faith=33% on EVERY model that succeeded suggests the scorer is too strict (it expects 1/3 specific titles and most models cite different "best" 3). That's a probe-script bug, not a model issue.

## Family aggregates

| Family | Avg | Failure shape |
|--------|-----|---------------|
| qwen | 83% | strongest; only T5-garbage variance |
| gemma | 77% | strong on structured tasks, T5 garbage |
| cogito | 78% | T4 framework-echo, T5 fabrication |
| llama | 51% | classifier over-specification dominates |
| gpt-oss | 46% | stall-veto + classifier issues |
| granite | 41% | thinking-mode capability mismatch |

**Worth noting**: the bottom three (llama / gpt-oss / granite) ALL have failures rooted in our harness, not the model. After A1–A4 fixes ship, these should jump significantly.

## Probe-suite proposal — distilled per criteria

Applying the user's distillation criteria (cross-model recurrence ≥3/8, single-variable, deterministic scoring, maps to one adapter hook, calibration value > probe cost):

### Drop these candidates (don't pollute the calibration vocabulary)

| Candidate | Why drop |
|-----------|----------|
| `echoRisk` | 1/8 models (gemma4) — too rare, hardcode in STATIC_CAPABILITIES |
| `refusalRisk` | 1/8 (cogito:3b) — static flag, not calibration |
| `imperativeWakeup` | Inconclusive in cross-model data — both descriptive and imperative phrasings worked across models when the harness wasn't in the way |
| `tooNameFormatPref` | Not observed as a failure cause across 8 models |
| `naturalReasoningDepth` | Confounded by stall-detector behavior; can't isolate cleanly |

### Keep — but as harness fixes, not probes

A1 (thinking capability check), A2 (classifier validation), A3 (stall-threshold calibration), A4 (output-gate garbage handling) — these are **bug fixes**, not calibration. Ship as code, not as probe outputs.

### Keep as new probes (cross-model evidence supports them)

| Probe | Detects | Adapter hook | Threshold to fire compensation |
|-------|---------|--------------|--------------------------------|
| **probeSynthesisShape** | raw-JSON-dump risk vs synthesizes-cleanly. Send a tool result, ask for a numbered list, score whether the output is a numbered list or the raw structure. | `synthesisPrompt` + `qualityCheck` | If "raw-dump", inject post-tool synthesis nudge ("Now format the data above as: 1. TITLE (score: SCORE). Output ONLY the list.") |
| **probeFabricationRisk** | long-form fabrication vs grounded. Provide a small fixed dataset, ask for a 200-word grouped summary, score `validateGeneralizedGrounding` on output. | `synthesisPrompt` + `systemPromptPatch` | If "high", system patch: "Use ONLY exact values from tool observations. Do not invent data." |
| **probeFrameworkArtifactEcho** | does the model echo internal-looking structures as final answer (brief/pulse-style). Send a tool result whose body resembles a JSON status object, see if model emits it as the answer. | `systemPromptPatch` | If "high", patch: "Your final answer should be the synthesized response to the user's question, never a tool result or status structure." |

Three new calibration fields:
```ts
synthesisShape: "synthesizes" | "raw-dump-risk"
fabricationRisk: "low" | "moderate" | "high"
artifactEchoRisk: "low" | "moderate" | "high"
```

Each probe runs in <30s, produces one categorical with 2–3 values, maps to one hook. Combined: <90s added to the existing calibration suite.

### Recommended sequence

1. **Land harness fixes A1–A4 first** — these alone should pull the bottom three families (llama/gpt-oss/granite) into the 70%+ band where the model probes can actually be measured against a working baseline.
2. **Then add the 3 probes B1–B3** — calibration only matters once the harness isn't masking model behavior with bugs. Today, llama3.1's "no synthesis style" measurement would be polluted by classifier-induced stalls.
3. **Re-run cross-model task-quality-gate after each fix** — measure the actual lift.

## Open questions worth exploring before implementing the probes

1. **Why does T3 hit faith=33% on all working models?** Looks like a scorer bug (expects specific titles when the task allows any 3). Verify before drawing conclusions about T3.
2. **Why is `result.toolCalls` empty on all reports?** Recording bug — probably hides real signal we need for accurate failure classification.
3. **Should the stall-detector switch from "N repeated thoughts" to "N seconds without progress"?** Would address gpt-oss without per-model calibration.

These are tractable next steps that ALSO inform the probe design — fixing #2 alone might let the existing calibration runner detect synthesis-shape patterns from production telemetry rather than needing a synthetic probe at all.
