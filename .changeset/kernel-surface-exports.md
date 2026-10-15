---
"@reactive-agents/reasoning": minor
---

Public composable-kernel extension surface (W0.4a): `packages/reasoning/src/index.ts` now exports `makeKernel` (value) plus the types `Phase`, `Guard`, `KernelContext`, `MetaToolHandler`, and `ThoughtKernel` from the package entry. Until now the docs page taught `makeKernel`/`Phase`/`Guard` extension patterns through repo-relative imports because the published barrel exposed only `reactKernel`/`executeReActKernel` — consumers could not actually use the documented capability. No behavior change: exports only. New pin test `tests/kernel-surface-exports.test.ts` guards the surface.
