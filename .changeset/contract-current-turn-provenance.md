---
"@reactive-agents/core": patch
"@reactive-agents/reasoning": patch
"@reactive-agents/trace": patch
---

The run contract is now compiled from the current turn only, so conversation history inlined into the task string (Cortex chat, gateway chat) no longer creates requirements that can never be satisfied. Requirements and deliverables carry typed provenance, and `contract-compiled` records it plus `currentTurn`.
