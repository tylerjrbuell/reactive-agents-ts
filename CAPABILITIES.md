# Reactive Agents Capability Manifest

This file is the source of truth for what the framework claims to do. CI fails if listed capabilities have no runtime handler, or if handlers are registered but not listed here.

## Reactive Interventions (dispatched)

- `early-stop` — packages/reactive-intelligence/src/controller/handlers/early-stop.ts
- `temp-adjust` — packages/reactive-intelligence/src/controller/handlers/temp-adjust.ts
- `switch-strategy` — packages/reactive-intelligence/src/controller/handlers/switch-strategy.ts
- `compress` — packages/reactive-intelligence/src/controller/handlers/context-compress.ts
- `tool-inject` — packages/reactive-intelligence/src/controller/handlers/tool-inject.ts
- `skill-activate` — packages/reactive-intelligence/src/controller/handlers/skill-activate.ts
- `tool-failure-redirect` — packages/reactive-intelligence/src/controller/handlers/tool-failure-redirect.ts
- `stall-detect` — packages/reactive-intelligence/src/controller/handlers/stall-detector.ts
- `harness-harm` — packages/reactive-intelligence/src/controller/handlers/harness-harm-detector.ts

## Reactive Interventions (advisory only — visible via pulse tool, no dispatch)

- `prompt-switch`
- `memory-boost`
- `skill-reinject` <!-- cspell:ignore reinject -->
- `human-escalate`

## Meta-Tools

- `brief` — packages/reasoning/src/strategies/kernel/phases/act.ts
- `pulse` — packages/reasoning/src/strategies/kernel/phases/act.ts
- `activate-skill` — packages/tools/src/skills/activate-skill.ts

## Entropy Sensor Sources (all active in composite)

- token, structural, semantic, behavioral, contextPressure

## Execution Phases (12)

bootstrap, guardrail, cost-route, strategy-select, think, act, observe, verify, memory-flush, cost-track, audit, complete
