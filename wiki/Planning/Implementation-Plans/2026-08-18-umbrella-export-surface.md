# Bundle: umbrella-export-surface
Date: 2026-08-18
Budget: 30 min
Issues: #155 (HS-D-19 sub-item only)

## Drift note
Split from health-export-surface per cross-package descope gate (health.md,
same run). HS-D-01/HS-D-02 already dead — see that plan's drift note.

## Acceptance criteria
- #155 (HS-D-19 portion): the 15 layer-factory re-exports
  (`createCostLayer`, `createEvalLayer`, `createGuardrailsLayer`,
  `createIdentityLayer`, `createInteractionLayer`, `createMemoryLayer`,
  `createObservabilityLayer`, `createPromptLayer`, `createReasoningLayer`,
  `createToolsLayer`, `createVerificationLayer`, `defineTool`, `tool`,
  `ingestDocuments`, `registerShutdownHandlers`) from
  `packages/reactive-agents/src/index.ts` get direct shape assertions —
  `umbrella-integration.test.ts` never imports them by name.

## Execution units
1. **Unit 1:** add a case to `umbrella-integration.test.ts` that dynamic-imports
   `../src/index.js` and asserts `typeof` for each of the 15 names is
   `"function"`. ~15 min.

## Baseline
- captured below before edit.

## Risk register
- None — additive test only.

## Verification protocol
- `bun test packages/reactive-agents/`
- `bunx turbo run typecheck --filter=reactive-agents`

## Out-of-scope
- HS-D-01, HS-D-02, HS-D-17 — handled separately / already dead.
