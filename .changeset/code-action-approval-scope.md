---
"@reactive-agents/reasoning": patch
---

code-action: refuse an approval policy only when it can gate a tool the sandbox can call. Before, any non-empty `tools` list refused the run, and the runtime fills that list with every registered `requiresApproval` tool, so code-action refused even when every tool it could call was read-only. It now refuses when a callable tool is in the policy's `tools`, when `commands` rules are set and a shell tool (`shell-execute`, `git-cli`, `gh-cli`) is callable, or when a `requireFor` predicate is set. The refusal still starts with `code-action cannot honor .withApprovalPolicy(` and now names the gated callable tools. New export `codeActionApprovalConflict({ callableTools, policy })` applies the same rule, so a UI can warn before the run.
