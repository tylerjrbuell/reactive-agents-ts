---
"@reactive-agents/reasoning": minor
---

Terminal scaffold-leak no longer hard-fails the run on sight, it gets ONE
bounded corrective synthesis pass first.

When a model's final answer echoed framework scaffolding
(`[STORED: _tool_result_N]`, "compressed preview", "full text is stored")
instead of the tool data, the always-on scaffold-leak guard rejected it and
the run died with `ExecutionError: Verifier rejected output: final-answer:
failed at scaffold-leak`, zero repair attempts, even though the real answer
sat in the scratchpad the whole time. The existing repair machinery
(`enforceQualityGate` DATA→FORMAT synthesis, the arbitrator's
`synthesisQualityRetry`) only covers reflexion/plan-execute terminals and
text-protocol `final-answer` intents; native-FC runs never offer the
`final-answer` tool, so the terminal verifier gate was their only checkpoint.

The runner's terminal gate now mirrors the Phase D1 cap-then-degrade
precedent for grounding: on a scaffold-leak rejection it attempts exactly ONE
corrective synthesis pass from the validated, scratchpad-resolved
observations, re-verifies against the same terminal context, and ships the
repaired answer with honest `harness_synthesis` provenance when clean. If
the repair still leaks, the previous behavior is unchanged, the run fails
honestly, and the specific scaffold-leak reason still surfaces on the
result/receipt (`verifierVerdict: "reject"`). The guard itself is NOT
weakened: scaffolding dumps can still never ship as an answer.

Regression coverage: `packages/reasoning/src/kernel/loop/scaffold-leak-terminal-repair.test.ts`
(deterministic, TestLLMServiceLayer, no network) +
`packages/runtime/tests/scaffold-leak-repair-e2e.test.ts` (public `agent.run()` boundary).
