# Bundle: agentstreamevent-dedup (react / svelte / vue)
Date: 2026-08-18
Budget: 60 min
Issues: #188

## Drift re-verification
Issue #188 claimed 3 divergent copies (runtime canonical, svelte lossy mirror,
cortex chat-store hand-copy). Re-checked:
- **chat-store hand-copy: DEAD.** Already fixed — `chat-store.ts:18` now does
  `export type { UiStreamEvent as AgentStreamEvent } from "@reactive-agents/ui-core"`,
  a re-export, not a copy. The issue's "still a copy" note is stale.
- **Shared types entry point: now exists.** `@reactive-agents/ui-core` shipped
  since #188 was filed — explicitly documented (`protocol/events.ts:1-7`) as
  a dependency-free structural mirror of `packages/runtime/src/stream-types.ts`'s
  `AgentStreamEvent`, and is already a real dependency of `@reactive-agents/svelte`,
  `@reactive-agents/react`, `@reactive-agents/vue` (all export its `UiStreamEvent`
  today, side-by-side with a still-broken local type — see next point). This is
  the "shared types entry point" #188's fix direction asked to scope; it's built,
  just not fully wired.
- **New/still-live divergence found (not in original issue, same root cause):**
  `packages/{react,svelte,vue}/src/types.ts` each independently hand-roll a
  *second*, narrower `AgentStreamEvent` (5 tags + `_tag: string` escape hatch)
  used by the legacy `useAgentStream`/`createAgentStream` hooks, cast via
  `as AgentStreamEvent[]` over data that is — at runtime — already
  `UiStreamEvent[]` (confirmed: `ui-core/src/state/run-machine.ts:15` types
  `RunState.events` as `SeqStamped<UiStreamEvent>[]`, and `SeqStamped<E> = E &
  {seq?}` is structurally still `E`). The cast silently drops 15 of 20 real
  tags and every non-listed field. Identical bug, 3 packages, byte-identical
  scaffold — this is the actual remaining fix.

## Acceptance criteria
- #188: `AgentStreamEvent` exported from each of react/svelte/vue's `types.ts`
  is a re-export of `@reactive-agents/ui-core`'s `UiStreamEvent` (no second
  hand-rolled union, no escape-hatch member), and the `as AgentStreamEvent[]`
  casts in the corresponding stream hooks are removed (no longer needed once
  the types agree).

## Execution units (one per package, sequential, own branch)
1. **react** — `packages/react/src/types.ts`, `hooks/use-agent-stream.ts`
2. **svelte** — `packages/svelte/src/types.ts`, `agent-stream.ts`
3. **vue** — `packages/vue/src/types.ts`, `use-agent-stream.ts`, `use-structured-object.ts`

Each unit: replace the hand-rolled union with
`export type { UiStreamEvent as AgentStreamEvent } from "@reactive-agents/ui-core";`,
drop the now-redundant cast at the call site, run package test+typecheck.

## Baseline
Captured per-package immediately before each unit (see individual commits).

## Risk register
- Smoke tests assert `AgentStreamEvent` shapes via `as AgentStreamEvent`
  casts — casts absorb the wider union, no test change needed. Verified by
  reading `tests/smoke.test.ts` in all 3 packages before editing.
- `StreamCompleted.metadata` type differs (`Record<string,unknown>` (old) vs
  `ResultMetadataWire` (ui-core, also has `[key:string]:unknown` index) —
  structurally compatible, not a breaking narrowing.

## Verification protocol
- Per package: `bun test packages/<pkg>/`, `bunx turbo run typecheck --filter=@reactive-agents/<pkg>`
- Cross-cutting: `bun run build` after all 3 land

## Out-of-scope
- `apps/examples/` usages of the *runtime-side* `AgentStreamEvent` — that's
  the true canonical type, not part of this divergence.
- `apps/cortex/ui` — already migrated (chat-store re-export), not touched.
