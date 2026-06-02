---
title: How frameworks handle context length / large tool results — competitive research + recommended design
date: 2026-06-01
status: research → design-recommendation
supersedes-section: "[[2026-05-29-tier-aware-context-architecture]] §Knob split (the 'do NOT touch toolResultMaxChars' call)"
relates: [phase1-postcond-ab-2026-06-01, 2026-05-29-tier-aware-context-architecture]
---

# Context-length handling — competitive research (2026-06-01)

Triggered by the T3 truncation defect (`phase1-postcond-ab-2026-06-01.md`):
frontier sonnet (budget 600) sees 3/25 array rows → balks ("retrieve full
content") → 0/3 selection. User asked: research how other frameworks do it,
determine the best way, keep USER CONTROL at the forefront with sensible
TIER defaults.

## What the field does

| Framework | Large-tool-result strategy | Budget keyed to | Control surface |
|---|---|---|---|
| **LangChain Deep Agents** | At **85% of the window**, offload old tool calls → POINTER-to-file on disk; summarize when offload insufficient | **% of actual window** | configurable threshold |
| **Anthropic** (context editing + memory tool) | Auto-trim obsolete tool results as token limits approach; memory tool stores OUTSIDE context, retrieve via tool ("just-in-time, lightweight identifiers"). Context-editing alone +29%; with memory +39%; 100-turn run −84% tokens | token limit / window | API params on context-editing + memory |
| **OpenAI Agents SDK** | `truncation: auto` (oldest-first until it fits) \| `disabled` (fail-fast `context_length_exceeded`); server-side `compaction` at a token threshold | window threshold | `ModelSettings.truncation`, `compact_threshold`, `max_tokens` |
| **Mastra** | Composable **memory processors** chained (`ToolCallFilter` strips verbose tool calls); per-request `memoryOptions` override | per-config | processors array + per-request override (control-first) |

### Authoritative numbers (research, not vendor copy)
- **Effective window ≈ 60–70% of claimed** (Chroma *Context Rot*, Jul 2025, 18
  frontier models incl. Claude 4 / GPT-4.1 / Gemini 2.5 — all degrade as length
  grows). NVIDIA **RULER**: only ~half of models perform acceptably at their
  claimed 32K.
- **Practical tool-output budgeting:** "large enough for system prompt +
  immediately-relevant retrieved context + last few turns, with **30–50%
  headroom for tool outputs**" — i.e. a FRACTION of the effective window.

## The two decisive lessons

1. **Budget is a FRACTION OF THE EFFECTIVE WINDOW — never a fixed per-tier char
   constant.** Every serious framework keys truncation/offload to a % of the
   model's actual (effective) window. RA's hardcoded `toolResultMaxChars`
   (frontier 600 < large 800 < mid 1200 < local 4000) is the anti-pattern — and
   it is exactly WHY the table looks inverted: a 200K-window frontier model
   truncating a tool result at 600 chars is clamping to 0.3% of its window, while
   a (modern, 32K+) local model gets 4000. Disconnected from the window, the
   constants drift into incoherence.
2. **Offload + just-in-time retrieval only works if retrieval is RELIABLE.** RA
   already has the offload half (preview+ref / `ResultStore` / `recall`) — the
   universal pattern. But RA's evidence (Increment 1 of the tier-aware spec, +
   the sonnet T3 balk) shows retrieval is UNRELIABLE: models recall blindly
   (invented keys) or refuse to recall and balk. So shrinking the inline preview
   and "trusting recall to fill the gap" fails on exactly the models the current
   budgets starve.

## Why this OVERTURNS the existing spec's call

`2026-05-29-tier-aware-context-architecture.md` §"Knob split" DELIBERATELY keeps
`toolResultMaxChars` local=4000 > frontier=600, premised on: *"weak local models
won't recall → give them MORE inline; frontier can recall overflow → give it
less."* The T3 evidence falsifies the premise's second half: **frontier sonnet
does NOT recall the overflow — it balks and never answers.** The premise's first
half is fine (weak models need data inline) but the CONCLUSION (frontier needs
little inline) is wrong, and the fixed-constant framing produced the inversion.
The window-fraction reframe RESOLVES the original tension cleanly: modern local
models (cogito:14b / qwen3.5 report 32K–131K windows) ALSO get a large budget
(they need it AND can afford it); only genuinely tiny windows get small budgets —
correctly. (The spec itself already notes the 4096 local default is stale and
`recommendedNumCtx` should override — same direction.)

## ‼️ FINAL CORRECTION (kernel-warden veto + git timing) — the defect was ALREADY FIXED

