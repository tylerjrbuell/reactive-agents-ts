---
type: implementation-plan
status: active
created: 2026-11-02
updated: 2026-11-02
tags: [implementation-plan, harness, convergence, simplification, terminal-gate, stall-guard, tool-surface, eval]
spec: "[[../../Research/Audit-Reports-2026-11-02/harness-leverage-diagnosis]]"
governed-by: "[[../../Architecture/Specs/09-UNIFIED-PROGRAM]]"
---

# Plan 8 - Harness convergence (instrument, one terminal funnel, stop the bookkeeping tax, then simplify by evidence)

**Problem.** The kernel is ~41.8k non-test LOC with ~20 independent steer/terminate deciders, yet the observable failures cluster at three boundaries: terminal/deliverable labels (R1), model-owned bookkeeping feeding the stall guard (R2), and tool-schema payload on small windows (R3). Defaults carry mechanisms with no measured lift (6 measurements, 0 cleared the bar). See the diagnosis for evidence and its limits. This plan converges, it does not add a mechanism.

**Rules.** 09 is authority; amend it, no new north star. Lift rule for any default-on or any behavior-changing removal: >=3pp accuracy AND <=15% billed tokens, cross-tier (>=2 tiers), `ablation-warden` veto. No bench-scoring change mid-run. Instrument before conclusion: a surprising number indicts the instrument first. Wire it AND pin it. One concern per commit, land on `dev`. No AI co-author trailers.

**Non-goals.** No new strategy, no new guard, no new default-on mechanism without an ablation. No deleting a mechanism from taste: deletion needs a flag-off ablation or a replay-corpus INERT verdict on a corpus that can see it.

## Tasks (sequenced)

### Wave 0 - evidence (cheap, parallel, unblocks the rest)

- **H1 - harness-warden.** Collect the first corpus with the 21340860d `wire-request` fact: umami/MCP 5-task set, gemma4:12b + gemma4:e4b (local) and haiku-4-5 or gemini-flash (frontier), n>=5. Report `toolsShipped`, schema tokens per request, `numCtxSource`, clamp rate. Copy committed traces to `wiki/Research/Harness-Reports/2026-11-0x-wire-corpus/` (live dir is pruned). Gate: report states schema-token share of prompt as measured (replaces the inferred ~90%). No source edits.
- **H2 - harness-warden + tools-warden.** Record serialized tool-schema bytes/tokens on `llm-exchange` (scoreboard "GAP"). tools-warden owns the schema serializer hook; kernel-warden owns the trace field only if it is in `observable-llm.ts`. Red-on-cut: a test that fails if `llm-exchange` lacks the schema size for a request with tools.
- **H3 - harness-warden.** Rebuild the real-task eval: freeze 12-20 tasks (existing 5 real-world tasks + census failure shapes: plan-only, todo-heavy, MCP-wide, required-tools, continuation-as-answer), pass^k (k>=5), 2 local tiers + 1 frontier. Runner under `packages/benchmarks`; results committed. Gate: baseline recorded on current `dev` HEAD before any W1-W3 change; instrument check (print tool surface per arm) done before reading outcomes.
- **H4 - harness-warden.** Re-run composite bare/lean/full on HEAD with billed-token accounting (`harness-cost-attribution` / `disclosure-ablation`), >=3 task shapes, 2 tiers, n>=5. Replaces the 07-28 single-task number. Gate: report with per-arm tokens, calls, iterations, correctness, and caveats.
- **H5 - debrief note (main thread).** Amend project memory and `.agents/MEMORY.md`: mark the "555-640%" figure retracted in the simplification entry. Docs only.

### Wave 1 - correctness boundaries (no ablation; invariant-pinned)

- **K1 - kernel-warden.** One terminal funnel: every `terminate()` that carries a deliverable goes through `runner-terminal-verify-gate.ts` and consumes the verdict (`stall-deliverable.ts:225-240, 381-405`). Reconcile `status`, `terminatedBy`, verdict and ledger `answer` into one outcome object on `run-completed` (audit P12). Align `finalizeOutput` sources to the core 4-source vocabulary. Gate: corpus invariant `success => no deliverable_decision=block && answer satisfied` goes from 5/9 violations to 0; census R14 = 0 on goldens. Red-on-cut: the `stall_deliverable` golden and a scripted-model test asserting a harness_deliverable terminate yields a verdict-consistent status; revert the funnel and both must fail. Check `diagnose`/`trace` consumers of `terminatedBy` unchanged.
- **K2 - kernel-warden.** Meta-tool iterations (`todo`, `brief`, `checkpoint`, `pulse`) do not accrue `consecutiveStalled` (`assessment/guard-adapters.ts:88`; callers `iterate-pass.ts:953`). Pure counter change, flag-free, with `guard-fired` metadata carrying `metaCallsExcluded`. Gate: replay corpus shows the haiku-umami shape (`01M6FDA26W...` pattern) no longer reaches `stall_deliverable` before the model synthesizes; unit test for `nextStalledCount` with meta-only iterations; red-on-cut. This is a behavior change on the default path: run the H3 suite before/after, 2 tiers, and report deliverable rate and tokens; revert if deliverable rate drops >1pp or tokens rise.
- **K3 - kernel-warden.** Persist protocol strike counts across strategy switch (R6): carry in `state.meta`/ledger instead of deriving from `steps`; exclude unresolved-tagged thoughts from loop-resolution "trailing thought" delivery; terminate `tool_call_unresolved` when only shaped thoughts exist. Gate: `required-tools-arm.ts llama3.2:3b 5 0` shows 0 shaped finals and honest label reached.

