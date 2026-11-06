---
"@reactive-agents/reasoning": patch
---

Plan steps no longer write unresolved `{{from_step:…}}` templates into tool arguments. A planner that writes a keyed ref such as `{{from_step:s2:lowstock}}` (outside the `:summary` / `:full` grammar) previously had the literal token written to a file with `ok: true`. plan-execute and blueprint now rewrite keyed refs to the bare `{{from_step:sN}}` ref at plan validation (also on replans) and emit `guard-fired{guard:"plan-ref-normalized"}`. As a safety net, plan-execute strips any leftover `{{from_step:` token before a direct tool call, and blueprint fails such a step instead of running the tool (it previously missed `:full` and keyed refs).
