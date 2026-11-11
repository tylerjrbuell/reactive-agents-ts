---
"@reactive-agents/reasoning": minor
---

The approval gate can now require approval for specific shell commands, not only whole tools. `ApprovalGateConfig` (and the resolved, configured and authored approval policy shapes derived from it) gains `commands?: readonly string[]`: a `shell-execute`, `git-cli` or `gh-cli` call whose `args.command` has a segment starting with a rule's words (`"git push"` matches `git push origin main`) is gated like a listed tool. Block mode refuses it unless the approval handler approves (deny by default); detach mode pauses the run on it. `shouldGate` now takes the call's `args`, and `requireFor` predicates receive `args` too. The code-action strategy refuses a policy that sets `commands`, as it already does for gated tools.
