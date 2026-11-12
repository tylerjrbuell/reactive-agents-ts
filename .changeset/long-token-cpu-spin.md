---
"@reactive-agents/reasoning": patch
---

Fix a CPU spin on long unbroken tokens: the deliverable-path matcher (`PATH_TOKEN`) was cubic on dot-free runs, so a message or tool result with a long run of one token (a minified one-line file, 65 KB+) pinned a core and the turn never reached the provider. It is now linear with identical matches.
