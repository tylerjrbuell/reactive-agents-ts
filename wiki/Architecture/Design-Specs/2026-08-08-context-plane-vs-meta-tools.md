# Context management without meta-tools — a design, not a bandaid

**⚠️ SUPERSEDED by [[2026-08-08-control-plane-vs-meta-tools]]** (the elegant unifying form: one invariant — the FC array is domain-only). This doc is retained as the EVIDENCE APPENDIX (tool-taxonomy table §3a, wire-probe attribution §3b/§3f, leading-harness patterns §2). The per-tool framing here is subsumed by the single invariant in the successor.

**Status:** SUPERSEDED (evidence appendix). Was: DESIGN (proposed). Answers: should meta-tools (`recall`/`discover-tools`/`final-answer`) exist at all, or do they compensate for a design leading harnesses avoid?
**Trigger:** meta-tool floor is a measured +73% per-call token tax on the kernel path (`tool-surface.ts:232`; see [[../../Planning/Implementation-Plans/2026-08-08-move-1-single-loop|Move 1 plan §3b]]) AND an extra-step temptation. Gating them is a bandaid; this is the redesign.
**Does NOT** rewrite 09 (amend it if sequencing changes) or bundle into the Move 1 branch.

---

## 1. What each meta-tool actually solves (from code)

- **`recall`** — expands a compressed tool result. Tool results go to a `ResultStore` (`assembly/result-store.ts`) keyed by an **OPAQUE ref** (`res_<hash>` content-hash, or `_tool_result_N` scratchpad key). Context renders **preview+ref** (`stages/project-results.ts`); the recency-split keeps the latest/sole result full, collapses older ones. `recall` fetches an older full result by ref. The `recallable` flag + H2's "blind-recall lure" fix exist because advertising recall for a non-resolvable ref made models thrash on invented keys. **NOTE: `recall` is result-store expansion — NOT the memory layer. (An earlier fix suggestion "gate recall on memory" was wrong; corrected.)**
- **`discover-tools`** — lazy disclosure: show a tool subset, let the agent find the rest. Compensates for over-broad tool exposure.
- **`final-answer`** — explicit termination sentinel. `looksLikeFinalAnswer` (`think.ts:128`) auto-promotes because local models "produce a complete response but never call final-answer"; `think.ts:115` reserves final-answer-only under critical token pressure.

## 2. Why the design forces the tools

**The opaque ref is the root.** `res_<hash>` / `_tool_result_N` cannot be re-derived from the world — so expanding a compressed result REQUIRES an internal store + a tool to read it. Leading harnesses don't need a recall tool because **their "ref" IS a reproducible source**: a file path you `Read` again (with offset/range), a query you re-run, a grep you repeat. The affordance is the normal tool the agent already holds.

- **Claude Code:** filesystem is the store; huge outputs truncate with a marker; re-`Read`/grep re-fetches; auto-compaction summarizes old turns. No recall tool.
- **Anthropic API:** context-editing clears stale tool results server-side as the window fills (harness-owned, invisible); file-backed memory tool for durable state; prompt caching makes keeping more affordable.
- **Cursor/Windsurf:** codebase index + semantic retrieval — reproducible.
- **LangGraph:** developer-managed state + checkpointing; retrieval is wired, not an agent meta-tool.

**Common thread:** context is owned by the **harness** (auto-prune/rehydrate, free, invisible) or the **world** (reproducible refs re-fetched with normal tools). The agent's tokens are for the task. RA instead pushed context management INTO the agent's FC array (per-call tax + cognitive load + misuse risk).

## 3. The fix — prediction-free first

### 3a. LEAD: reproducible refs (no prediction, no meta-tool)
When a tool result is derived from a re-fetchable source, the ref should BE the source + locator, and expansion is the **original tool**:
- file `Read` → ref = `path + line-range` → re-`Read` that range.
- `web-search`/query/grep → ref = the query → re-run.
- The `ResultStore` keeps such results as **source-pointers**, not opaque blobs; the projector renders "preview + how to re-fetch with the tool you have," not `recall("res_ab12")`.

**This is the strong half — it needs no harness intelligence, cannot lock the agent out (the affordance is a normal tool), and deletes `recall` for the reproducible majority.**

**Tool-taxonomy pass (2026-08-08) — quantified.** Real domain tools (meta/pseudo excluded), by result-reproducibility:

| Reproducible — ref = tool+args, re-fetch via origin tool | One-shot result — keep store / gated rehydrate | Mutation — no result to recall |
|---|---|---|
| file-read, list-directory, web-search, rag-search, http-get, crypto-price, scratchpad-read | shell-execute stdout, code/docker-execute stdout, request-user-input | file-write, scratchpad-write, rag-ingest |

