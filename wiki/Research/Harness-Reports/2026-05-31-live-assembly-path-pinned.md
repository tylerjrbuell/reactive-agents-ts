# Phase 0: Live Message-Assembly Path Pinned

**Date:** 2026-05-31
**Branch:** `overhaul/agentic-core-2026-05-31`
**Probe model:** `cogito:14b` (local tier, ollama)
**Method:** `RA_ASM_DEBUG=1`-gated `process.stderr.write` probes in `context-curator.ts` and `context-manager.ts`, captured via `2>&1 | grep asm-probe`.

---

## Raw Probe Output

Two runs captured:

**Run 1** (simple task: list files + write file):
```
[asm-probe] curate called iter=0 adapter=Object
[asm-probe] build branch=conv iter=0
[asm-probe] curate called iter=1 adapter=Object
[asm-probe] build branch=conv iter=1
```

**Run 2** (GitHub MCP task: fetch commits + write pc.md):
```
[asm-probe] curate called iter=0 adapter=Object
[asm-probe] build branch=conv iter=0
[asm-probe] curate called iter=1 adapter=Object
[asm-probe] build branch=conv iter=1
[asm-probe] curate called iter=2 adapter=Object
[asm-probe] build branch=conv iter=2
```

Both probes fired on every iteration. The `adapter` arg is `Object` (a live `ProviderAdapter` instance returned by `selectAdapter`), confirming the `if (adapter)` branch executes.

---

## F1: Exact Live Render Site

**File:** `packages/reasoning/src/kernel/capabilities/reason/think.ts`
**Function:** `handleThinking`
**Lines:** 331–336

```typescript
const {
  systemPrompt: systemPromptText,
  messages: conversationMessages,
  compressionApplied,
} = defaultContextCurator.curate(state, input, profile, guidance, adapter, {
  availableTools: promptSchemas,
  systemPromptBody: effectiveSystemPrompt,
  toolElaboration: input.toolElaboration,
  includeRecentObservations: profile.recentObservationsLimit ?? 0,
});
```

This is the call that renders `systemPromptText` and `conversationMessages` for the live LLM request. Both are used directly at line 474:

```typescript
const llmStreamEffect = llm.stream({
  messages: conversationMessages,
  systemPrompt: systemPromptWithDriver,
  ...
});
```

(`systemPromptWithDriver` is `systemPromptText` with optional `driverInstructions` and `rationaleInstructions` appended, lines 433–436.)

**Call chain (confirmed by probe):**

```
think.ts:handleThinking (line 331)
  → context-curator.ts:defaultContextCurator.curate
    → context-manager.ts:ContextManager.build
      → context-utils.ts:buildConversationMessages   [if (adapter) branch — LIVE]
      → context-manager.ts:buildIterationSystemPrompt
          → context-manager.ts:buildCuratedMessages  [NOT called — adapter present]
```

---

## F2: Live Caller Status for Each Candidate Function

| Function | Live Caller? | Evidence |
|---|---|---|
| `defaultContextCurator.curate` | **YES** | `[asm-probe] curate called iter=0` fired every iteration |
| `ContextManager.build` | **YES** | `[asm-probe] build branch=conv iter=0` fired every iteration; it is called inside `curate` at `context-curator.ts:130` |
| `buildConversationMessages` | **YES** | `build branch=conv` (the `if (adapter)` branch) fired on every iteration — adapter is always provided by `selectAdapter` at `think.ts:282` |
| `buildCuratedMessages` | **NO** (live path) | `build branch=curated` never appeared. It is only reachable when `adapter` is `undefined`; the live path always has an adapter. Used only in test / adapter-less call sites. |

**Conclusion re: prior session's report:** The claim that `ContextManager.build` was NOT on the live path was **incorrect**. The prior `console.error` probe that "never fired" must have been placed incorrectly, in the wrong file or behind a wrong condition. Both `ContextManager.build` AND `buildConversationMessages` ARE on the live path, confirmed by this session's probes.

---

## F3: Inputs Available to the Live Renderer

`defaultContextCurator.curate(state, input, profile, guidance, adapter, options)` receives:

| Input | Available | Notes |
|---|---|---|
| `state.messages` | YES | The live FC conversation thread (`readonly KernelMessage[]`). Passed to `buildConversationMessages` → sliding-window compaction → `toProviderMessage`. |
| `state.scratchpad` | YES | `ReadonlyMap<string, string>`. Accessed in `context-curator.ts` for the recent-observations section (Sprint 3.4). Available on every iteration. |
| `state.steps` | YES | The full observability ledger (`readonly ReasoningStep[]`). Available on every iteration. |
| `state.iteration` | YES | Current iteration count. Used by `buildConversationMessages` for taskFraming (iter=0 check). |
| `state.postConditions` | YES (field present) | `KernelState.postConditions` is defined (`readonly PostCondition[]`). Seeded by runner.ts when `RA_POST_CONDITIONS=1`. Available here but NOT currently read by `buildConversationMessages` or `ContextManager.build`. |
| `state.toolsUsed` | YES (via state) | Full `ReadonlySet<string>` of all tools called this run. |
| `input.requiredTools` | YES | The required-tools list from `KernelInput`. |
| `profile` (ContextProfile) | YES | Tier, token budgets, `recentObservationsLimit`, etc. |
| `adapter` (ProviderAdapter) | YES | Live `ProviderAdapter` from `selectAdapter`. Used by `buildConversationMessages` for `taskFraming` hook and by the curator's context-manager for `buildCuratedMessages`-vs-`buildConversationMessages` branch. |
| `guidance` (GuidanceContext) | YES | Contains `requiredToolsPending`, `loopDetected`, `icsGuidance`, `oracleGuidance`, `errorRecovery`, `actReminder`, `qualityGateHint`, `evidenceGap`. Rendered in system prompt. |
| `options.availableTools` | YES | Classification-pruned tool schemas. |
| `options.systemPromptBody` | YES | Harness-skill-wrapped system prompt body. |

