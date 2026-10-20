---
type: plan
status: active
created: 2026-10-19
tags: [bundle, providers, gemini, thinking]
---

# Bundle: providers-gemini-thought
Date: 2026-10-19
Budget: 150 min (pass total)
Issues: #238 (executes), #240 (closeout only — already shipped)

## Acceptance criteria (per issue)
- #238: gemini stream emits `thinking_delta` StreamEvents for `thought: true` parts and attaches accumulated `thinking` to `content_complete`, gated on **model capability** (`resolveCapability("gemini", @).supportsThinkingMode`) — NOT consent, because Gemini's `thinkingBudget: 0` is advisory and thinking can arrive unrequested (gemini-2.5-pro treats it as best-effort-disable). Same event name + content-shape parity with anthropic/local adapters.
- #240: verified fixed on `dev` by 71a5d4f17 (plan: 2026-10-17-reasoning-classifier-skip-gate.md; tests: adaptive-classifier-skip.test.ts, classifier-skip-enforcement.test.ts). Close with evidence comment; no code change.

## Scope guard (cross-package gate)
Original pick was #240 + #238 as one bundle — spans packages/reasoning + packages/llm-provider, violating the cross-package descope gate. Resolution: retried #240 for execution → premise already fixed upstream; slot becomes pure closeout. #238 ships as the only code bundle (single package).

## Execution units (ordered)
1. **Unit 0 — #240 closeout (≤10 min):** comment + close. Verified-by recheck: `shouldSkipClassifierEvaluation` used at adaptive.ts:201 (skip branch) and decompose.ts:47 (shouldDecompose) → both constrain the classify calls.
2. **Unit 1 — #238 RED (≤30 min):** new test file `packages/llm-provider/tests/gemini-stream-thinking.test.ts`. Mock seam: `mock.module("@google/genai")` intercepting dynamic import (established gemini seam, see gemini-provider.test.ts:35; keep `afterAll` restore like anthropic-stream-thinking.test.ts:13). Cases:
   - capable model, thinking:true, mixed thought+text parts → N `thinking_delta` events, `content_complete.thinking` accumulated, thought text NOT in `content`.
   - capable model, thinking:undefined (budget 0 advisory) → thought parts still arrive → `thinking_delta` emitted (capability gate, not consent — issue-directed deviation from the anthropic consent gate).
   - incapable model (e.g. gemini-1.5 family) → ZERO `thinking_delta`, thought text suppressed.
   - tool-call parity: mixed thought + functionCall chunk still yields text_delta + tool-call events (regression guard on the shared parts loop).
   RED expectation vs pre-fix: cases 1, 2, 4 fail (no thinking_delta emitted pre-fix; toolCall parity should pass — guards the loop edit).
3. **Unit 2 — #238 GREEN (≤45 min):** `packages/llm-provider/src/providers/gemini.ts` stream loop:
   - compute `const cap = resolveCapability("gemini", model)` + `streamThinkEnabled = cap.supportsThinkingMode` inside `stream()` (before Stream.async).
   - in parts loop: replace the bare `if (thought) continue` with `if (streamThinkEnabled && thought) { emit thinking_delta + accumulate; continue; }` (thought parts must never leak into fullContent).
   - content_complete: attach `...(accumulatedThinking.length > 0 ? { thinking: accumulatedThinking } : {})` (parity with anthropic.ts:469-473).
   - fallback branch (no candidates): leave as-is (thought parts don't surface there).
4. **Unit 3 — VERIFY (≤40 min):** scoped suite + workspace gates.

## Risk register
- Non-thinking-capable models receiving `thought: true` parts from SDK versions → suppressed only by capability gate; acceptable (matches issue-shape).
- mock.module leakage across package tests → restore in afterAll (anthropic test pattern).
- `Date.now()`-suffixed tool-call ids in same chunk loop → untouched; out of scope.
- `[gemini-debug]` env-gated stderr blocks in the loop (RA_GEMINI_DEBUG) → intentionally kept; they are the live-verification tool for real thought parts.

## Verification protocol (cross-cutting)
- `bun test packages/llm-provider/tests/gemini-stream-thinking.test.ts --timeout 15000` — full pass
- `bun test packages/llm-provider/` — package suite, 0 fail
- `bun run build` — green
- `bunx turbo run typecheck --filter=@reactive-agents/llm-provider` — green
- `bun test packages/runtime/test/as-unknown-as-ceiling.test.ts` — pre/post counts, net 0 new casts
- RED proof: write tests before src edit; expect 3 fail / 1 pass pre-fix.

## Out-of-scope (explicit)
- #242 (num_ctx semantics RFC), #249 (preflight follow-ups), #250 (retry temperature — needs program sign-off), #206 (abstention synthesis design pass), #213 batch-2 withers (9 × 1–2h, over budget).
- gemini thinkingBudget tri-state redesign (issue-adjacent; event parity only).

## Baseline
- Working tree clean on `dev` (0 behind origin/main, 178 ahead of origin/main — bundle branches off `dev`).
- Will record `bun run build` + scoped test counts immediately after branching.
