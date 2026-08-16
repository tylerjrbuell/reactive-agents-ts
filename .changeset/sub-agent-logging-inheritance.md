---
"@reactive-agents/runtime": minor
---

Improved — sub-agent dispatch logging is followable

- A sub-agent's log lines now carry a **depth- and name-tagged prefix** (one
  `│ ` per nesting level plus the child's name, e.g. `  │ researcher · `)
  instead of a flat `  │ ` for every child at every depth. Parallel and nested
  sub-agents no longer collapse into one indistinct, unattributable stream — you
  can tell which child, and how deep, every line came from.
- Each delegation is **framed with delimiters** — `▶ delegate → <name>: <task>`
  on dispatch and `◀ <name> ✓/✗ — <tokens> tok, <ms>ms` on completion — so a
  child's block has a clear start and end.
- The prefix now applies to **all** log levels: a sub-agent's `warn`/`error`
  lines were previously unprefixed and appeared at the parent's indent level,
  reading as the parent failing. They now indent and attribute like the rest.

Added — sub-agents inherit the parent's judgment + safety constraints

- A delegated sub-agent (`.withAgentTool()` / `.withDynamicSubAgents()` /
  `spawn-agent`) now runs under the parent's **`taskContract`**,
  **`fabricationGuard`**, **`grounding`**, and **`approvalPolicy`** — a true
  sub-agent, not a rubber-stamped one. Its answer is judged against the same
  contract and fabrication guard, its claims are grounded, and a
  `requiresApproval` tool it calls is refused rather than executed unattended.
  Previously a child inherited none of these: it could fabricate freely and
  execute gated tools with no decision.
- **Approval is coerced to block/deny-by-default in sub-agents.** A sub-agent has
  no durable store, so it cannot pause for cross-process (`detach`) approval —
  it decides in process and denies by default. A `detach` parent policy no
  longer strands a child at a gate; the child denies the gated tool instead. The
  same auto-feed folds the child's `requiresApproval` built-ins into the gate.
