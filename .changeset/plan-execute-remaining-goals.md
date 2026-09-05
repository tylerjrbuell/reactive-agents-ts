---
"@reactive-agents/reasoning": minor
---

Plan-Execute's composite steps now recite the titles of other pending/in-progress plan steps to their sub-kernel as `remainingGoals`, closing a gap where the `goal_state` event had a full rendering path (`volatileTailStage`'s "Remaining steps: ..." recitation) but no producer anywhere in the codebase. Opt-in by construction: absent or empty, behavior is byte-identical to before.
