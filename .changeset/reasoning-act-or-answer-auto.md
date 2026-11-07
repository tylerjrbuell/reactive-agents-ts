---
"@reactive-agents/reasoning": minor
"@reactive-agents/reactive-intelligence": minor
---

Act-or-answer can now pick its mode per model. Set `actOrAnswer: "auto"` in `.withHarness({ ... })` (or `RA_ACT_OR_ANSWER=auto`) and each run uses the mode learned for its model: forced first request (`proactive`), forced retry after a stalled turn (`retry`), or off. With nothing learned yet, Ollama models use retry and other providers stay off. The default is unchanged (off).

Every run now counts, in any mode, the unforced turns sent while tool work was outstanding, how many of them ended without a tool call, the forced tool-call requests sent, and how many forced calls ran and succeeded. The counts are on `result.metadata.extensions.actOrAnswer`; strategies that run several kernel passes (plan-execute steps, reflexion, tree-of-thought) report the sum over all passes. Local calibration learns `actOrAnswer` from them once at least 5 runs carry them. The stall rate is measured on unforced turns only: with fewer than 10 of them, the learned choice keeps its previous value, so a proactive model whose turns are all forced does not switch itself off. New reasoning exports: `resolveActOrAnswer`, `resolveRunStartHarness`, `actOrAnswerTally`, `sumActOrAnswerTally`.
