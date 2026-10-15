# post-w3-refix — Wave 3 rung-3 re-capture post parser-fixes (2026-10-15)

Rung-3 re-measurement after the parser fix chain (bare-block tolerance
b39e31a37, hardening efdc3d102, delimiter `<tool_call>`→`<tool_use>`
2f9f48611, all reviewed). Question: did the fixes unblock coder:14b, and has
any run completed a text-parse execution end to end? 11 runs total.

## Batch results

| batch | arm | model | N | outcome |
|---|---|---|---|---|
| S | w3-shadow-coder14b | qwen2.5-coder:14b | 3 | **3/3 parsed 3/3, would-have-executed 3/3** (was 0/5 in W3c) — parser coverage FIXED by the delimiter + bare-block work |
| A | w3-act-coder14b | qwen2.5-coder:14b | 5 | 5/5 complete, **parsed 0/5 — model used NATIVE FC instead** (file-read×4, file-write×2, final-answer×1 per run); text-parse never engaged because native worked; finals honestly failed (empty report.md = model quality, not harness) |
| P | w3-act-phi4mini | phi4-mini-reasoning:latest | 1(+1 cut) | **hung** (guard) — W3c box-instability finding persists for phi4-mini on this box; second run cut with the timeout |

## Readings
1. The parser fixes worked: coder markup now parses 9/9 calls across 3 runs.
2. Coder:14b is NOT a no-FC model in practice — its fresh n=5 calibration says
   dialect "none", yet it emitted native tool calls on the file task (the
   weather-probe dialect test under-detects it). The "real no-FC local" rung
   premise is stale for this model.
3. No run on any model has yet completed a text-parse execution end to end:
   gemini ignores the grammar, coder prefers native FC, phi4 hangs.
4. Safety watch holds: no double-dispatch, no budget bypass, no parse loops.

## Promotion input (controller decision)
Parser coverage is fixed and measured. Act-mode end-to-end execution remains
UNMEASURED — there is no positive case for flipping the default. Recommendation
in scoreboard (keep default-off, explicit opt-in).
