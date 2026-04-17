# ObservableLogger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified, structured logging system that streams real-time execution events to multiple destinations, supports both live and buffered modes, and is machine-parseable for agentic feedback loops.

**Architecture:** LogEvent types capture execution facts (phases, tools, metrics, errors). ObservableLogger service manages a buffer and subscribers. EventFormatter converts events to human-readable `[tag:value]` format. NoticesManager shows telemetry disclaimers once per session. Integration points throughout execution emit events at key moments. Config controls live vs buffered behavior.

**Tech Stack:** Effect-TS, TypeScript, existing observability infrastructure

---

## File Structure

**New files:**
- `packages/observability/src/logging/observable-logger.ts` — Core logger implementation
- `packages/observability/src/logging/event-formatter.ts` — Event → string formatting
- `packages/observability/src/logging/notices-manager.ts` — Notices system for disclaimers
- `packages/observability/tests/logging/observable-logger.test.ts` — Logger tests
- `packages/observability/tests/logging/event-formatter.test.ts` — Formatter tests
- `packages/observability/tests/logging/notices-manager.test.ts` — Notices tests
- `packages/observability/tests/integration/observable-logger-e2e.test.ts` — E2E test
- `packages/observability/tests/logging/live-buffered-modes.test.ts` — Mode tests

**Modified files:**
- `packages/observability/src/types.ts` — Add LogEvent union type and RunSummary interface
- `packages/observability/src/index.ts` — Export ObservableLogger, formatEvent, makeNoticesManager
- `packages/runtime/src/types.ts` — Add logging config to ReactiveAgentsConfig
- `packages/runtime/src/execution-engine.ts` — Emit startup/completion events, integrate logger
- `packages/reasoning/src/strategies/kernel/kernel-runner.ts` — Emit phase events
- `packages/tools/src/execution/tool-executor.ts` — Emit tool events (or equivalent)
- `packages/reasoning/src/strategies/kernel/utils/reactive-observer.ts` — Emit entropy metrics
- `packages/reactive-intelligence/src/telemetry-client.ts` — Replace telemetry spam with notices

---

## Phase 1: Type Definitions & Core Logger

### Task 1: Define LogEvent Types

**Files:**
- Modify: `packages/observability/src/types.ts`

**Steps:**
- [ ] Add LogEvent union type with 9 event variants (_tag: phase_started, phase_complete, tool_call, tool_result, metric, warning, error, iteration, completion)
- [ ] Add RunSummary interface with status, duration, totalTokens, phaseMetrics, toolMetrics, warnings, errors
- [ ] Commit: "feat(observability): define LogEvent and RunSummary types"

---

### Task 2: Create ObservableLogger Service Interface

**Files:**
- Create: `packages/observability/src/logging/observable-logger.ts`

**Steps:**
- [ ] Define ObservableLogger interface with 7 methods: emit(), subscribe(), toStream(), getBuffer(), format(), flush(), reset()
- [ ] Create Context.Tag for ObservableLogger service
- [ ] Add JSDoc with usage examples
- [ ] Commit: "feat(observability): define ObservableLogger interface"

---

### Task 3: Implement ObservableLogger Service

**Files:**
- Modify: `packages/observability/src/logging/observable-logger.ts` (add implementation)
- Create: `packages/observability/tests/logging/observable-logger.test.ts`

**Steps:**
- [ ] Write 6 tests: buffers events, subscribes, formats, flushes to RunSummary, toStream support, reset
- [ ] Run tests (expect fail - implementation not yet written)
- [ ] Implement makeObservableLogger factory function with Effect-based design
- [ ] Implement assembleSummary helper to build RunSummary from buffered events
- [ ] Add stub event formatter (will be replaced by Task 4)
- [ ] Run tests (expect pass)
- [ ] Commit: "feat(observability): implement ObservableLogger service with tests"

---

### Task 3.5: Build Notices Manager

**Files:**
- Create: `packages/observability/src/logging/notices-manager.ts`
- Create: `packages/observability/tests/logging/notices-manager.test.ts`

**Steps:**
- [ ] Write 5 tests: shows once per session, distinguishes notice types, respects dismissal, resets on new session
- [ ] Run tests (expect fail)
- [ ] Implement NoticesManager interface with shouldShow(), dismiss(), reset()
- [ ] Implement makeNoticesManager factory
- [ ] Add NOTICES constant with pre-defined notice IDs (TELEMETRY_ENABLED, etc.)
- [ ] Run tests (expect pass)
- [ ] Commit: "feat(observability): add notices manager for telemetry disclaimers"

---

## Phase 2: Formatting & Output

### Task 4: Create Event Formatter

**Files:**
- Create: `packages/observability/src/logging/event-formatter.ts`
- Create: `packages/observability/tests/logging/event-formatter.test.ts`

**Steps:**
- [ ] Write 11 tests covering all LogEvent types: phase_started/complete, tool_call/result, metric, warning, error, iteration, completion, notice
- [ ] Run tests (expect fail)
- [ ] Implement formatEvent() function with proper formatting rules:
  - phase_started: `→ [phase:name] Starting...`
  - phase_complete: `✓/✗/⚠️ [phase:name] X.Xs`
  - tool_call: `  → [tool:name] call N`
  - tool_result: `  ✓/✗ [tool:name] X.XXs [error msg]`
  - metric: `  📊 [metric:name] value unit`
  - warning: `⚠️  [warning] message (context)`
  - error: `✗ [error] message: Error`
  - iteration: `  [iter:N:phase] summary...`
  - completion: `✓/✗ [completion] summary`
  - notice: `ℹ️/💡 title — message (link)`
