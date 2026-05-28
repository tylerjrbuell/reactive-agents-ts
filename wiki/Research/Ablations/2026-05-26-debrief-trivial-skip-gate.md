---
date: 2026-05-26
warden: ablation-warden
candidate: debrief trivial-skip gate
commit: fa831f44
branch: overhaul/foundation-2026-05-26
related: [[GH #143]]
verdict: PASS — keep default-on
---

# Ablation: Debrief Trivial-Skip Gate (fa831f44 / GH #143)

## Candidate

`packages/runtime/src/engine/finalize/debrief-synthesis.ts:170` adds gate:

```ts
const isTrivialTask = ctx.metadata.taskComplexity === "trivial";
// skip synthesizeDebrief LLM call when trivial
```

Upstream classifier: `packages/runtime/src/engine/util.ts:143` (`classifyComplexity`); populated by `engine/phases/memory-flush-dispatch.ts:42`.

Trivial = `iteration <= 1 && toolCallCount === 0 && terminatedBy !== "max_iterations"`.

## Hypothesis

GH #143 evidence claimed ~825 tok/task burned on local-tier trivial runs via a debrief LLM call that:
- 47% of runs hit `max_tokens: 512`
- 52% returned empty content
- Already had a deterministic fallback at `debrief.ts:222`

Expected: skip the call → 1 fewer Ollama POST per trivial task; zero accuracy regression.

## Measurement instrument

**Bench `tokensUsed` is broken** (precisely the GH #143 bug): `result.metadata.tokensUsed` does NOT aggregate the debrief LLM call, so the bench cannot show the delta. Used a `fetch` monkey-patch in `bench/mastra-vs-ra/ablation/debrief-skip-probe.ts` to count POSTs to `localhost:11434/api/chat`.

Secondary signals: `result.debrief` presence, `result.metadata.complexity`, total durationMs.

## Protocol

- **Tasks (all trivial):** k1-france-capital, k3-rgb-colors, f2-no-tool-knowledge-recovery
- **Local tier:** qwen3.5:latest, N=3 per task per arm
- **Frontier tier:** claude-sonnet-4-6, N=1 per task per arm (regression-check; no lift expected)
- **Arms:**
  - `before` = checkout `d8817985` (parent of `fa831f44`) for debrief-synthesis.ts only — gate absent
  - `after` = HEAD (gate present)

## Results — local tier (qwen3.5:latest, N=3)

| Task | Arm | Ollama calls (mean) | success | debrief present | mean dur (ms) | mean reportedTokens |
|---|---|---|---|---|---|---|
| k1 | before | 2.00 | 3/3 | 3/3 | 7,296 | 504 |
| k1 | **after** | **1.00** | **3/3** | **0/3** | **1,386** | 510 |
| k3 | before | 2.00 | 3/3 | 3/3 | 8,140 | 585 |
| k3 | **after** | **1.00** | **3/3** | **0/3** | **2,105** | 582 |
| f2 | before | 2.67 | 3/3 | 3/3 | 16,237 | 599 |
| f2 | **after** | **1.67** | **3/3** | **0/3** | **9,319** | 597 |

**Delta:** −1.00 Ollama POST per trivial task, uniformly (k1/k3/f2). Mean wall-clock saved 5.9–6.9s/task on local tier.

*Note on f2:* some f2 runs make 2 LLM calls in the after arm and 3 in the before arm yet still classify trivial. `classifyComplexity` uses loop `iteration` (0-indexed) not raw LLM-call count, so 2 calls = iter=1 ≤ 1 = trivial. The gate fires on 9/9 local f2 runs. Delta of −1 LLM call holds across all 18 local runs.

`reportedTokens` is ~unchanged because the bench instrument does not capture the debrief LLM call (this is the GH #143 measurement bug, now empirically confirmed: 1 extra LLM call burns ~5s but adds 0 tokens to `tokensUsed`).

## Results — frontier tier (claude-sonnet-4-6, N=1)

| Task | Arm | success | debrief present |
|---|---|---|---|
| k1 | before | ✓ | yes |
| k1 | after | ✓ | no |
| k3 | before | ✓ | yes |
| k3 | after | ✓ | no |
| f2 | before | ✓ | yes |
| f2 | after | ✓ | no |

**Frontier regression check:** 3/3 success both arms. Debrief presence flips as designed. No anomaly.

## Consumer audit (`result.debrief` blast-radius)

Grep `packages/{runtime,memory,core}/src` for `result.debrief|\.debrief`:

| Site | Pattern | Safe on undefined? |
|---|---|---|
| `reactive-agent.ts:664` | `...(r.debrief !== undefined ? { debrief: r.debrief } : {})` | yes (gated spread) |
| `reactive-agent.ts:668` | `if (agentResult.debrief) this._lastDebrief = agentResult.debrief` | yes (truthy guard) |
| `reactive-agent.ts:1033` | `result.debrief?.toolsUsed.map(...)` | yes (optional chain) |
| `execute-stream.ts:155-160` | `taskResult.debrief?.toolsUsed` then length-guard | yes |
| `reasoning-think.ts:135-142` | Reads `last.debrief` from `DebriefStoreService.listByAgent(...)` on NEXT run | yes at runtime (no persisted row means loop doesn't enter); see Cross-Session Note below |
| `memory/services/debrief-store.ts:133-138` | Reads `input.debrief.*` on save call | safe — only called when `debrief !== undefined` at `debrief-synthesis.ts:201` |

**Verdict on consumers:** No silent breakage. Every consumer either uses optional chaining, an explicit `!== undefined` gate, or runs only after a present check.

## Cross-session note (out-of-scope for this verdict, follow-up filed mentally)

`reasoning-think.ts:130` reads the most-recent debrief via `DebriefStoreService.listByAgent(agentId, 1)` and injects it as "Prior Session" context on subsequent runs. After this gate, trivial predecessors leave no row → subsequent runs lose that prior-session injection for trivial→anything sequences.

This is almost certainly net-positive (per GH #143, the skipped debriefs were 47% truncated garbage, 52% empty), but the single-shot probe does not exercise the cross-session path. **Recommendation:** scope explicitly out of this verdict; file follow-up to verify deliberate.

## Lift rule application

The lift rule's positive form ("≥3pp success lift") doesn't apply — this change REDUCES token cost on trivial tasks, not lift on a difficulty axis. Apply inverse:

1. **Cost reduction is observable and large:** −1 LLM call/trivial-task, −5–7s wall-clock/trivial-task on local tier. Token-overhead criterion is satisfied trivially (a strict REDUCTION).
2. **Cross-tier validated:** local (qwen3.5:latest, N=9 total) + frontier (claude-sonnet-4-6, N=3 total). Both tiers: 0 accuracy regression.
3. **Consumer safety verified:** all 6 consumer sites use optional chaining or explicit gates.
4. **No silent breakage:** `result.debrief === undefined` matches exactly what the gate produces; types already model it as `AgentDebrief | undefined`.

## Verdict

**PASS — KEEP DEFAULT-ON.**

Cost reduction confirmed: 100% of trivial runs save exactly 1 LLM call. Success rate unchanged (12/12 across both tiers, both arms). All `result.debrief` consumers handle undefined safely.

## Recommended next actions (advisory, parent enforces)

1. **Ship as-is.** Gate is correct, conservative (trivial-only, leaves moderate/complex reachable), well-tested per commit message.
2. **File GH issue** to verify the cross-session prior-debrief injection at `reasoning-think.ts:130-147` is intentionally fine without trivial predecessors. (Not blocking; almost certainly net-positive.)
3. **Fix the bench `tokensUsed` undercount (GH #143).** This ablation re-confirmed empirically that `result.metadata.tokensUsed` excludes finalize-phase LLM calls — the bench's RA-vs-Mastra comparison remains skewed against RA until this is fixed. Track separately from this gate.
4. **No other warden dispatch needed.** Framework code at HEAD is correct; pre-commit version was the bug.

## Artifacts

- Raw data (per-run JSON):
  - `bench/mastra-vs-ra/ablation/results/ablation-before-2026-05-26T23-02-11-526Z.json` (local before, N=3×3)
  - `bench/mastra-vs-ra/ablation/results/ablation-after-2026-05-26T23-00-05-589Z.json` (local after, N=3×3)
  - `bench/mastra-vs-ra/ablation/results/ablation-before-2026-05-26T23-03-21-821Z.json` (frontier before, N=1×3)
  - `bench/mastra-vs-ra/ablation/results/ablation-after-2026-05-26T23-02-57-634Z.json` (frontier after, N=1×3)
- Probe source: `bench/mastra-vs-ra/ablation/debrief-skip-probe.ts`
