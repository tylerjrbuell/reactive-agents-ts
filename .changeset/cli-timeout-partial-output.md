---
"@reactive-agents/tools": patch
---

git-cli, gh-cli and gws-cli keep their partial output when a command hits the 30s timeout. Before, the kill error was raised and everything the command had printed was lost. A timed-out run now returns the output gathered so far with `timedOut: true` and a `note` naming the limit (the same marker as shell-execute). `CliRunResult` gains an optional `timedOut` field.
