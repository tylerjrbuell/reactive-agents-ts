---
"@reactive-agents/reasoning": patch
"@reactive-agents/runtime": patch
---

New opt-in harness switch `inputCoverage` (default OFF; `HarnessConfig.inputCoverage` or `RA_INPUT_COVERAGE=1`). When a task explicitly lists its inputs (file paths or URLs it does not ask you to write), each input becomes its own requirement. Reading one listed file no longer counts as having read them all. The exit gate lists every unread input ("read the listed input src/b.ts"), and act-or-answer counts each one as outstanding tool work. A read can be any non-write tool call that names the input, including `cat` in a shell command or a fetch of a URL under a listed API base. A failed read also settles the input, so a task whose listed file is missing can still end with an honest abstention. Tasks that list no inputs, and runs with the switch off, compile the same contract as before and send the same requests. Not applied under plan posture, in plan-step sub-kernels, or on a tool surface with no substantive tool.
