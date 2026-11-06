# Reactive Agents Capability Manifest

This file is the source of truth for what the framework claims to do. CI fails if listed capabilities have no runtime handler, or if handlers are registered but not listed here.

## Reactive Interventions (dispatched)

- `early-stop` — packages/reactive-intelligence/src/controller/handlers/early-stop.ts
- `switch-strategy` — packages/reactive-intelligence/src/controller/handlers/switch-strategy.ts
- `tool-failure-redirect` — packages/reactive-intelligence/src/controller/handlers/tool-failure-redirect.ts

## Meta-Tools

- `brief` — packages/reasoning/src/kernel/capabilities/act/act.ts
- `pulse` — packages/reasoning/src/kernel/capabilities/act/act.ts
- `todo` — packages/tools/src/skills/todo.ts (opt-in via `.withMetaTools({ todo: true })`; writes advisory checklist-item ledger facts)
- `activate-skill` — packages/tools/src/skills/activate-skill.ts

## Entropy Sensor Sources (all active in composite)

- token, structural, semantic, behavioral, contextPressure

## Execution Phases (12)

bootstrap, guardrail, cost-route, strategy-select, think, act, observe, verify, memory-flush, cost-track, audit, complete
