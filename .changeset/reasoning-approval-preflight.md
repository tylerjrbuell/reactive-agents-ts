---
"@reactive-agents/reasoning": patch
---

The approval gate asks the tool's `preflight` first. A gated call the tool is certain to refuse (for example a shell command outside the allowlist) no longer opens an approval request: the refusal returns to the model at once as a failed tool call, in block mode and in the kernel's detach pause. A tool without `preflight` behaves as before.