**The results large enough to be compressed to preview+ref — files, search sets, HTTP payloads, directory listings — are overwhelmingly REPRODUCIBLE.** The non-reproducible residue (shell/code stdout, a user's answer) is small or rare. So `recall` disappears for the majority of its actual use; the store + gated auto-rehydration (§3b) survive only for the residue.

**Feasibility:** `StoredResult` (`result-store.ts`) already carries `tool`; the originating **args are available at store-construction** (`gather-dedup.ts:96` `argsByCallId` by toolCallId; `from-kernel-state.ts` `toolName` per storedKey). So building a reproducible ref = thread args onto `StoredResult` + render "re-fetch via `<tool>(<locator>)`" in place of `recall("res_<hash>")`. No deep plumbing.

### 3b. GATED: auto-rehydration for the non-reproducible residue
For genuinely one-shot results (a mutating API call's response), keep an internal store but **re-inject the full result automatically when the step needs it** (curation from the ledger/assessment) — the agent never calls a tool.
**⚠️ This is harness relevance-prediction — the class this repo has FAILED at twice:** the tool-relevance classifier (0pp lift, 2×6 cells, demoted opt-in) and lazy pruning (deliverable failure on small models, 2/12 vs 11/12, p≈3.2e-4). So auto-rehydration is a **lift-rule candidate, not the design** — it must clear ≥3pp / ≤15% (rungs 2+3 sign-agree) or stay off. Reproducible refs (3a) stand alone if it fails.

### 3c. `discover-tools` → right-size the tool set upfront
Measured: `discover-tools` "buys nothing" locally (prune-only ≈ prune+discover, both deliver). It compensates for over-broad exposure + lazy pruning. Fix: the harness/orchestration selects the task-scoped tool set at the start (RA has `requiredTools` + relevance inputs). Right-sized ⇒ nothing to discover ⇒ drop the meta-tool (or reduce it to a rare pressure-only affordance). Also removes the discover-thrash failure mode.

### 3d. `final-answer` → dialect-aware, retained where load-bearing
- **native-FC:** absence of a tool call IS the terminal — don't inject `final-answer` as a peer tool (also dialect-blindness #3).
- **text-parse + critical-pressure:** RETAIN — `looksLikeFinalAnswer` + the pressure-only arm are load-bearing there. Not a removal; a dialect gate.

### 3e. NOT proposed: prompt caching as the escape hatch
Checked: the default path caches **nothing** — inline `cacheRead=0`, shipped kernel default (`prune+discover`) `cacheRead=0`; only opt-in `no-prune`/`stable-surface` achieve reads (pruning churns the cached prefix — the F10 tension). So "keep more, cache makes it cheap" is NOT available on the default today. Out of scope here; it's the separate F10 question.

## 3f. Measured priority correction (RA_WIRE_PROBE, 2026-08-08)
Wire-level probe of the actual FC array (gemma4 native-fc) reorders the fixes by measured impact — and corrects a confound:
- **`recall` is NOT in the wire FC array** (gated out by the recall-overflow gate; visible ≠ callable ≠ wire). So §3a/§3b (reproducible refs / rehydration) are sound DESIGN but are **not** the current native-fc token tax — they matter only when `recall` is actually surfaced (large recallable results). Lower priority than believed.
- **The native-fc wire tax is `final-answer` (~1713 chars ≈ 428t/call) + `discover-tools` (~1000 chars).** So **§3d (final-answer dialect-gate) is the single highest-value cut** — on native-fc it is pure waste (no-tool-call = done). **§3c (right-size discover-tools) is second.** Both are prediction-free.
- Revised sequence: **§3d → §3c** (measured native-fc wins, prediction-free) → **§3a** (reproducible refs, when recall is surfaced) → **§3b** (rehydration, lift-gated).

## 4. The principle (one line)
**Context management is the harness's job or the world's — never the agent's.** A meta-tool that makes the agent manage its own memory/tools/termination is a design smell: it taxes every call and burdens the agent. Move the responsibility to the harness (deterministic, free) or the world (reproducible refs, normal tools).

## 5. Anti-lockout — the redesign is STRONGER, not weaker
The user's concern: meta-tools prevent the agent getting stuck / locked out of context. Reproducible refs are strictly better at this than `recall`: the agent re-fetches with a tool it already has, and cannot be locked out by an unresolvable opaque key (the H2 lure). Auto-rehydration (proactive, harness-driven) beats recall (reactive, requires the agent to realize it's missing something) — WHEN it predicts well, which is why it's gated, not assumed.

## 6. Relation to Move 1 / the token tax
This IS the principled version of Move 1's P2. Gating meta-tools (the bandaid) cuts the tax; this redesign removes the *reason* they were floored. The FC array carries only task tools by construction ⇒ tax gone + thrash gone. Sequence: land 3a (reproducible refs) first (prediction-free, de-risks P2), measure the tax drop, then 3c/3d; 3b only if it clears the lift rule.

## 7. Non-goals
- No new north-star doc (amend 09 if this re-sequences).
- No bundling into the Move 1 branch — separate work, separate branch.
- No caching leg (§3e — unavailable on default).
- Not removing `final-answer` (§3d — dialect-gated retain).
