---
"@reactive-agents/reasoning": patch
---

Plan-execute no longer makes its reflect model call when the outcome is already decided. That happens when every plan step completed and the run contract's checks (files written, required tools called) all pass. In that case the reflect call could only answer SATISFIED, so the run goes straight to synthesis and records "[REFLECT n] skipped — every step completed and delivery verified (…)" in its steps. The reflect call still runs when any step failed, when a contract check is unmet (including an answer-content check that synthesis has not satisfied yet), or when the task has no such checks beyond producing an answer. Typical saving: one model call per plan, and more when a scripted or confused reflection would otherwise have sent the plan around a refine loop.
