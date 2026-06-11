---
type: debrief
date: 2026-06-11
tags: [evidence-grounding, verifier, public-api, behavior-change, debrief]
status: shipped
---

# Debrief: Opt-In Evidence-Grounding Redesign

**Merged to `main` (`d40270ed`).** Spec: [[2026-06-11-opt-in-grounding-redesign]] (Design-Specs). Plan: `wiki/Planning/Implementation-Plans/2026-06-11-opt-in-grounding-redesign.md`.

## What & why

Numeric evidence-grounding was **always-on** and byte-substring-matched `$…` figures against the **compressed** tool observation. Correct figures (`$62,578`) reformatted/compressed in the obs failed the substring → a `failed at evidence-grounded` verifier `warn` → `verified=false` (the runner acts on `!verified`) → impeded progress. User verdict: "tends to impede progress more than anything."

## Shipped (public-API + default-behavior change)

- **`.withGrounding({ mode: "block" | "warn", tolerance?, maxRetries? })`** — NEW builder method. Numeric grounding is now **opt-in, off by default**. Threaded as a cross-cutting `KernelInput.grounding`.
- When enabled: tolerant numeric **value** match (`|c−e| ≤ tolerance·max`, parses `$`/commas/`k|M|B`) against the **full** tool data (`buildEvidenceCorpusFromSteps(steps, scratchpad)` resolves `storedKey`→scratchpad, not the lossy preview). `warn` = advisory (surfaces `verificationWarning`, ships answer); `block` = one bounded corrective re-synthesis → **degrade to warn** (never hard-fails; `decideGroundingBlockOutcome` is pure-capped; `hasNonGroundingBlock` ensures it never rescues a coexisting parrot/escalate).
- **Scaffold-leak guard split out** → standalone **always-on** `reject` check (`scaffold-leak.ts` `detectScaffoldLeak`): model echoing `[STORED:]`/`_tool_result_N`/`compressed preview` as the answer. Zero false-positive; independent of the grounding opt-in.
- **Removed:** prose claim-grounding (`validateGeneralizedGrounding`) — was 64–73% false-reject, already opt-in-off. Migrated its two live callers (`finalize.ts`, `arbitrator.ts`) to `detectScaffoldLeak` (behavior-preserving — only the compression-echo branch was live).

## Evidence

- Reasoning suite **1651/0**; runtime grounding 7/7; reviewer-clean (cavecrew-reviewer: 10 correctness invariants verified, no issues).
- Live re-bench: grounding OFF default → **zero** grounding warnings across ollama gemma4:12b + claude-sonnet-4-6 + gpt-4o; `warn` mode silent on grounded answers (tolerant match works).
- Built subagent-driven: kernel-warden (A/B/D1), sonnet subagent (C), main-thread (D2).

## Lessons

- **Measurement honesty:** the session-long "`success=0%`" I reported (here and on the canonical-tool-execution bench) was a **probe bug** — `result.metadata.success` does not exist; the field is `result.success` (top-level, `core/src/types/result.ts:98`). `Boolean(undefined)`→false. Runs were succeeding (`confidence: high`). There was no separate "success floor." Verify the accessor before reporting a metric.
- **Plan gap caught by warden:** the plan named only `verifier.ts` as a `validateGeneralizedGrounding` caller; two more existed (`finalize.ts`, `arbitrator.ts`). Grep ALL callers before declaring a removal's blast radius.
- **Bounded retry ≠ M3 re-verify loop:** block-mode's corrective synthesis is hard-capped by a pure decision + degrade-only + opt-in — distinct from the removed M3 unbounded LLM re-verify. The line that makes it safe: it can only ever degrade, never spin, and never masks a non-grounding failure.

Related: [[project_opt_in_grounding_2026_06_11]], [[project_canonical_tool_execution_2026_06_11]].
