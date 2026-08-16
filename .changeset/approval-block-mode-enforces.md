---
"@reactive-agents/runtime": minor
---

Fixed — `.withApprovalPolicy({ mode: "block" })` now enforces (security)

- **`mode: "block"` was an inert safety switch.** Every approval gate keyed on
  `mode === "detach"`; nothing read `"block"`, so a `requiresApproval` tool
  executed with no human decision — and `"block"` is the mode you get from
  `.withApprovalPolicy(...)` when `.withDurableRuns()` is not set (the common
  case). Block mode now decides each gated call **in process** and **denies by
  default**: without an `onApprove` handler, a gated call is refused (the tool
  does not run) rather than silently executed.
- **New `onApprove` option** on `.withApprovalPolicy()` — a synchronous or async
  callback `({ toolName, args, iteration }) => boolean | { approve, reason }`
  that decides each gated call in block mode. A throw/rejection denies
  (fail-closed). Distinct from `run()`'s detach-mode `onApproval`.
- **Behavior change:** a run using block mode (or the default without durable
  runs) with a gated tool and no `onApprove` will now REFUSE that tool where it
  previously executed it. Supply `onApprove`, or use `mode: "detach"` +
  `.withDurableRuns()` for durable cross-process approval. `code-action` refuses
  the run outright under any gating policy (its tools run past every gate).
- The durable HITL approval gate now also applies uniformly across every
  reasoning strategy (Blueprint, Reflexion, Plan-Execute, Tree-of-Thought,
  Adaptive, Direct) — it was previously wired into `reactive` only, so a gated
  tool could run unattended under any other strategy.