Both the per-tier-budget framing AND the conversation-assembly-byte-slice framing
below are MOOT for the live default. A kernel-warden, asked to implement, REFUSED
and ran the LIVE `buildConversationMessages` pipeline (my repros never did — they
hand-reimplemented slices). Result: all 25 fixture posts reach the provider at
frontier/mid/local-8k/local-4k, no truncation marker; only a 2048-token window
truncates. Cause: **`applyAgeAwareCuration` (`RA_CURATION_AGEAWARE !== "0"`,
DEFAULT-ON since 2026-05-30, `context-utils.ts:229`) runs AFTER assembly and keeps
the synthesis-target result FULL.** My `diag-assembly.ts` OMITTED this default-on
stage → modelled a pre-fix world.

Git timing is decisive: curation flip `799487c1` = 2026-05-30 **19:47**; the sonnet
T3-strict 0/3 baseline ran 2026-05-30 **13:58** (~6h BEFORE the fix). Docstring
`tool-formatting.ts:519`: curation ON → 21646 chars delivered (vs 4000 truncated),
**sonnet T3-strict 1/3→3/3**, zero regression. `799487c1` is an ancestor of HEAD.

**∴ The frontier truncation defect was REAL but SHIPPED-FIXED 2026-05-30. The
sonnet 0/3 was a stale pre-flip number. Changes A+B (below) are DROPPED — inert
(curation overwrites the conversation-assembly path; the compressToolResult
middle-tier never fires on the live recent branch).**

What survives as genuine, separable work:
- The **field research below is still valid** and correctly informed the design
  (structured offload beats byte-slice; budget keyed to effective window) — it
  matches what age-aware curation already does (window-scaled `recentCharBudget`).
- **Narrow latent improvement (re-justify on own merits):** arrays whose raw
  exceeds the window-scaled `recentCharBudget` (very large results, or tiny 2048
  windows) STILL byte-slice in curation's RECENT branch (`tool-formatting.ts:633-
  640`). A reduced-field-all-items render THERE (the right seam, not conversation-
  assembly) would degrade gracefully. Decoupled from the T3 metric.
- The **actual Phase-0 T3 gap is NOT truncation:** cogito = wrong-field sort
  (reasoning), qwen = no-filter dump (instruction-following) — both SEE all 25 at
  their (large) local window and still fail. A reasoning/verification concern.

PROCESS LESSON (4th isolation≠composition burn this session): never hand-
reimplement a pipeline slice; reproduce through the REAL entry point
(`buildConversationMessages`). The warden did and was right.

---

## Recommended design (control-first, tier-sensible, window-derived) — [SUPERSEDED by the correction above; retained for the field synthesis]

**Substrate already present — wire, don't rebuild** (per the tier-aware spec
inventory): `applyCapabilityMaxTokens` resolves the effective window from
`capability.recommendedNumCtx`; `ModelCalibration.optimalToolResultChars` is a
per-model MEASURED override that already exists; `withContextProfile({
toolResultMaxChars })` is the explicit per-agent override.

**1. Make the default tool-result budget WINDOW-DERIVED, not a tier constant.**
```
toolResultMaxChars (default) =
  clamp(
    effectiveWindowTokens * SINGLE_RESULT_FRACTION * CHARS_PER_TOKEN,
    FLOOR,      // never so small that one array row is unreadable
    CEILING     // never so large it crowds the recency/history budget
  )
