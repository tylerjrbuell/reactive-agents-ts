# Subsystem Audit — Context/Prompt Assembly

**Date:** 2026-07-29. **Part of:** [[00-overview|Systems Audit — Root Cause Analysis]].

**Scope (as given to the auditing agent):**
> Context/Prompt Assembly pipeline (packages/reasoning/src/assembly/*, context-engine.ts, anthropic.ts caching)

## System health summary

The pipeline is well-architected where it has been stress-tested: the F10 cache-prefix fix is correctly ordered (volatile-tail runs after compaction, before finalize), tool-list construction throughout select-tools/tool-surface/tool-schemas.ts consistently uses Sets only for membership checks and derives output order from stable source-array `.filter()` -- the non-deterministic-ordering cache-breaking pattern asked about does NOT reproduce anywhere I checked. The weak points are at the seams between tiers and between what a mechanism was DESIGNED to do versus what its wiring actually reaches: two genuinely new defects found here (the dead local-tier tool-grouping branch, and compaction's non-recallable-ref silent loss) both have the same shape as the project's own prior catalogue entries -- a mechanism built and tested in isolation whose real-world trigger condition was never verified against the actual default configuration. goal_state's write-only status (D-2026-07-28-C) is confirmed still true, and its file:line citation in the register is now stale after the F10 relocation into volatile-tail.ts.</systemHealthSummary>


## Findings

### 1. Local-tier's purpose-built 'Required tools (call these)' grouping is unreachable dead code under the tier's own default profile

🟠 **Severity:** high · **Confidence:** confirmed · **New this audit:** True

**Evidence:** packages/reasoning/src/context/context-engine.ts:131 guards the grouped rendering with `if (tier === "local" && detail === "full")`. packages/reasoning/src/context/context-profile.ts:83 sets `CONTEXT_PROFILES.local.toolSchemaDetail = "names-and-types"` (not "full") -- the only tier profile that isn't "full" (mid/large/frontier all set "full", lines 100/109/118). Live probe against the real production path (`buildThinkProviderRequest` -> `project()` -> `systemPromptStage` -> `buildToolReference`, using the unmodified `CONTEXT_PROFILES.local` object and `state.meta.requiredTools = ["web-search"]`) rendered:
```
Available Tools:
- web-search(query: string)
- write-file(query: string)
```
with `request.systemPrompt.includes("Required tools (call these)")` = false and `.includes("Other available tools")` = false -- required and non-required tools are rendered identically, flat, no distinction. The sole existing test for this branch, `packages/reasoning/tests/context/tier-tool-compression.test.ts:14`, only exercises it by hand-passing the literal string `"full"` as the 4th argument -- a value the real local ContextProfile never produces -- so the test proves the branch works in isolation while masking that it is never reached by any real local-tier run.

**Mechanism:** buildToolReference's tier-adaptive dispatch checks `detail === "full"` before branching into the local-tier grouped/micro rendering (context-engine.ts:131-146). CONTEXT_PROFILES.local sets toolSchemaDetail to "names-and-types", which instead satisfies the generic fallback's `detail === "names-and-types"` check (line 159) and renders every tool -- required or not -- via the same flat `formatToolSchemaCompact` list used for >20-tool overflow on any tier. The required/other split and the required tools' extra param detail (vs. micro-truncated descriptions for everything else) were written specifically 'for weak-FC local models' per the module's own docstring, but the profile wiring that would trigger it was never aligned with the branch's guard condition.

**Downstream impact:** Local/weak-FC models -- the tier this mechanism exists to help -- get the least differentiated tool-reference text of any tier: no visual/textual priority signal for tools the dispatcher requires, and no tool gets a description if the surface also exceeds the generic 20-tool ceiling. This runs opposite to the framework's stated small-model-uplift direction and is a plausible (unmeasured) contributor to the local-tier tool-selection failures already in the catalogue (F7/F8's local-tier misses), though no live A/B has isolated this specific mechanism yet.

**Cross-tier behavior:** Confirmed dead specifically on local tier by construction -- mid/large/frontier profiles set toolSchemaDetail:"full" so they never even reach this guard; this is a local-only regression relative to the mechanism's intent. Live-model behavioral consequence (does a weaker model actually mis-call tools more often without the grouping) is untested cross-tier.

### 2. Compaction's 'honest stub' silently omits non-recallable (small/inline) tool results from its retrieval disclosure -- a live analog of FM-F1

🟠 **Severity:** high · **Confidence:** confirmed · **New this audit:** True

**Evidence:** packages/reasoning/src/assembly/compaction.ts buildStub() (lines 151-165) only enumerates `recallableRefs` -- refs starting with `_tool_result_` (packages/reasoning/src/assembly/ref-grammar.ts:46-47 `isRecallableRef`). packages/reasoning/src/assembly/from-kernel-state.ts:139-156 mints a NON-recallable `res_*` ref via `store.put()` for any tool_result lacking `msg.storedKey` -- which is every tool result the kernel did NOT auto-store to the scratchpad. packages/reasoning/src/kernel/capabilities/attend/tool-formatting.ts:234 `compressToolResult`: `if (result.length <= budget) return { content: result };` -- no `.stored` key at all below the budget (800/1200/4000/600 chars per tier, capability.ts:56-61), i.e. the common case for ordinary tool output. Direct probe run against the real `compact()` function: 6 small (~45-char) successful tool results (non-recallable `res_0..5`) plus one large recallable one, over budget -> `droppedRefs: ["res_0".."res_5"]`, and the emitted stub was exactly `[history compacted: 7 earlier exchange(s) dropped to fit the context window.]` with NO retrieval sentence and no mention that 6 results are gone -- versus the recallable case, which appends `Their full results remain retrievable by reference: recall(...)`. Every existing compaction test (`packages/reasoning/tests/assembly/compaction.test.ts`) constructs dropped exchanges exclusively via `mintScratchpadRef`/`storedKey`, i.e. only the recallable path is covered by the suite.

**Mechanism:** compact()'s protected-class design (goal / preserveOnCompaction / most-recent-evidence) correctly guards against dropping what the model still needs THIS turn, and its stub design was built specifically to end 'summarized lies that pointed at nothing' (03-F4). But the stub's honesty guarantee is scoped to refs in the scratchpad namespace only -- results that were small enough to stay inline (never promoted to the scratchpad by tool-execution.ts's compression gate) get a `res_*` ref from a fresh per-render `ResultStore` that has no life beyond the current `project()` call. When such a block is later dropped by the full-window safety valve, its content is permanently unrecoverable to the model, and the stub gives no signal that anything unrecoverable happened -- it reads identically to a run where nothing was actually lost.

**Downstream impact:** Breaks the same invariant F1/F2/03-F4 were about (the framework's 'no dishonest completions / no lying stubs' spine) for exactly the majority case: most tool calls in an ordinary run produce output below the per-tier compression threshold and are therefore non-recallable once dropped. A long-running agent that legitimately needs an early small tool result later (e.g., 'the user ID returned by lookup #2') has no recourse and no warning once compaction fires, only a generic 'N exchanges dropped' note.

**Cross-tier behavior:** Tier-independent mechanism (compact() has no tier branch), but more likely to fire on local tier in practice: toolResultPreserveBudget is most generous there (4000 chars, capability.ts:57), encouraging longer accumulated threads, while local-tier real context windows (via applyCapabilityMaxTokens/recommendedNumCtx) tend to be the smallest of the four tiers -- making the window*4-char full-window safety valve reachable soonest on exactly the tier where results are also least likely to be recallable proportionally. Not verified against a live cross-tier trace; DEBT-REGISTER already notes compaction rarely fires at all post-Wave-3 (full-window-only threshold), so occurrence rate in practice is unmeasured.

### 3. Two AgentEvent kinds (`observation`, `terminated`) have zero writers AND zero readers anywhere in the repository -- fully vestigial schema, a broader instance of the goal_state pattern

⚪ **Severity:** low · **Confidence:** confirmed · **New this audit:** True

**Evidence:** packages/reasoning/src/assembly/event-log.ts:17,19 declare `{kind:"observation";text}` and `{kind:"terminated";reason}` in the `AgentEvent` union. Exhaustive grep across the whole repo (`grep -rn 'kind: "observation"\|kind: "terminated"'`) finds these two kinds constructed NOWHERE -- not in from-kernel-state.ts (the sole live adapter), not in any other production file, and not even in a hand-authored test fixture (unlike `goal_state`, which at least has two test-only writers per D-2026-07-28-C). Cross-checking every `.byKind(...)` call site in `assembly/stages/*.ts` (`tool_result` in compact-history.ts:25, `goal_state` in volatile-tail.ts:34, `goal`/`tool_called` in project-results.ts:36/100, `goal` in system-prompt.ts:53) confirms neither `observation` nor `terminated` is ever READ via byKind either.

**Mechanism:** The AgentEvent union was declared with a wider vocabulary than any producer or consumer ever adopted -- likely scaffolding for a planned observation-event / termination-event rendering path that was never wired on either end, unlike goal_state which at least has a live reader (volatile-tail.ts) waiting on a producer. Because there is neither a writer nor a reader, this carries zero runtime blast radius today, but it is exactly the shape `scripts/check-orphans.sh` (DEBT-REGISTER, Wave 4) is designed to catch for OTHER declared kinds (e.g. the ratcheted `handoff` baseline) -- these two appear to have escaped that guard, worth confirming whether the orphan-check's glob covers `event-log.ts`'s AgentEvent union at all.

**Downstream impact:** None currently (dead code, not a live behavioral bug) -- but it is a maintenance/clarity hazard: a future engineer reading `event-log.ts` reasonably assumes `observation` and `terminated` are populated somewhere, as `goal_state` appeared to be until the D-2026-07-28-C investigation. Worth folding into that same discharge task (wire or delete) rather than leaving as separate unexplained dead surface.

**Cross-tier behavior:** Not tier-dependent -- a structural schema-drift issue independent of model tier.

### 4. Tool-result compression budgets for large/frontier tiers (800/600 chars) carry no tier-specific empirical citation, unlike local's dated justification -- an inconsistent evidence bar across the same table

⚪ **Severity:** low · **Confidence:** suspected · **New this audit:** True

**Evidence:** packages/reasoning/src/context/context-profile.ts:74-122 (`CONTEXT_PROFILES`): local.toolResultMaxChars=4000 carries an inline dated rationale ('Bumped 2000 -> 4000 (2026-05-28). Filter tasks... need ALL items visible... Local models routinely ship 32K+ context'). large=800 and frontier=600 carry no comparable inline citation -- packages/reasoning/src/assembly/capability.ts:38-46 describes the split methodology (recencyBudgetChars vs toolResultPreserveBudget) as validated by a named Phase-A 2026-06-02 measurement, but that measurement's cited numbers (27% bloat, 45875 vs 1200) pin the MID-tier value (1200), not large/frontier's.

**Mechanism:** The per-tier constant table (`TIER_TOOL_RESULT_PRESERVE` in capability.ts:56-61) mirrors the pre-existing legacy `CONTEXT_PROFILES[tier].toolResultMaxChars` table by design ('Phase 1b: single source of truth... instead of maintaining a mirror table'), which correctly prevents value drift between the two locations, but does not establish that the underlying large/frontier constants were independently re-validated post-refactor -- only that they are now read once, consistently, wherever they came from originally.

**Downstream impact:** If large/frontier's per-result budgets (800/600 chars, the tightest of any tier) are stale legacy guesses rather than tuned values, cloud/frontier-tier runs may be over-compressing ordinary tool results into preview+ref relative to what those models' actual context economics justify -- the opposite risk from the local-tier filter-task regression that DID get measured and fixed.

**Cross-tier behavior:** Untested cross-tier for large/frontier specifically; only local's value has a dated regression citation in-repo.
