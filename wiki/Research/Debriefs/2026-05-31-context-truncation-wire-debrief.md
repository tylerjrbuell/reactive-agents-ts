---
title: Context Truncation — Wire-Level Root-Cause Debrief
date: 2026-05-31
method: logging reverse-proxy on the literal Ollama /api/chat round-trip
verdict: "SINGLE root cause = flat 4000-char tool_result truncation. num_ctx + output-cap REFUTED as failure modes. Fix = age-aware curation DEFAULT-ON (verified 2-3→10 commits)."
relates:
  - "[[2026-05-30-context-curation-architecture]]"
  - "[[project_canonical_convergence_plan]]"
---

# Context Truncation — Wire-Level Debrief

## Question
`apps/examples/spot-test.ts` (cogito:14b, MCP github, "fetch last 10 commits → write
commits.md with all 10") wrote only **2-3** commits. "Even at full ctx length it's still
writing only 2 commits — why is it not seeing all the data?"

## Method — stop guessing, read the wire
Prior sessions diagnosed a **three-layer** story (input truncation + num_ctx speed wall +
output cap) by *inference* from the `steps[]` observation log — which is NOT what the model
receives. Advisor flagged this: the model sees `state.messages[]` → conversation-assembly →
curation → provider; the observation preview is a different record. **We had never captured
the actual provider payload.**

Fix: a logging reverse-proxy (`/tmp/ollama-wire-proxy.ts`) on `:11435` → `:11434`, set via
`OLLAMA_ENDPOINT`. Zero RA edits. Captures per `/api/chat`: request `options.num_ctx` /
`num_predict` / the literal `tool_result` content, and response `done_reason` / `eval_count`
/ `prompt_eval_count` / timing.

## Evidence — the synthesis call right after `list_commits`

| run | curation | num_ctx | tool_result payload | commit objects in payload | done_reason | commits.md |
|---|---|---|---|---|---|---|
| **A** | OFF (old default) | 15360 | **4087 chars + real `...truncated (17646 chars)` marker** | **3 of 10** | stop | **2-3** (verbose bodies) |
| **B** | ON (flag) | 15360 | **21646 chars, no marker, array closes clean** | **10 of 10** | stop | **10** ✓ faithful |
| **C** | ON (new default) | 15360 | **21646 chars** | **10 of 10** | stop | **10** ✓ faithful |

> **Faithfulness verified, not assumed (advisor catch):** "wrote 10" ≠ "saw 10". Grepped the
> captured payloads for `"sha"` objects + each written subject line. Run A's payload carried a
> genuine `...truncated (17646 chars)` marker and only **3** commit objects → the model wrote
> what it saw. Run B/C's payload had **all 10** commit objects and closed cleanly (no marker)
> → faithful, not fabricated. (An earlier analyzer column flagged B/C "truncated=true" — that
> was a false positive: the word "truncated" appears *inside* a commit body, e.g. "widen
> tool-result budget"; corrected here.) The suspicious first entry `docs(commits): summarize
> last 10 commits…` is a **real remote commit**, present verbatim in the payload — not the task
> echoed back.

## Findings
1. **Single root cause: the flat `TOOL_RESULT_INLINE_CAP = 4000`** in
   `act/conversation-assembly.ts:114-118` crushes the *current synthesis-target* tool_result.
   The model wrote exactly what it was shown — 2-3 commits from a 4087-char truncated list.
2. **num_ctx REFUTED as a failure mode.** 15360 (operator "half for speed"): `prompt_eval ≈
   1s`, total 15s/synthesis. Fast. The b1561303 8192→32768 work + the "predictive bucketed
   num_ctx" design were chasing a non-cause. (Speed/VRAM optimization track only.)
3. **Output cap REFUTED.** `done_reason=stop` (never `length`); `eval` 286-796 ≪ `num_predict`
   2000. The model finished naturally with budget to spare. The verbose-body transcription in
   run A was a *consequence* of seeing only 2-3 commits, not an output limit.
4. **Fix is age-aware curation** (`attend/tool-formatting.ts applyAgeAwareCuration`): keeps the
   most-recent-turn tool_result FULL (window-scaled, re-read from scratchpad via storedKey),
   compresses only AGED results. 4087→21646 chars → 10/10 commits. Flipped DEFAULT-ON (opt-out
   `RA_CURATION_AGEAWARE=0`) via kernel-warden.

## Default-on governance (honest record)
The flip overrides Spike1's own verdict, which was **"SHIP OPT-IN, default OFF."** Justification
is **user mandate** ("present optimally, don't hide data") + **this-session cogito wire proof**
(2-3→10, faithful). Other tiers ride **Spike1's prior cross-tier ablation** (sonnet T3-strict
1/3→3/3, gpt+qwen flat, zero regression on the trusted metric) — they are **not** re-gated on
the default-on path this session, and the project lift-rule gate was **not** formally re-cleared.
The ablation-warden pilot (live until 2026-06-15) retains standing veto; this is a mandated flip
backed by cross-tier evidence, not a lift-rule pass.

## Residual / follow-ups (known, not blocking)
- Run B/C payload fit in **one** result (~21733 chars vs `recentCharBudget ≈ maxTokens × 0.35
  × 4 ≈ 21504` — fit barely). A larger result *would* clip at the recency ceiling; the
  **0.35 `RECENT_WINDOW_FRACTION`** is first-pass and wants cross-tier tuning. Budget tracks
  `recommendedNumCtx` (correct coupling).
- **recall** is now subsumable: the curator owns the reversible store; auto-rehydration can
  replace the model-facing `recall` tool (downstream of this).
- `capability.ts` carries operator-set `recommendedNumCtx: 15_360` for both 14b models + a
  stale "set to 32K" comment + working-tree reformatting churn — operator's file to commit.

## Cleanup shipped this session
- Curation `curationAgeAware()` DEFAULT-ON (kernel-warden, +28 LOC, 9/9 curation tests).
- Stale `capability-maxtokens.test.ts` (hardcoded `8192`) → asserts the **wiring**
  (`maxTokens` tracks `resolveCapability(...).recommendedNumCtx`), retune-proof. 5/5 green.
- Curation-arch doc: predictive-num_ctx section marked DEPRIORITIZED with wire verdict.
