---
"@reactive-agents/cortex": patch
---

Lab builder: the host shell section has one "Allowed commands" control instead of three overlapping ones (extra commands, replace-allowlist, command-group checkboxes). It shows the exact list the agent may run, framework defaults pre-filled from the new `GET /api/tools/shell-commands`, with removable chips, an add input, and quick-add buttons for the opt-in groups (JavaScript, Python, Web, Archives, Environment) carrying a short risk note. The GitHub CLI group is gone from the builder because the `git` toolset already brings `gh`. Saved configs with command groups load into the list without losing a command; an edit saves added commands as `additionalCommands`, or the full list as `allowedCommands` once a default is removed, and no longer sets `commandAccess`.
