---
"@reactive-agents/reasoning": patch
---

Fixed — deterministic evidence grounding, corrected

The harness's deliverable assembly (`assembleDeliverable`) now grounds a
model's terminal thought against unread stored tool evidence instead of
trusting a long thought outright — closing a fabrication path where a
plausible-sounding synthesis off a compressed tool-output preview could win
over already-resolved tool observations, across every termination path
(`end_turn`, `dispatcher-early-stop`, `low_delta_guard`,
`controller_early_stop`).

**Follow-up correction:** the initial version of this check discarded a
thought whenever ANY tool evidence was formally unconsumed, even when the
thought demonstrably reproduced that evidence verbatim (e.g. transcribing a
large table back in full). It now only overrides the thought when the
thought does NOT already contain the unread evidence's content — a thought
that provably grounds the evidence is trusted regardless of whether the
harness saw an explicit `recall()` call.
