---
type: implementation-plan
status: completed
created: 2026-09-28
completed: 2026-09-28
tags: [execute-backlog, health-sweep, providers, streaming, function-calling, bundle]
---

# Bundle: providers-stream-accum

Date: 2026-09-28
Budget: 90 min
Issues: #216
Branch: `bundle/providers-stream-accum` (off local `dev`)
Warden: `provider-warden` (scope: `packages/llm-provider/**`)

## Why this bundle

`openai.ts` and `litellm.ts` each carry a near-identical streamed tool-call
accumulator (`toolCallAccum: Map<number,{id,name,arguments}>`) plus
adapter-normalized finish-reason synthesis. LiteLLM proxies the OpenAI-compat
dialect, so the chunk shape and lifecycle are identical — the duplication is
~90 lines of hot-path streaming logic that can drift independently (and has:
litellm carries a `synthesized` single-shot guard; openai does not).

## SCAN drift note (recorded before bundling)

| Claim | Issue says | Actual (2026-09-28) | Verdict |
|---|---|---|---|
| `toolCallAccum` occurrences | litellm 8, openai 6 | litellm **5**, openai **6** | 🟡 litellm drifted |
| `synthesizeAndEmitToolCalls` in both | yes | only in `litellm.ts:425`; openai is inline at `565-600` | 🟡 symbol re-scoped |
| line ranges | litellm 346-430 / openai 459-530 | litellm 408-… / openai 493-… (≈+60) | 🟡 shift >5 |
| duplication real | yes | yes — accumulate loop + adapter synthesis near-identical | ✅ premise holds |

Fix shape re-grounded and commented on #216 before branching.

## Acceptance criteria (per issue)

- **#216:** the streamed tool-call accumulator + adapter-normalized finish
  synthesis exists in exactly **one** shared helper under
  `packages/llm-provider/src/`; both `openai.ts` and `litellm.ts` call it; both
  providers' streaming tool-call behavior is byte-identical to before (event
  order/counts pinned by tests); llm-provider suite green; typecheck + build
  green; new test contributes **0** `as unknown as` sites.

## Execution units (ordered)

1. **Unit 1 — extract + parity tests (single warden pass, ≤60 min).**
   - New helper: `packages/llm-provider/src/stream-tool-call-accumulator.ts`
     (precedent shape: `streaming-helpers.ts`, `retry.ts`). Factory returning:
     - `accumulate(deltas)` — per-index accumulation; emit `tool_use_start` on
       first chunk for an index (only when `!useAdapterNormalization && id && name`);
       emit `tool_use_delta` per argument fragment (only when `!useAdapterNormalization`).
     - `synthesize(finishReason)` — idempotent (single-shot guard from litellm);
       when `useAdapterNormalization` and non-empty, build the OpenAI-shaped
       synthetic response, call `parseToolCalls`, emit start+delta per normalized
       call with fallback id `<providerShortId>-tc-<i>`.
     - `size` — for callers' Cluster-B guard.
   - `openai.ts`: replace inline accumulator (491-553) + synthesis (560-600) with
     helper calls. **Keep** the provider-local Cluster-B guard (604-620) — it is
     openai-only.
   - `litellm.ts`: replace its inline accumulator (408-…) + named
     `synthesizeAndEmitToolCalls` (425-477) with the helper, preserving the dual
     call sites (`finish_reason` **and** `[DONE]` defensive path).
   - New test: `packages/llm-provider/tests/openai-stream-tool-calls.test.ts` —
     mirror `litellm-stream-tool-calls.test.ts`'s two core cases (no-adapter
     per-chunk path; adapter-normalized single synthesized pair) to give the
     openai stream path the coverage it currently lacks and pin parity.
   - Existing `litellm-stream-tool-calls.test.ts` (4 tests) is the regression net
     for the litellm side — must stay green unchanged.

## Gate: provider-warden routing

Primary scope is `packages/llm-provider/**` → per AGENTS.md team-ownership
contract, dispatch `provider-warden` with MissionBrief (MissionBrief-in →
UpwardReport-out). Parent verifies; no self-review re-prompt.

## Risk register

- **Streaming event-order regression** (silent FC loss) → highest risk. Mitigation:
  existing litellm test pins per-chunk + normalized ordering; new openai test
  pins the same; run the full llm-provider suite.
- **`synthesized` guard semantics** → openai never calls `synthesize` twice, so
  making the helper idempotent is behavior-preserving for openai and preserves
  litellm's guard. Confirm the `[DONE]` defensive path still emits exactly once.
- **Cast ceiling** (`packages/*/tests`) → new test must not add `as unknown as`
  (build the fetch mock Response with `new Response(stream)`, not a cast).
- **Helper over-abstraction** → only the accumulator + synthesis move; provider-
  local guards (openai Cluster-B; litellm's own error mapping) stay put.

## Verification protocol (cross-cutting)

- `bun test packages/llm-provider` — full pass (baseline 459 pass / 0 fail)
- `bun test packages/llm-provider/tests/litellm-stream-tool-calls.test.ts` + new openai test
- `bunx turbo run typecheck --filter=@reactive-agents/llm-provider` — green
- `bun test packages/runtime/test/as-unknown-as-ceiling.test.ts` — new test contributes 0
- `bun run build` — 38/38
- Re-run #216 verified-by: `grep -c "toolCallAccum"` → **0 in both providers** (helper owns it)

## Baseline

- `bun run build` → 38 successful, 38 total
- `bun test packages/llm-provider` → 459 pass, 0 fail (69 files)

## Out-of-scope (explicit)

- openai's Cluster-B finish guard (provider-local, keep)
- Any edit outside `packages/llm-provider/**`
- `#214` cast-ceiling sweep, `#224` runtime subscribe fallback (separate bundles)

## Outcome

- Commit `59233139` (refactor + parity test) merged to local `dev`.
- Shared owner: `packages/llm-provider/src/stream-tool-call-accumulator.ts`.
- Verified-by recheck: `grep -c "toolCallAccum"` → **0** in `openai.ts` and **0** in `litellm.ts`.
- llm-provider `461 pass / 0 fail` (baseline 459 + 2); targeted `6/0`;
  typecheck `4/4`; workspace typecheck `68/68`; build `38/38`.
- Both new files contribute **0** `as unknown as` sites (tests-scope ratchet unchanged at 266).
- Workspace `bun run test` red is the pre-existing `@reactive-agents/testing`
  North Star cwd-relative baseline artifact (#230) — `bun test packages/testing`
  from repo root passes `53/0`; unrelated to this bundle.
- Retro: [[Research/Debriefs/2026-09-28-providers-stream-accum-execution-debrief]]
