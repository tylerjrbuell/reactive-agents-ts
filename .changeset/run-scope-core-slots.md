---
"@reactive-agents/core": minor
"@reactive-agents/runtime": patch
"@reactive-agents/reasoning": patch
---

The remaining per-run values move into the run scope, bound once by the run entry. Removed from `@reactive-agents/core`'s public exports: `StreamingTextCallback`, `CurrentRunContext`, `CurrentRunContextRef`, `RunControllerRef`, `ResumeStateRef`, `ModelOverrideRef`, `ApprovalDecisionRef`, `InteractionResponseRef` and `RecoveredToolEffectsRef`. Code that bound them with `Effect.locally` should use the public agent APIs that set them: `agent.runStream()` (stream text and the pause/stop controller), `agent.fork({ model })` (model override), `agent.resume()`, `agent.approveRun()` / `agent.denyRun()` and `agent.respondToInteraction()` (resume state and the human's answer), and `.withDurableRuns()` crash recovery (recovered tool effects).

Behavior changes for sub-agents, which now get a fresh value instead of inheriting the parent's: a sub-agent never resumes its parent's checkpoint or applies its parent's approval decision, interaction answer or `fork({ model })` override, and never reuses its parent's recovered tool effects. A sub-agent still stops when its parent's run is stopped. `RunContext` gains an optional `taskId` (read with `runTaskId`), so a sub-agent's LLM calls correlate to its own task.
