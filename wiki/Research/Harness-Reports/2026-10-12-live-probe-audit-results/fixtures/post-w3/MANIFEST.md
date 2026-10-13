# post-w3 — W3c Stage-B promotion data: shadow-soak + act-mode (2026-10-13, HEAD ed6241793)

Rung-3 evidence for the text-parse think-to-acting transition (`REACTIVE_AGENTS_TEXT_PARSE`,
W3a 2c3acda31+c29f00002, W3b live routing 7722e1762). bench.ts arms carry `parseMode` (env pinned
per run, restored after). Dist verified carrying W3a code pre-capture. Promotion is the
CONTROLLER's decision; these are the measured inputs. 18 runs total.

## Batch results

| batch | arm | model | N | outcome |
|---|---|---|---|---|
| A | w3-shadow-coder14b | qwen2.5-coder:14b (MEASURED dialect-none prior, v2 3-run) | 5 | 5/5 complete: **0 shadow signals, would-have-executed 0/5** - see parser gap |
| B1 | w3-shadow-phi4mini | phi4-mini-reasoning:latest | 3 | 1 hung (8-min guard), 2 llm_error (255/300 s) - box instability |
| B2 (retry) | w3-shadow-phi4mini | phi4-mini-reasoning:latest | 3 | **run1 (01M4V09PW55DJK02APXBNDCJZE): 1 shadow signal, 3 calls parsed tier-1, would-have-executed 3/3 by name**; runs 2-3 hung (480 s) |
| C | w3-act-coder14b | qwen2.5-coder:14b | 5 | 5/5 complete: **0/5 executed, 0 parse-failure signals** - identical 1-call end_turn failure shape as shadow |
| D | w3-act-phi4mini | phi4-mini-reasoning:latest | 2 | **both hung (01M4V315, 01M4V3FT, 480 s guard)** - act-vs-shadow discriminator NOT measurable on phi4 on this box |

## Measured parser-coverage gap (coder arm - file-ready, NOT fixed)

Coder:14b IS routed text-parse (wire toolSchemaNames empty; taught grammar present in the system
prompt: open-tag line, `tool: <name>` param lines, close-tag line). At temp 0 the model emits the
taught PARAM LINES but DROPS BOTH WRAPPER TAGS (every run's think content begins directly with
`tool: file-read`). All three parser tiers miss it: tier-1 regex requires the wrapped block,
tiers-2/3 require JSON. Shadow emission is correctly gated (`parsed>0 OR markerPresent` both
false) => zero signals is FAITHFUL observation, not a lost signal. In act mode the transition
branch is gated on `parsed.length>0` and the retry nudge on `markerPresent` => both inert for this
shape; 5/5 runs fall through to the legacy 1-call end_turn failure. **The blocker to the identity
thesis on coder is teach/parse coverage of un-wrapped markup, not the W3a act pipeline.**
Suggested owner: tools-warden (TextParseDriver tier-1 could accept the taught param-line block
without wrapper when it is the whole message; parser contract is builder-single-source, GH #243 pin
must be preserved).

## phi4 shadow-clean-run detail (01M4V09P, the promotion-relevant row)

- think exchange 2 contained correctly WRAPPED taught markup; parser extracted
  `[{name:file-read,tier-1},{name:file-read,tier-1},{name:file-write,tier-1}]`,
  `wouldHaveExecutedCalls=3` (names all in callableSurface [file-read, file-write]),
  `acted=false` (shadow respected: tool-call-start=0). **The transition seam works on a model that
  follows the taught grammar.**
- Caveat for act: `argumentKeys=["<param-name>"]` on all three - the model echoed the taught
  PLACEHOLDER param lines rather than binding real args (`path: sales-q1.txt`). An act-mode
  execution would rely on HealingPipeline/TypeCoercer to repair; unproven live because batch D
  hung both runs.
- Same trace also shows the W2e head-truncation preflight signal (correctedTokens 456,
  numCtx 32768 - arm pins no num_ctx - dropped none, shipped).

## Safety watch (C batch, 12 completed runs across A/C)

No double-dispatch (tool-call-start total 0 where expected), no budget bypass (never reached the
gated batch), no parse-failure loops (0 nudge signals), no markup-retry storms. Divergence
patterns: NONE observed. The act branch's non-execution on coder is full inertness (fail-safe to
legacy path), which is itself the designed byte-identical fallback.

## PROMOTION-READINESS SUMMARY (measured facts; decision is the controller's)

- **rung-3 (local act): PARTIAL.** Shadow observability + tier-1 parse + would-have-executed 3/3
  demonstrated once on phi4 (clean run); act-mode actual execution UNMEASURED (phi4 box-unstable:
  6/8 attempts hung or llm_error'd; coder parser-gap makes act unreachable for its markup shape).
  Plan 3.5 rung agreement CANNOT be declared on this data.
- **rung-2 (haiku): BLOCKED-NOTED** - Anthropic credit blocker unchanged (no cloud calls made).
- Box caveat for re-run: phi4-mini-reasoning streaming degraded during this window (cold loads
  255-480 s, stalls); re-attempt batch D (+ shadow coder with a wrapper-tolerant parser if
  tools-warden lands one) when the box is quiet.