- [ ] Run tests (expect pass)
- [ ] Update observable-logger stub to use real formatEvent
- [ ] Re-run observable-logger tests (expect pass)
- [ ] Commit: "feat(observability): add event formatter with comprehensive formatting rules"

---

## Phase 3: Integration & Configuration

### Task 5: Add Logging Configuration

**Files:**
- Modify: `packages/runtime/src/types.ts`
- Modify: `packages/observability/src/index.ts`

**Steps:**
- [ ] Add logging config to ReactiveAgentsConfig with live: boolean, minLevel, destinations[]
- [ ] Export ObservableLogger, makeObservableLogger, formatEvent, RunSummary from observability index
- [ ] Commit: "feat(config): add logging configuration to ReactiveAgentsConfig"

---

### Task 6: Integrate ObservableLogger into Execution Engine

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts`

**Steps:**
- [ ] Import ObservableLogger, makeObservableLogger
- [ ] Initialize logger at execution start based on config.logging.live
- [ ] Emit phase_started for 'execution' at start
- [ ] Emit completion event at end with success/summary
- [ ] If not live mode, print summary after execution
- [ ] Provide logger as a service via Effect.provideService
- [ ] Commit: "feat(runtime): integrate ObservableLogger into execution engine"

---

### Task 7: Emit Phase Events from Kernel Runner

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/kernel-runner.ts`

**Steps:**
- [ ] Import ObservableLogger
- [ ] At start of each phase (think, act, observe, complete): emit phase_started event
- [ ] Track phase start time
- [ ] At end of each phase: emit phase_complete with duration and status
- [ ] Use Effect.serviceOption to safely access logger (optional service)
- [ ] Commit: "feat(reasoning): emit phase events from kernel runner"

---

### Task 8: Emit Tool Execution Events

**Files:**
- Modify: `packages/tools/src/execution/tool-executor.ts` (find the tool execution location)

**Steps:**
- [ ] Before tool execution: emit tool_call event with tool name and iteration
- [ ] Track start time
- [ ] On success: emit tool_result with status: 'success', duration
- [ ] On error: emit tool_result with status: 'error', error message, duration
- [ ] Use Effect.serviceOption for safe optional logging
- [ ] Commit: "feat(tools): emit tool execution events"

---

### Task 9: Emit Reactive Intelligence Events

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/utils/reactive-observer.ts`

**Steps:**
- [ ] When entropy scores computed: emit metric event with name: 'entropy', value: composite score
- [ ] Monitor for high entropy (>0.7): emit warning event
- [ ] Use Effect.serviceOption for optional logging
- [ ] Commit: "feat(reactive-intelligence): emit entropy and anomaly metrics"

---

### Task 9.5: Replace Telemetry Log Spam with Notices

**Files:**
- Modify: `packages/reactive-intelligence/src/telemetry-client.ts`
- Modify: `packages/runtime/src/execution-engine.ts`

**Steps:**
- [ ] Find and remove old "ℹ Reactive Intelligence telemetry enabled..." console.log
- [ ] Replace with notice event emission using NoticesManager
- [ ] Provide NoticesManager as a service in execution engine
- [ ] Emit notice event only if noticesManager.shouldShow('telemetry-enabled') returns true
- [ ] Format notice event as: `ℹ️ Telemetry Enabled — Anonymous entropy data helps improve the framework (docs/telemetry)`
- [ ] Commit: "feat: replace telemetry log spam with notices system"

---

### Task 10: Emit Error Events

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts` (error handling sections)

**Steps:**
- [ ] In error handlers for tool failures: emit error event with message and error object
- [ ] In guardrail violations: emit error event
- [ ] In budget exceeded: emit error event
- [ ] Use Effect.serviceOption for optional logging
- [ ] Commit: "feat(runtime): emit error events on failures"

---

## Phase 4: Testing & Validation

### Task 11: End-to-End Integration Test

**Files:**
- Create: `packages/observability/tests/integration/observable-logger-e2e.test.ts`

**Steps:**
- [ ] Write E2E test simulating complete execution trace with 9 events
- [ ] Verify buffer collection, summary assembly, tool metrics
- [ ] Write test for streaming to multiple destinations
- [ ] Run tests (expect pass)
- [ ] Commit: "test(observability): add E2E integration test for ObservableLogger"

---

### Task 12: Live vs Buffered Mode Test

**Files:**
- Create: `packages/observability/tests/logging/live-buffered-modes.test.ts`

**Steps:**
- [ ] Write test: live mode outputs immediately
- [ ] Write test: buffered mode delays output until flush
- [ ] Write test: both modes buffer events
- [ ] Run tests (expect pass)
- [ ] Commit: "test(observability): add live vs buffered mode tests"

---

### Task 13: Run Full Test Suite

**Files:** All

**Steps:**
- [ ] Run all observability tests: `rtk vitest run packages/observability/tests/`
- [ ] Run TypeScript check: `rtk tsc --noEmit packages/observability/ packages/runtime/ packages/reasoning/ packages/tools/`
- [ ] Review git log: `rtk git log --oneline HEAD~14..HEAD`
- [ ] All tests pass ✓
- [ ] All types pass ✓
- [ ] Commit summary: "feat(observability): complete ObservableLogger implementation"

---

## Summary

**Total Tasks:** 14
**New Files:** 8
**Modified Files:** 8
**Total Commits:** 14

**Key Features:**
- ✅ Structured LogEvent types for all execution facts
- ✅ ObservableLogger service with 7 methods
- ✅ Event formatter with [tag:value] format
- ✅ NoticesManager for showing disclaimers once per session
- ✅ Live and buffered output modes
- ✅ Multiple output destinations (console, UI, files, custom)
- ✅ RunSummary assembly from buffered events
- ✅ Comprehensive test coverage (14+ tests)
- ✅ Zero telemetry spam in normal output
