---
"@reactive-agents/cost": patch
"@reactive-agents/interaction": patch
---

The complexity router's tier classification and the preference learner's autonomy-confidence check are observation-only judgments. They now pass `priority: "shadow"` so the judgment service's concurrency gate bounds them. Routing and approval decisions are unchanged.
