# Bundle: kernel-assembly-cycle-fix
Date: 2026-08-18
Budget: 45 min
Issues: #184 (partial — assembly cluster only)

## Drift re-verification
Issue cited `packages/reasoning/src/kernel/{assembly,context,state,loop}/`
and 9 cycles. Re-ran `bunx madge --circular --extensions ts src/kernel`:
found **14**, not 9, and the composition differs:
- `assembly/` and `context/` **relocated** out of `kernel/` to
  `packages/reasoning/src/{assembly,context}/` (sibling of kernel now) since
  the issue was filed — location claim is stale.
- 2 of the original 9 (context-manager↔composer, context-manager↔sections,
  loop/deliverable↔terminate) are **already resolved** — not present anymore.
- 6 **new** cycles appeared since 2026-06-05, unrelated to the issue's
  original clusters: `ledger/run-ledger.ts` cluster (3), `state/kernel-state.ts`
  ↔ verifier/completion-envelope cluster (3 beyond the original 1), plus
  `llm-gateway.ts` ↔ `policy/purpose-routing.ts` (1, different file entirely).

This is real drift (>5, different composition) per the drift-check protocol.
Scoping this bundle to the ONE cluster that's still live and matches the
issue's own fix direction exactly: **assembly (5 cycles)**. Filing the
other 9 (the still-live `state/kernel-state.ts` original + the 6 new ones)
as a follow-up issue with corrected evidence rather than attempting a
9-cycle architectural sweep in one pass — each remaining cluster needs its
own root-cause read, several are pre-existing (not caused by this session).

## Acceptance criteria
- #184 (assembly portion): `project.ts` ↔ `stages/*.ts` (5 cycles) eliminated.
  `bunx madge --circular --extensions ts src` no longer lists any
  `assembly/project.ts` ↔ `assembly/stages/*` pair.

## Root cause
All 6 stage files imported `AssemblyCtx` (a type) from `project.ts`; `project.ts`
imports the 6 stage functions. Classic type/value mutual-import cycle.

## Fix
Extract `AssemblyInput`, `AssemblyCtx`, `Projection` to a new leaf module
`assembly/assembly-ctx.ts` (imports only pre-existing leaf types — event-log,
result-store, capability, types, trace, standing-frame, kernel contract/ledger/
state/assessment — none of which import stages). `project.ts` re-exports them
for back-compat (2 external consumers: `context/index.ts`,
`kernel/capabilities/reason/think.ts`) and imports the type from the new leaf
alongside the stage functions. Each stage file's `import type { AssemblyCtx }
from "../project.js"` redirected to `"../assembly-ctx.js"`. Pure type-level
move — zero runtime behavior change.

## Baseline
- `bunx madge --circular --extensions ts src/kernel` → 14 (pre-fix)
- `bun test packages/reasoning/` → 2718 pass / 4 todo / 0 fail (pre-fix baseline, captured post-edit since fix is structural — see risk register)

## Risk register
- Pure type extraction, no runtime logic touched — build+typecheck+full test
  suite is the complete verification surface.

## Verification protocol
- `bunx madge --circular --extensions ts src/kernel` → 8 (was 14; -5 assembly cycles gone, relocated-out-of-kernel context cycle no longer counted here either)
- `bunx turbo run typecheck --filter=@reactive-agents/reasoning` → green
- `bun test packages/reasoning/` → 2718/0/4todo (no delta)

## Out-of-scope
- Remaining 8 cycles (`ledger/run-ledger.ts` cluster, `state/kernel-state.ts`
  cluster ×2, `llm-gateway.ts` cluster) — follow-up issue filed with current
  evidence, each needs its own root-cause read.
- `context/` cycles — relocated out of kernel/, not re-verified this pass.