```
- `effectiveWindowTokens` = `recommendedNumCtx` (already probe/calibration-resolved;
  the conservative ~60–70% effective figure is what the probe returns).
- `SINGLE_RESULT_FRACTION` ≈ a few % (a SINGLE result, not the 30–50% TOTAL
  tool-output headroom — many results share that budget). Tune empirically.
- This auto-corrects the inversion: frontier 200K → generous; tiny local → small.

**2. Precedence (control-first — every knob overridable, transparent):**
`per-agent override (withContextProfile) > calibration.optimalToolResultChars
(measured) > window-derived default > hard floor/ceiling`. Tier becomes a FALLBACK
only when no window resolves. Document the resolved value in `rax:diagnose`.

**3. Orthogonal token-efficiency win — column-drop before row-drop** in
`compressToolResult` (kernel): when full-detail all-items overflows the (now
window-derived) budget, render ALL items at REDUCED width (drop url, tighten
title to ≥~30 chars so the grader/model can still match, keep numeric selection
fields) BEFORE falling to a 3-item preview. A rank-by-X task needs every item's
X; K minimal rows beat 3 full rows. Keeps token cost down even with a generous
budget, and scales to 50–100-item arrays a bigger budget alone won't fit.

**4. Don't over-trust recall.** Since retrieval is unreliable, the inline budget
must be sufficient for the COMMON selection case (the offload path is the safety
valve for genuinely huge results, not the primary plan). This is the opposite of
"shrink inline, lean on recall."

## Control-first checklist (user requirement)
- `withContextProfile({ toolResultMaxChars, toolResultPreviewItems })` — explicit, wins.
- `withCalibration` / `optimalToolResultChars` — measured per-model, fills what user didn't pin.
- Window-derived default — sensible, transparent, tier-adaptive WITHOUT hardcoded inversion.
- Hard floor/ceiling — last-resort guardrail.
- Every layer logged in diagnostics so the resolved budget is never a mystery.

## Measurement plan (default behavioral change → must be measured)
Cross-tier `pass^k` on the PINNED fixture (`hn-fixture-2026-06-01.json`), before/after:
- **Targets the visibility/balk failure** → expect MID (gpt-4o-mini) + FRONTIER
  (sonnet) T3-strict 0/3 → >0; tokens within headroom.
- **Will NOT fix** local cogito (wrong-field sort = reasoning) or qwen (no-filter
  dump = instruction-following) — they already see all 25 at budget 4000. Do not
  misread a non-uniform result as failure.
- Per project lift rule (≥3pp lift, ≤15% token overhead): the column-drop keeps
  the token cost of the larger budget bounded; the window-derived default is a
  correctness/faithfulness fix on the starved tiers.

## ⚠️ CORRECTION (full-path reproduction overturns the per-tier-budget framing)

Advisor flagged a SECOND cap; reproducing the REAL assembly path (not
`compressToolResult` in isolation) overturns the "inverted per-tier budget" root
cause:

- `conversation-assembly.ts:105-128` (G-4 closure): when an observation has a
  `storedKey`, assembly inlines the **FULL RAW result from scratchpad**, BYTE-SLICED
  at a tier-INDEPENDENT `TOOL_RESULT_INLINE_CAP = 4000`, with a "…truncated (N
  chars). Full available via recall(…full:true)" marker. It uses
  `fullFromScratchpad ?? obsStep.content` → it PREFERS raw and **throws away
  `compressToolResult`'s structured preview entirely.**
- Reproduced on the pinned 25-post fixture (raw 4874 chars) at ALL four tier
  budgets: **identical output — 4039 chars raw JSON, 21/25 posts surviving,
  truncation marker present.** The per-tier `toolResultMaxChars` (600/800/1200/4000)
  is **INERT for model-visible content** — once raw > 4000 the inline cap binds on
  every tier. `compressToolResult` even renders all 25 cleanly at budget 4000
  (~3933 chars) and assembly discards it to byte-slice raw instead.

**Revised root cause (definitive):** the G-4 raw byte-slice at 4000 — it (a) drops
tail array items (4 of 25 here — possibly the answer) and (b) emits a truncation
marker that induces the frontier BALK ("retrieve full content", never answers).
The structured preview (`compressToolResult`, all-items reduced ≈ 1850 chars) would
fix BOTH — complete coverage, no marker, under the cap — but assembly never uses it.

**Revised fix (both KERNEL → kernel-warden):**
1. **`conversation-assembly.ts`: when raw > inline cap, use the STRUCTURED preview
   (`obsStep.content`) instead of byte-slicing raw.** Complete-coverage structured
   content beats a raw byte-slice (lost tail + balk marker). THE primary fix.
2. **`compressToolResult` column-drop** — now LOAD-BEARING (assembly will actually
   use its output): render all items at reduced width so the structured preview
   covers everything AND fits the cap.
3. The inline cap (4000) MAY later be window-derived — secondary; the byte-slice→
   structured swap is the lever and makes the exact cap less critical.

**DROPPED from the plan:** window-derived per-tier `toolResultMaxChars` — INERT for
this defect (the inline cap dominates). Avoid shipping it as a no-op (§9). The
field's "% of window" principle still applies to the INLINE CAP, not the per-tier
preview budget.

## Open decision for the user
Scope of the first cut:
- (i) window-derived budget + column-drop (full fix, supersedes the inverted
  constants; default behavioral change measured cross-tier), or
- (ii) minimal: just raise frontier/large/mid to a sane floor now, defer the
  window-derived machinery, or
- (iii) column-drop only (insufficient for frontier 600 alone — needs a budget move).

Sources:
- LangChain Deep Agents context management — https://www.langchain.com/blog/context-management-for-deepagents
- Anthropic context management / context editing + memory tool — https://www.anthropic.com/news/context-management , https://platform.claude.com/docs/en/build-with-claude/context-editing
- Anthropic effective context engineering — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- OpenAI Agents SDK model settings (truncation) — https://openai.github.io/openai-agents-python/ref/model_settings/
- Chroma Context Rot / RULER summary — https://www.digitalapplied.com/blog/context-engineering-agent-reliability-playbook-2026
- Mastra memory processors / per-request override — https://mastra.ai/en/docs/memory/memory-processors , https://mastra.ai/docs/agents/agent-memory
