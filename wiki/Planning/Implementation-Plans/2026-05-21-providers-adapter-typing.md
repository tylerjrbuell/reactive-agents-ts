# Bundle: providers-adapter-typing
Date: 2026-05-21
Budget: 90 min
Issues: #68

## Acceptance criteria (per issue)
- **#68 HS-02:** `grep -c ': any' packages/llm-provider/src/adapter.ts` returns 0; all M12 hook parameters (`response`, `parts`, `error`, `chunk`) typed as `unknown`; existing tests + typecheck stay green; no production callsite breakage (none exist today).

## Baseline (pre-execute)
- `bun test packages/llm-provider/tests/m12-provider-adapter-hooks.test.ts` → **26 pass / 0 fail** (52 expects)
- `bunx turbo run typecheck --filter=@reactive-agents/llm-provider` → **4/4 successful**
- `grep -c ': any' packages/llm-provider/src/adapter.ts` → **5**
- `grep -n ': any' packages/llm-provider/src/adapter.ts` lines: 104, 113, 126, 145, 154 (drift-confirmed against issue body)

## Execution units (ordered)
1. **Unit 1 — Type M12 hooks `unknown`** (≤20 min)
   - Files: `packages/llm-provider/src/adapter.ts`
   - Edits: 5× `: any` → `: unknown` at lines 104, 113, 126, 145, 154
   - Tests: existing `m12-provider-adapter-hooks.test.ts` covers all five hooks; no new test needed (RED phase = baseline grep ≥1)
   - GREEN = grep returns 0 + tests stay 26/0 + typecheck 4/4

## Risk register
- **Risk:** Test helper `createTestAdapterWithHooks` declares its own `: any` annotations in impl callbacks → could fail under method-bivariance check. **Mitigation:** TS treats `any ↔ unknown` as bivariant on method shorthand; baseline test command will catch any regression immediately.
- **Risk:** Hidden consumer outside `packages/llm-provider/` that destructures hook params relies on implicit `any`. **Mitigation:** grep showed no production consumers; workspace-wide typecheck (`bun run build`) is the gate.

## Verification protocol (cross-cutting)
- `rtk bun test packages/llm-provider/` — full pkg suite, no net-new failures vs baseline
- `rtk bun run build` — full monorepo green (catches any downstream type leak)
- `rtk bunx turbo run typecheck --filter=@reactive-agents/llm-provider` — green
- `rtk grep -c ': any' packages/llm-provider/src/adapter.ts` — must return 0

## Out-of-scope (explicit)
- Discriminated `RawProviderResponse` / `RawStreamChunk` union — overdesign with zero production impls; revisit when first concrete adapter overrides these hooks.
- Centralizing into `@reactive-agents/core` — cross-package work, separate bundle.
- Test-file `: any` annotations on local callback params — not in issue scope; tests aren't part of public contract.
- Other `: any` in llm-provider outside `adapter.ts` (separate finding; not HS-02).
