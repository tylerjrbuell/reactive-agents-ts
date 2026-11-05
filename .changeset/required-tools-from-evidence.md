---
"@reactive-agents/reasoning": minor
---

"Which required tools are still missing, attempted or permanently failed" is now answered from the run's tool evidence, not by scanning the current pass's steps. A later pass of a multi-pass run is no longer told "Cannot finalize yet" for a required tool an earlier pass already called, and a required quantity counts calls across the whole run. A call the harness blocked is not an attempt, so a guard-blocked required tool is no longer reported as permanently failed. Delegated work counts through the sub-agent result's `delegatedToolsUsed`. `ToolEvidence` gains `attemptedCounts` and `permanentlyFailed`.
