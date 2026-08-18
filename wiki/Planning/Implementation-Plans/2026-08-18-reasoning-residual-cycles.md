# Bundle: reasoning-residual-cycles
Date: 2026-08-18
Budget: 45 min
Issues: #200 (6 of 8 cycles fixed)

## Acceptance criteria
- #200: `ledger/run-ledger.ts` cluster (3), `llm-gateway.ts`↔`purpose-routing.ts`
  (1), `state/kernel-state.ts`↔`synthesis-types.ts` (1), `state/kernel-state.ts`
  ↔`verifier.ts` (1) all eliminated — 6 of the 8 cited cycles.

## Root causes + fixes (4 clusters, same shape as #184's assembly fix each time)

1. **`ledger/run-ledger.ts` ↔ `post-conditions.ts`/`requirement-state.ts` (2 cycles):**
   `run-ledger.ts` needed the `PostCondition` type; `post-conditions.ts` (which
   owns it) imports `RunLedger`/`entriesOfKind` back. Extracted `PostCondition`
   + its 4 member interfaces to leaf `verify/post-condition-types.ts`;
   `post-conditions.ts` re-exports for its ~14 external consumers.
2. **`ledger/run-ledger.ts` ↔ `run-scope.ts` (1 cycle):** same shape —
   `LedgerPass` extracted to leaf `ledger/ledger-pass.ts`.
3. **`llm-gateway.ts` ↔ `policy/purpose-routing.ts` (1 cycle):** `LlmPurpose`
   was just a local re-export alias of `llm-provider`'s `LlmCallPurpose`;
   redirected `purpose-routing.ts` to import the real type directly from
   `@reactive-agents/llm-provider` — no new file needed.
4. **`state/kernel-state.ts` ↔ `synthesis-types.ts` / `verifier.ts` (2 cycles):**
   `KernelMessage` extracted to leaf `state/kernel-message.ts`; `GroundingConfig`
   extracted to leaf `state/grounding-config.ts`.

## Descoped (2 of 8 — NOT the same fix shape)

`state/kernel-state.ts` ↔ `completion-envelope.ts` ↔ `completion-status.ts`
(2 cycles). Unlike the 6 fixed above, this is not an accidental type-placement
cycle: `completion-envelope.ts`'s `envelopeFromKernelState(state: KernelState)`
and `completion-status.ts`'s helpers genuinely operate on the FULL `KernelState`
(or `KernelState["meta"]`) by design — envelope is *derived from* kernel state,
so both directions are conceptually real, not incidental coupling. Fixing this
needs a narrower parameter type (`Pick<KernelState, ...>`) per function, which
means reading every call site to know what's safe to narrow — out of scope for
a mechanical bundle. Left open on #200 with this note; the issue's fix
direction ("extract shared type to leaf") doesn't cleanly apply here.

## Baseline
- `bunx madge --circular --extensions ts src/kernel` → 8 (pre-fix)
- `bun test packages/reasoning/` → 2718 pass / 4 todo / 0 fail (unchanged post-fix)

## Risk register
- Pure type-level extraction (6 new/redirected leaf-type imports), zero
  runtime logic touched.

## Verification protocol
- `bunx madge --circular --extensions ts src/kernel` → 2 (was 8)
- `bunx turbo run typecheck --filter=@reactive-agents/reasoning` → green
- `bun test packages/reasoning/` → 2718/0/4todo (no delta)
- `bun run build` → 37/37

## Out-of-scope
- The 2 completion-envelope/completion-status cycles — see Descoped above.
