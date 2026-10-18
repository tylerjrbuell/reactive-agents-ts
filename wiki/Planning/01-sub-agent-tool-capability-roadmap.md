# Sub-Agent Tool Capability Roadmap

**Purpose:** Canonical roadmap for sub-agent tool capabilities — `.withAgentTool()`, `.withDynamicSubAgents()`, parameter interpolation, approval/timeout configuration, and per-call tools override. Tracks what's shipped, what's experimental, and what needs design passes.

**Last updated:** 2026-10-16

---

## shipped & verified (v0.14+)

| Capability | Status | Key files | Notes |
|---|---|---|---|
| `.withAgentTool()` static sub-agent registration | ✅ shipped | `packages/runtime/src/builder/build-effect/local-agent-tools.ts` | Register a sub-agent as a named, callable tool. Config fixed at build time. |
| Structured input `parameters` | ✅ shipped | `packages/runtime/src/builder/build-effect/local-agent-tools.ts:124-136` | Declared `ToolParameter[]` merged into tool JSON Schema alongside catch-all `input`. |
| `{{paramName}}` interpolation in `systemPrompt`, `persona.role`, `persona.instructions`, `persona.background` | ✅ shipped | `packages/runtime/src/builder/helpers.ts:474-484` (`interpolateTemplate`) | Missing keys left as-is (no throw). Follows prompts template engine `{{key}}` convention. |
| `requiresApproval` config (per-sub-agent) | ✅ shipped | `packages/runtime/src/builder/types.ts:1018` | Default: `true`. When `false`, automated unattended delegation. |
| `timeoutMs` config (per-sub-agent) | ✅ shipped | `packages/runtime/src/builder/types.ts:1022` | Default: `60_000`. Per-invocation timeout in milliseconds. |
| Parent scratchpad forwarding (`parentScratchpadWriter`) | ✅ shipped | `packages/runtime/src/builder/build-effect/local-agent-tools.ts:92,304` | Sub-agent entries written to parent's scratchpad via `finalizeSubAgentResult`. |
| Child agent fork into parent fiber tree (not detached) | ✅ shipped | `packages/runtime/src/builder/build-effect/local-agent-tools.ts:138-141` | `Effect.forkScoped` + `Fiber.await`; parent interruption reaches child. |
| Truthful failure (`success: false` on child failure) | ✅ shipped | `packages/runtime/src/builder/build-effect/local-agent-tools.ts:307-317` | Child failure produces `success: false` observation, not fabricated success. |
| Child lifecycle events on parent's EventBus | ✅ shipped | `packages/runtime/src/builder/build-effect/local-agent-tools.ts:235-236` | Events tagged with `parentAgentId` for trace correlation. |
| `per-call tools` override (`args.tools`) | ✅ shipped | `packages/runtime/src/builder/build-effect/local-agent-tools.ts:223-229` | `args.tools` whitelist overrides static `agent.tools` allowlist for that call. |
| Dynamic persona via `spawn-agent` (runtime) | ✅ shipped | `packages/runtime/src/builder/build-effect/local-agent-tools.ts:352-364` | `.withDynamicSubAgents()` enables `spawn-agent`/`spawn-agents` tools. |
| Recursion depth cap (`maxRecursionDepth`) | ✅ shipped | `packages/runtime/src/builder/build-effect/local-agent-tools.ts` | Default 3; children can spawn only while depth stays below cap. |
| Sub-agent truthful completion envelope | ✅ shipped | `packages/runtime/src/builder/build-effect/sub-agent-executor.ts` | Child's completion envelope crosses back on result; parent terminal joins children worst-of. |
| Sub-agent judgment under parent's contract/guardrails | ✅ shipped | `packages/runtime/src/builder/build-effect/local-agent-tools.ts:250-253` | Child runs under parent's `taskContract`, `fabricationGuard`, `grounding`, `approvalPolicy`. |
| Sub-agent attributed logging (depth-/name-tagged) | ✅ shipped | `packages/runtime/src/builder/build-effect/local-agent-tools.ts` | `│ researcher · ` prefix; `▶ delegate → <name>: <task>` / `◀ <name> ✓/✗` markers. |
| System prompt `{{paramName}}` in `systemPrompt` field of `withAgentTool` | ✅ shipped | `packages/runtime/src/builder/build-effect/local-agent-tools.ts:192-195` | Interpolation with `customArgs` at call time. |

---

## design pass needed (deferred)

| Capability | Issue | Status | Design Pass Needed |
|---|---|---|---|
| Shared `computeBudgetSignal` cost-semantics collapse | #248 part 1 | ⏸️ deferred | Cost-signals diverge between `compose` and `withBudget` — need design pass to reconcile. See `wiki/Planning/Implementation-Plans/2026-10-16-watchdog-think-reset.md` §40-41. |
| `withBudget` / `compose` budget signal sharing | — | ⏸️ open | Need to verify both paths converge on same budget meter semantics. |

---

## opt-in / experimental (not default)

| Capability | Status | Notes |
|---|---|---|
| `.withLongHorizon()` (scales guards to `maxIterations`) | opt-in, not default | Verified to finish long runs but not lift-gated for default-on. |
| `.withAdaptiveHarness()` (run-start policy compiler + mid-run recompile) | opt-in, not default | Cross-tier ablation inconclusive (n=1 dev-box noise). Stays opt-in under lift-gate veto. |
| `.withContract()` | load-bearing, default-on | Pre-existed v0.14; now load-bearing as part of meta-loop overhaul. |

---

## high-leverage opportunities (future)

| Capability | Potential impact | Blockers |
|---|---|---|
| Per-call `requiresApproval` override via tool call args | Would allow parent LLM to dynamically approve/deny sub-agent invocation per-task | Requires schema change + LLM prompt design; not yet implemented |
| Per-call `timeoutMs` override via tool call args | Would allow dynamic timeout adjustment per invocation | Same as above; needs design |
| Sub-agent memory inheritance (episodic/semantic) | Would give sub-agents access to parent's memory stores | Requires memory layer wiring; not yet implemented — sub-agents start with fresh memory |
| Nested/sub-sub-agent recursion beyond depth 3 | Would enable multi-level delegation trees | Currently capped at `MAX_RECURSION_DEPTH` = 3; would need cap increase + UI |
| Remote A2A sub-agent via `.withAgentTool({ remoteUrl })` | Would allow calling remote agents as native tools | Already supported via `.withRemoteAgent()` separate from `.withAgentTool()`; unifying them is a design question |

---

## version note

- **v0.14.0** (2026-07-11): Meta-loop overhaul shipped. `.withAgentTool()` received structured `parameters`, `{{paramName}}` interpolation, `requiresApproval`, `timeoutMs`, and per-call `tools` override — all default-on, verified green.
- **v0.15.0** (planned): Sub-agent judgment under parent's contract, attributed logging, recursion depth configurability.

---

## how to read this roadmap

- **✅ shipped** — code is merged, tests pass, documented in `apps/docs/`. No design pass needed.
- **⏸️ deferred** — known gap, documented in an issue, needs a design pass before shipping. Record the pass in this file's status column.
- **⚙️ opt-in** — shipped but opt-out-of-default; not "better" or "recommended", just available for consumers who want it.
- **🌟 high-leverage** — future work with high user impact but currently blocked by design/LLM-prompt concerns.