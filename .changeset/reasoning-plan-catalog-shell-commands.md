---
"@reactive-agents/reasoning": patch
---

Planners now see which commands the shell tool may run. A tool's `commandPolicy` is rendered in the shared plan catalog (blueprint, plan-execute-reflect, patch and augment) and in plan posture's `Execute-phase tools:` line: allowed commands already on PATH, allowed but not installed, and not enabled (the PATH split is skipped for a Docker sandbox), with a rule not to plan a step only to check that a tool or command exists. This ends plans like `gh --version` / `gh auth status` made only to confirm shell access. A turn where every tool call has empty arguments although the tools require some is now one model fault: the calls are refused and answered, and one corrective line names each tool, its required parameters and an example call, instead of a failed call and a turn per repeat. The generic "Check argument format" hint is no longer appended to an error that already shows `Valid call:`.
