---
"@reactive-agents/runtime": minor
"@reactive-agents/observability": patch
---

Strategy switching is now opt-in. Before this release it was on unless you passed `enableStrategySwitching: false`. Now it is off unless you pass `.withReasoning({ enableStrategySwitching: true })` (or `reasoning.enableStrategySwitching: true` in an agent config). `.withLeanHarness()` still turns it off when it is set.

Why: the 2026-11-05 lift-gate ablation (`wiki/Research/Ablations/2026-11-05-strategy-switching-ablation.md`) found no measurable accuracy lift. The change was -6.2pp, which is inside the noise. Switching added 28.1% more billed tokens overall and 41% more on rw-7, above the 15% overhead cap. None of the 14 runs that switched in the k=8 follow-up solved its task. The gate verdict was OPT-IN.

The `strategy-switching` CapabilityRegistry entry is now `defaultOn: false` and records this evidence, so `agent.capabilities.audit()` reports no violations. `HarnessProfile.balanced()` no longer includes strategy switching. When progress is flat, the console exporter now suggests a different `defaultStrategy` or a more capable model instead of turning on switching.
