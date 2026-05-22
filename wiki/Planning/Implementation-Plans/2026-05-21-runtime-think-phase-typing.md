# Bundle: runtime-think-phase-typing

Date: 2026-05-21
Budget: 90 min
Issues: #73 (HS-08)

## Acceptance criteria

- **#73:** 9 `as any` casts in `inline-think.ts` (6) + `reasoning-think.ts` (3) collapsed via a local widening type + boundary helper. The pattern mirrors #71 (`HandlerState`) and #72 (typed BuilderState option groups). No `as any` should remain in these two files. `LLMResponse.model` is read via a single typed boundary cast (local to runtime) — does NOT touch `@reactive-agents/llm-provider`.

## Verified-by recheck

`grep -nF 'as any' packages/runtime/src/engine/phases/agent-loop/inline-think.ts packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts` → 0 (was 9: lines 85, 96, 107, 220, 273, 310 + 73, 84, 258).

## Cross-package descope decision

Issue body's "Fix direction" said: *"Type `KernelContext.memoryContext` and `LLMResponse.model` properly. Root cause of HS-08 cluster — fixing collapses ~9 sites."* That would touch:
- `@reactive-agents/core` (KernelContext / ExecutionContext narrowing)
- `@reactive-agents/llm-provider` (LLMResponse.model field)

Per Phase 2 hard gate (cross-package descope), restrict bundle to `packages/runtime/` only. Use the established #71 / #72 pattern: define a local widening type `ThinkContext` + `asThinkContext()` helper inside `packages/runtime/src/engine/phases/agent-loop/`. `KernelContext` / `LLMResponse` upstream definitions remain untouched. Upstream narrowing = separate follow-up bundle.

`memoryContext`, `selectedStrategy`, `selectedModel` are already in `packages/runtime/src/types.ts` `ExecutionContextSchema` (lines 157, 159, 161) — but typed as `Schema.optional(Schema.Unknown)` / `Schema.optional(Schema.String)`. The local widening narrows access patterns without changing the schema (which is the public surface for tooling).

## Execution units

1. **Unit 1 — define widening + helper.** New file `packages/runtime/src/engine/phases/agent-loop/think-context.ts`:
   - `ThinkContext` type extending `ExecutionContext` with concrete shapes for `memoryContext`, `selectedModel`
   - `asThinkContext(c: ExecutionContext): ThinkContext` boundary helper (single named cast)
   - Local `LLMResponseWithModel` widening for `response.model` access
2. **Unit 2 — migrate `inline-think.ts` 6 sites.**
   - Lines 85, 96: `(c as any).selectedStrategy` → `c.selectedStrategy ?? "reactive"` (already typed `string` on schema — pure cast deletion)
   - Line 107: `(c.memoryContext as any)?.semanticContext` → via `asThinkContext(c).memoryContext?.semanticContext`
   - Line 220: `(response as any).model` → narrowed via `LLMResponseWithModel` cast at boundary
   - Line 273: `(c.selectedModel as any)?.model` → `asThinkContext(c).selectedModel?.model`
   - Line 310: `{ ... } as any` — inspect; may be a return-type cast unrelated to think context. Leave if out-of-cluster; document.
3. **Unit 3 — migrate `reasoning-think.ts` 3 sites.**
   - Lines 73, 84: `(c.memoryContext as any)?.{semanticContext,recentEpisodes}` → via `asThinkContext`
   - Line 258: `(result as any).metadata?.selectedStrategy` — `result` is the reasoning strategy output; narrow via local type or remove cast if already covered.
4. **Unit 4 — TDD coverage.** Add `packages/runtime/tests/think-context.test.ts` asserting the widening helper passes through unchanged contexts and narrows known fields. Pin the boundary semantics so future refactors don't accidentally restore `as any`.

## Risk register

- **Risk:** the narrowed types are wrong about the runtime shape (e.g., `memoryContext` actually has a different layout). **Mitigation:** widening is *additive* — extra fields don't cause runtime errors; only TypeScript correctness changes. Test against real memory-context structure.
- **Risk:** existing tests reference these fields via untyped access. **Mitigation:** `asThinkContext` is opt-in; existing tests don't break unless they fail to compile (no behavior change).
- **Risk:** the `LLMResponse.model` field genuinely isn't on the type and consumers depend on undefined fallback. **Mitigation:** boundary cast still allows `undefined`; behavior unchanged.

## Verification protocol

- `rtk bun test packages/runtime/ --timeout 30000` — full pass vs baseline
- `rtk bunx turbo run build` — 38/38
- `rtk bunx turbo run typecheck --filter=@reactive-agents/runtime` — no NEW errors (pre-existing #93 `focusedTools` remains)
- `grep -nF 'as any' packages/runtime/src/engine/phases/agent-loop/{inline,reasoning}-think.ts` → 0 net (or only documented out-of-cluster casts)

## Out of scope (explicit)

- `execution-engine.ts:956,1072` — same `(c.selectedModel as any)?.model` pattern but in a different file. Skill cohesion says "primary files overlap" — these are sibling files in the same dir; bundling them in is acceptable but expands scope. Defer to follow-up `runtime-execution-engine-as-any-sweep` bundle.
- Tightening the `ExecutionContextSchema` itself — touches schema public surface; separate evolution.
- Tightening `LLMResponse` in `llm-provider` to include `.model` field — separate cross-package bundle.

## Baseline (pre-EXECUTE)

- `rtk bunx turbo run build` → **38/38** (37 cached)
- `rtk bun test packages/runtime/` → **792 pass / 0 fail / 1 skip**
- `grep -c 'as any' inline-think.ts` → 6 lines (85, 96, 107, 220, 273, 310)
- `grep -c 'as any' reasoning-think.ts` → 3 lines (73, 84, 258)