**What is NOT currently available to the renderer:**

- `state.postConditions` is present in `KernelState` but is not read by `buildConversationMessages` or `ContextManager.build`. Deriving a "remaining post-condition" view at render time would require adding a read of `state.postConditions` in the curator or context-manager, with a call to `verifyPostConditions(state.postConditions, state.steps)` to compute which conditions are unmet.

---

## F4: Post-Condition / Goal-State Derivability

**`postConditions` field:** `KernelState.postConditions` exists (`packages/reasoning/src/kernel/state/kernel-state.ts:304`), typed as `readonly PostCondition[]`. It is seeded by `runner.ts` when `RA_POST_CONDITIONS=1`.

**Verification primitive:** `verifyPostConditions(conditions, steps)` in `packages/reasoning/src/kernel/capabilities/verify/post-conditions.ts:197` — pure, ledger-only, no LLM or fs calls. Returns which conditions pass/fail against `state.steps`.

**Is a "remaining state" already derivable from current `KernelState`?**

- The data is structurally present: `state.postConditions` + `state.steps` are both available to the renderer at `curate` call time.
- The verification primitive to compute "which conditions are still unmet" exists and is pure.
- **However**, neither `ContextManager.build` nor `buildConversationMessages` currently reads `state.postConditions` or calls `verifyPostConditions`. To surface a "post-condition ledger" in the rendered prompt, new logic must be added to one of these functions (or to `defaultContextCurator.curate`).
- **No new state or event types are needed** — the existing `postConditions` field + `verifyPostConditions` primitive cover the full requirement.
- `requiredTools` (tracking which specific tools must be called) is separately maintained in `KernelInput` and is already surfaced in `GuidanceContext.requiredToolsPending`. So tool-completion tracking is already partially rendered into the system prompt.

**Grep results for relevant field names:**

- `postCondition`: present in `KernelState` + `post-conditions.ts` + `arbitrator.ts` (post-condition gate). NOT read by `ContextManager.build` or `buildConversationMessages`.
- `goalState`: NOT found anywhere in the codebase.
- `remaining` (as a state field): NOT found. The "remaining required tools" concept is computed on-the-fly via `getMissingRequiredToolsFromSteps` in `think.ts` and surfaced via `guidance.requiredToolsPending`.

---

## Summary

**One-line answer:** `defaultContextCurator.curate` → `ContextManager.build` → `buildConversationMessages` is the live message-assembly path. `ContextManager.build` is NOT dead — it fires on every iteration with a live adapter, taking the `buildConversationMessages` branch.

**The prior session's "build never fired" report was a false negative** — the probe must have been in the wrong location or gated incorrectly.

**Probes reverted:** Confirmed — `git diff packages/reasoning/src/context/context-curator.ts packages/reasoning/src/context/context-manager.ts` produces no output.

---

## Controller reconciliation (verified independently, 2026-05-31)

The Phase-0 finding **reverses a wrong conclusion from earlier this session.** I had committed
an "HONEST CORRECTION" (`86ce02d9`) claiming `buildConversationMessages` was a DEAD function and
"nothing ran live." That was a **false negative** — flawed debug runs (dist/src confusion +
mis-captured logs). Re-verified with the existing `RA_OVERHAUL_DEBUG` projection probe:

```
[overhaul-projection] ENTRY msgs=3 tool_results=1 withStoredKey=1 scratchpadKeys=_tool_result_1
[overhaul-projection] ref=_tool_result_1 tool=github/list_commits fullLen=126647 budget=45875 fired=true
```

**Confirmed:** `buildConversationMessages` IS live; the overhaul projection seam DID fire (a 20-commit
result = **126,647 chars** of full bodies, far over the 45,875-char budget → projected to summary+ref).
The curation default-on (`c9e6fba2`) and the projection were live all along. The budget uses
`profile.maxTokens = 32768` (maxContextTokens), not the operator's 15360 num_ctx — a real mismatch to fix.

## New failure mode (the actual gap) — fabrication when data is removed
With the projection firing (data replaced by a clean summary+ref, no marker), **cogito did NOT call
`write_result_to_file` — it FABRICATED placeholders**: `- Commit 1: [Message 1](commit_url) … Commit 20`
(113 bytes, 3 shown, 0 real). The reference tool being merely AVAILABLE is insufficient: weak models
default to `file_write` and, with no data to copy, **hallucinate.** The isolated spike (`2c5d77bf`)
worked only because the reference tool was the obvious path with no competing `file_write` + full prompt.

**Implication for the plan (Phase 5 `projectResults` + tool):** the deliverable path must **steer or
force** the reference tool — e.g. when a deliverable consumes a stored result, disable raw `file_write`
content authoring (or strongly bias to `write_result_to_file`). Availability ≠ adoption on weak tiers.
This is the real lever the cross-tier N≥3 proof must validate.
