---
aliases: [core package, Event Bus]
tags: [package, foundation, core]
layer: Foundation
owner: Architecture Team
status: Stable (v0.10.0)
---

# Package: core

**Layer:** Foundation (no dependencies)

**Owner:** Architecture Team

**Status:** ✅ Stable (v0.10.0)

---

## Purpose

The `core` package provides fundamental primitives used throughout the framework:
- **EventBus** — Observable event dispatch system for kernel signals
- **AgentService** — Core agent execution service
- **TaskService** — Task management and lifecycle
- **Base Types** — Shared type definitions (KernelState, ToolCall, etc.)

---

## Key Files

| File | Purpose |
|------|---------|
| `src/services/event-bus.ts` | EventBus implementation (1001-1005: M1-M13 event registrations) |
| `src/services/agent-service.ts` | Agent execution entry point |
| `src/services/task-service.ts` | Task lifecycle management |
| `src/types.ts` | Shared type definitions |

---

## Dependents

All other packages depend on `core`. Critical integrations:
- `reasoning` — Uses EventBus for kernel signals
- `tools` — Uses ToolCall, TaskService types
- `observability` — Uses EventBus for metric collection

---

## Tests

**Location:** `tests/`

| Test File | Coverage | Pass Rate |
|-----------|----------|-----------|
| event-bus.test.ts | EventBus dispatch, subscriptions | 100% |
| agent-service.test.ts | Agent lifecycle | 100% |
| task-service.test.ts | Task management | 100% |
| **Total** | 145 tests | 100% |

---

## Key Components

### EventBus

```typescript
// Dispatch events observed by all mechanisms
eventBus.emit('entropyScored', { entropy: 0.8, phase: 'think' });
eventBus.emit('controllerDecision', { decision: 'switch-strategy' });

// Subscribe to signals
eventBus.subscribe('entropyScored', (signal) => {
  if (signal.entropy > threshold) {
    triggerIntervention();
  }
});
```

**Events wired:**
- `entropyScored` (M1 RI dispatcher)
- `controllerDecision` (M1 intervention)
- `midRunAdjustment` (M1, M7 calibration)
- `skillActivated` (M6 skill system)
- `skillRefined` (M6 skill system)
- `skillConflict` (M6 skill resolution)

---

## Phase 1.5 & Beyond

- **Telemetry integration:** Export EventBus signals to external observability platforms
- **Event replay:** Record/replay event streams for debugging
- **Event filtering:** Per-subscriber event filters for selective subscription

---

## Architecture Notes

- EventBus is central to M1 RI dispatch and all observable signals
- All 6 M1 handlers wired at builder.ts:2673-2731
- Foundation layer; no dependencies on Composition or Quality layers

---

## References

- [[MOCs/Architecture MOC|Architecture MOC]] — System design
- [[Experiments/M1 RI Dispatcher|M1 RI Dispatcher]] — Uses EventBus

---

**Last Updated:** 2026-05-04  
**Layer:** Foundation  
**Status:** ✅ Stable
