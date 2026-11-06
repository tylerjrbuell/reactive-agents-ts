---
"@reactive-agents/reasoning": patch
---

The exit gate's decision is now final for the turn. A run the gate ended (accepted or handed off) can no longer be reopened by a later guard in the same turn. Before this fix, a run with a required tool still missing could be handed off by a controller early stop and then sent back to thinking by the required-tools guard, which threw away the handoff synthesis. A forced oracle exit now also ends the turn, the same way every other guard exit does.
