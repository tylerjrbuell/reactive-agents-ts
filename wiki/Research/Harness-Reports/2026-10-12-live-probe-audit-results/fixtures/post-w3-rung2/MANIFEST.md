# post-w3-rung2 — Wave 3 rung-2 on a frontier provider (2026-10-15)

Rung-2 evidence for the text-parse think-to-acting transition, replacing the
credit-blocked haiku rung (Anthropic 400, 2026-10-13). Frontier model with FC
disabled exercises the taught grammar on a strong model (plan 3.5 rung
agreement). 6 runs total (N=3 shadow + N=3 act).

## Setup (new vs W3c)
- `REACTIVE_AGENTS_FORCE_TEXT_PARSE=1` (new, runner.ts): forces the
  text-parse driver + suppresses the native resolver (no 482c11e4
  divergence). Bench arms carry `forceTextParse` (env pinned per run).
- bench `ArmSpec.provider` widened to `"gemini"`; arms `w3-shadow-gemini` /
  `w3-act-gemini` (S4 file task, gemini-2.5-flash via GOOGLE_API_KEY,
  fullHarness-equivalent file tools).
- Dist rebuilt pre-capture (post Wave 5-7 HEAD).

## Batch results

| batch | arm | model | N | outcome |
|---|---|---|---|---|
| R2-S | w3-shadow-gemini | gemini-2.5-flash (FC disabled) | 3 | 3/3 complete: **0 shadow signals, 0 parsed** — model emits `<tool_code>` pseudo-code blocks, never the taught `<tool_use>` wrapper (deterministic across runs at temp 0); shadow correctly silent, no false parse |
| R2-A | w3-act-gemini | gemini-2.5-flash (FC disabled) | 3 | 3/3 complete: **parsed 0/3**, fell through to legacy path (end_turn failure, honest) — nothing to act on |

## Measured grammar-compliance gap (file-ready)
gemini-2.5-flash received the taught `<tool_use>` block verbatim in the
system prompt (verified in trace) and emitted `<tool_code>` +
`print(file_write(...))` instead, 3/3 runs. A frontier model does not follow
the taught wrapper unprompted. Parser implications: covering `<tool_code>`
would chase model-invented dialects without bound; the honest reading is that
voluntary grammar compliance is ~zero even on strong models.

## Promotion input (controller decision)
Rung-2: transition seam observable + faithful (silent when nothing parses, no
false execution, legacy fallback intact). It does NOT demonstrate a successful
text-parse execution — no model has yet completed one end to end.
