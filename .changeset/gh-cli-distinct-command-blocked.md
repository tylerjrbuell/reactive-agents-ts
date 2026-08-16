---
"@reactive-agents/reasoning": patch
---

Fixed — repetition guard blocked a genuinely new CLI subcommand

`repetitionGuard`'s distinct-target carve-out only recognized `path`,
`file`, `target`, `url`, and `id` arguments. Tools whose entire call is one
opaque `command` string (`gh-cli`, `git-cli`, `gws-cli`) never matched, so a
second, completely different subcommand (e.g. `gh log ...` after `gh repo
view ...`) was treated as pure repetition and blocked at the ceiling — the
agent could establish the default branch but never actually fetch commits.
`command` args are now compared by their leading subcommand tokens (`repo
view` vs `repo log`) rather than key presence alone, so a new subcommand
passes while same-subcommand churn (`keep notes get x` → `keep notes get
y`) still hits the ceiling as intended.
