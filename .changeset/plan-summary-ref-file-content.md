---
"@reactive-agents/reasoning": patch
---

Plan steps that write a file no longer lose the file's line structure. When a planner set a file-content argument to `{{from_step:sN:summary}}`, the `:summary` form collapsed all whitespace and cut the text at 500 characters, so a multi-line list such as `SKU-003\nSKU-008` was written as `SKU-003 SKU-008` and markdown headings left the start of their lines. plan-execute and blueprint now rewrite that ref to `{{from_step:sN:full}}` at plan validation (also on replans) when the ref is the whole value of an argument and the call names a literal file target. They emit `guard-fired{guard:"plan-ref-normalized"}` with the rewritten argument names in `metadata.normalized[].fullContent`. `:summary` refs in search queries and other arguments are unchanged.
