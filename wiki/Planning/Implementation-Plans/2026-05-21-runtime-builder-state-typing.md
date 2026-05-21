# Bundle: runtime-builder-state-typing
Date: 2026-05-21
Budget: 90 min
Issues: #72 (HS-07)

Singleton bundle. Originally seeded with #73 (HS-08) but descoped after advisor flagged cross-package leak: #73 targets shapes owned by `@reactive-agents/llm-service` (`LLMResponse.model`) and the kernel context type — anti-pattern per SKILL.md ("Cross-package bundles → descope"). #73 spawns into its own `kernel-context-typing` bundle next pass.

## Acceptance criteria

- **#72 (HS-07):** All 7 `as any` reads of `_*Options` in `packages/runtime/src/builder/to-config.ts` removed. Verified-by recheck `grep -c 'as any' packages/runtime/src/builder/to-config.ts` → 0.

## Execution units (ordered)

1. **Unit 1 — type the option-group fields on `BuilderStateForSerialization`.**
   - File: `packages/runtime/src/builder/to-config.ts`
   - Import the existing option types: `ToolsOptions`, `MemoryOptions`, `CostTrackingOptions`, `GuardrailsOptions`, `VerificationOptions`, `ObservabilityOptions` from `./types.js`; `ReasoningOptions` from `../types.js`.
   - Replace the seven `_*Options?: unknown` fields with their proper interface types.
   - Drop the seven `as any` narrowings (lines 98, 109, 122, 135, 150, 161, 172) — direct property reads work once the interface is typed.
   - Confirm builder class still structurally satisfies the interface (no edits to `builder.ts` expected — `_reasoningOptions?: ReasoningOptions` is already declared at `runtime-construction.ts:81`).
   - Tests: existing `serializeBuilder` callers exercise via `builder.toConfig()` in the regression suite — run the runtime package suite as the gate.

## Risk register

| Risk | Mitigation |
|------|-----------|
| Option types are wider/narrower than what `to-config.ts` reads; tsc surfaces real bugs | Read the types first; if the reader touches a field the type doesn't declare, prefer adding the field to the type over reverting to `as any` |
| `ReasoningOptions` at `packages/runtime/src/types.ts:581` is `ReasoningOptionsEncoded & {...}`; encoded schema may make some fields optional / unknown | Use the existing union type as-is; the readers all guard with `?.field` so optional-everything is fine |
| Builder class field declarations diverge from interface | tsc will catch it on `this as unknown as BuilderStateForSerialization` cast in builder.ts:1949 — fix that cast site if it breaks |

## Verification protocol

- `rtk bun test packages/runtime/` — full pass, no net-new failures vs baseline
- `rtk bun run build` — green
- `rtk bunx turbo run typecheck --filter=@reactive-agents/runtime` — green
- `rtk grep -c 'as any' packages/runtime/src/builder/to-config.ts` — expect `0`

## Out-of-scope (explicit)

- #68 HS-02 (providers package, separate bundle next pass)
- #69 HS-03 (Layer.merge architectural fix, needs its own design pass)
- #71 HS-06 (reactive-intelligence ControllerState extension, separate bundle)
- #73 HS-08 (cross-package; needs `LLMResponse.model` + kernel context type edits — separate `kernel-context-typing` bundle)
- #83 HS-27 (not verified per skill rule; will comment requesting verified-by)