### Wave 2 - measure the surface and the voice (ablation-ready)

- **T1 - tools-warden + kernel-warden.** Harness-side relevance selection for allow-listed MCP floors (top-k by task/ledger match + one-line index of the rest, no model-driven discovery). Behind a builder-level typed option, default OFF. Red-on-cut: golden where the needed tool is below rank k must fail the selector config and pass with the fallback. Hand to **ablation-warden**: H3 suite + MCP-wide tasks, 2 tiers (local 8k window + frontier), >=3pp and <=15% billed tokens; also report schema tokens/req from H2. Promote to default only on PASS; otherwise stays opt-in.
- **T2 - kernel-warden.** One `ResolvedWireParams` consumed by the kernel guard, projection window and the Ollama provider (audit D3, GH #241 class) so numCtx cannot disagree by construction; provider-warden co-reviews the Ollama side. Gate: pinned test that all three read the same object; `wire-request.numCtxSource` populated.
- **T3 - kernel-warden.** Guidance accounting before composition: every `emitHarnessSignalInjected`/`harness_signal` site opens a ledger signal; split `unobserved` into `run-ended` / `not-classified`; give the "other" policy kinds a classifier. Gate: on a fresh corpus, rendered/opened >= 0.9 and `ambiguous` < 30% (today 1/43 and 11/13). No prompt text change in this task.
- **T4 - ablation-warden, then kernel-warden.** Guidance reduction arm: single-line guidance (required-tools + error-recovery) vs HEAD on the census failure tasks, 2 tiers. Only if it clears the rule, implement `composeGuidance`; otherwise delete the lowest-use fields and stop. Do not build a composer on spec alone.

### Wave 3 - simplify by evidence (every cut gated)

- **S1 - ablation-warden.** Per-mechanism flag-off sweep on the H3 suite and an expanded golden corpus (grow past 4 goldens first; `RA_VERBOSE_RULES`-style prompt-only mechanisms need live arms). Candidates: mid-run strategy switching, low-delta/evidence-staleness switch, `discover-tools`, assessment pace bands, default-on `todo` model-owned state. Output: INERT / HARMFUL / CANDIDATE table with accuracy, tokens, calls.
- **S2 - owning wardens (kernel / tools / runtime).** Execute removals only for mechanisms with a measured non-positive lift (no >=3pp lift or >15% tokens): remove or demote to opt-in per the rule. One mechanism per commit, with the deletion's red-on-cut being the existing guard test turned into an absence assertion and a sole-caller grep in the commit message. Update `AGENTS.md`, `README.md`, docs reference and a changeset for any user-visible default change.
- **S3 - runtime-warden + kernel-warden (optional, only if S1 shows inert).** Harness-owned checklist derived from the ledger (read-only render; `todo` stays an optional tool). Pairs with K2. Needs ablation-warden verdict before default-on; A1/A3 from 2026-10-28 shows the model-owned variant must not be promoted.

### Wave 4 - close

- **D1 - debrief-scribe.** Debrief to `wiki/Research/Debriefs/2026-11-xx-harness-convergence-debrief.md` with before/after on the H3 suite. **D2 - main thread.** Amend 09 (do not write a new north star), regenerate `wiki/Hot.md`, append `wiki/Log.md`, update `DEBT-REGISTER.md` rows touched (D1/D2/D3/D8), sync `.agents/MEMORY.md`.

## Ablation requirements summary

| Item | Changes default behavior | Ablation-warden needed |
|---|---|---|
| K1 terminal funnel | yes (labels), correctness | no lift rule; require no regression on 2 tiers |
| K2 meta-call stall accounting | yes | recommended; before/after on H3, revert rule above |
| K3 strike persistence | yes (edge) | no; probe-gated |
| T1 relevance-selected tools | opt-in first | **yes** before default-on |
| T2 wire params | no (consistency) | no |
| T3 signal accounting | no (trace only) | no |
| T4 guidance reduction | text changes | **yes** |
| S1/S2 removals | yes | **yes** (S1 is the ablation) |
| S3 harness-owned checklist | yes | **yes** |

## Exit criteria

1. H3 suite committed with HEAD baseline and a post-plan rerun, same instrument, pass^k reported with Wilson intervals; no claim under 26pp gap at n=5 per cell.
2. Corpus invariant for R1 holds; stall-fires-in-todo-runs from the H3 + live slice reported before/after.
3. Every removed or demoted mechanism cites its S1 row; no removal without one.
4. Tokens/run on the composite (H4) reported before and after; the overhead figure restated with billed tokens.
5. Docs, changeset, DEBT-REGISTER, Planning-Index and 09 amended truthfully (what was measured vs inferred).

## Risks

- Corpus poverty: the same sweep that marked 16 flags INERT could not see prompt-only mechanisms. Mitigation: H3 live arms before any prompt-affecting deletion.
- Probe tasks bias R2 evidence. Mitigation: H3 includes non-todo tasks; K2 is judged on deliverable rate and tokens, not on todo counts.
- Frontier tier cost/credit blockers (2026-10-13 scoreboard). Mitigation: state the blocker and run local-only with the frontier rung marked deferred rather than inferring.
- Parallel wardens touching `iterate-pass.ts` (1,315 LOC) and `runner.ts`; serialize K1/K2/K3, one commit each.
