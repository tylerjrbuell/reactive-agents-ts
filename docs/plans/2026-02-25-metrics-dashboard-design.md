# CLI Metrics Dashboard Design
**Date:** 2026-02-25
**Status:** Approved
**Scope:** Professional console metrics output for Reactive Agents observability

---

## Problem Statement

Current metrics output is verbose and hard to scan:
- 16+ lines of repetitive counter/histogram output
- No visual hierarchy or actionable insights
- Difficult for production engineers to spot bottlenecks
- Boring, not aligned with "professional observability" vision

**Goal:** Transform metrics output into a professional CLI dashboard that shows:
- ✅ Quick health/status at a glance
- ✅ Which phases are bottlenecks (with percentages)
- ✅ Tool execution summary
- ✅ Smart warnings and optimization tips
- ✅ Cost/token tracking

---

## Design

### Visual Layout

```
┌─────────────────────────────────────────────────────────────┐
│ ✅ Agent Execution Summary                                   │
├─────────────────────────────────────────────────────────────┤
│ Status:    ✅ Success   Duration: 13.9s   Steps: 7          │
│ Tokens:    1,963        Cost: ~$0.003     Model: claude-3.5 │
└─────────────────────────────────────────────────────────────┘

📊 Execution Timeline
├─ [bootstrap]       100ms    ✅
├─ [strategy]         50ms    ✅
├─ [think]        10,001ms    ⚠️  (7 iter, 72% of time)
├─ [act]           1,000ms    ✅  (2 tools)
├─ [observe]         500ms    ✅
├─ [memory-flush]    200ms    ✅
└─ [complete]         28ms    ✅

🔧 Tool Execution (2 called)
├─ file-write    ✅ 3 calls, 450ms avg
└─ web-search    ✅ 2 calls, 280ms avg

⚠️  Alerts & Insights
├─ think phase blocked ≥10s (LLM latency)
├─ 7 iterations needed (complex reasoning)
└─ 💡 Consider: Simpler task prompt or shorter context
```

### Key Features

#### 1. **Header Card** (5 lines)
- Overall status (success/failure/partial)
- Total duration (human-readable: "13.9s")
- Step count (iterations in think phase)
- Token count + cost estimate
- Model used

**Data Source:** ExecutionContext, Metric collection

#### 2. **Execution Timeline** (8-10 lines)
- Each phase on one line
- Format: `[phase-name]  XXXXX ms  STATUS  (optional details)`
- Status icons: ✅ = ok, ⚠️ = warning (>10s or high %), ❌ = error
- For think phase: show iteration count & % of total time
- For act phase: show tool count
- Omit phases that didn't run

**Data Source:** Phase durations from metrics, iteration counts

#### 3. **Tool Execution Summary** (variable, 3-6 lines)
- Only show if tools were called
- Format: `tool-name  STATUS  N calls, AVG_MS avg`
- Group by success/failure
- Show percentages of total execution time if >5%

**Data Source:** ToolService call tracking, phase metrics

#### 4. **Alerts & Insights** (3-5 lines)
- Only show meaningful warnings/tips
- Examples:
  - Phase blocked ≥10s (LLM latency bottleneck)
  - High iteration count (reasoning complexity)
  - Tool failures
  - Token budget warnings
  - Context truncation warnings

**Data Source:** Phase durations, error tracking, token budgets

### Design Principles

1. **Professional & Scannable**
   - Clear hierarchy (header → timeline → tools → alerts)
   - Consistent spacing and alignment
   - Unicode box drawing for structure, ASCII for compatibility

2. **Actionable**
   - Highlight bottlenecks with percentages
   - Smart warnings (don't spam "all OK")
   - Optimization tips ("Consider simpler prompt" etc)

3. **Compact**
   - Target: 20-25 lines max for typical execution
   - Omit zero-value sections
   - Optional expansion mode for verbose/debug verbosity levels

4. **Production-Ready**
   - Shows cost estimates (aligns with efficiency pillar)
   - No noise, only meaningful data
   - Exportable to JSON for dashboards (future)

---

## Implementation Plan

### Phase 1: Core Dashboard (v0.5.3)
- [ ] Add `MetricsCollector` enhancements (tool tracking)
- [ ] Create `formatMetricsDashboard()` function in console-exporter
- [ ] Update `exportMetrics()` to call new dashboard formatter
- [ ] Wire tool execution counts into metric tracking
- [ ] Add cost calculation (tokens → estimated cost)
- [ ] Update tests

### Phase 2: Smart Insights (v0.6.0)
- [ ] Implement alert generation logic
- [ ] Add optimization tip engine
- [ ] Configure thresholds (10s block warning, etc)
- [ ] Add context to insights (model-specific, budget-aware)

### Phase 3: Future Enhancements (v1.0+)
- [ ] JSON report export alongside console
- [ ] SQLite storage (ExecutionLog table)
- [ ] Access control & audit trail
- [ ] Agent dashboard/UI
- [ ] Multi-agent report aggregation

---

## Data Flow

```
ExecutionEngine (phase metrics)
  ↓
MetricsCollector (gather counters, tool calls)
  ↓
ConsoleExporter.exportMetrics()
  ├─ formatMetricsDashboard()  [CORE]
  │  ├─ buildHeaderCard()
  │  ├─ buildTimelineSection()
  │  ├─ buildToolSection()
  │  └─ buildAlertsSection()
  └─ console.log(formattedOutput)
```

---

## Success Criteria

✅ Dashboard displays on every agent execution with observability enabled
✅ All phases visible in timeline (no raw counter noise)
✅ Bottlenecks highlighted with duration & percentage
✅ Tool execution summarized (count, avg duration)
✅ Smart alerts only show for meaningful conditions
✅ Output fits in ~25 lines (typical terminal height friendly)
✅ Professional appearance (no debug clutter)
✅ All 864 tests pass with new output format

---

## File Changes Summary

| File | Change | Complexity |
|------|--------|-----------|
| `packages/observability/src/exporters/console-exporter.ts` | Add dashboard formatter + helper functions | Medium |
| `packages/observability/src/metrics/metrics-collector.ts` | Track tool execution counts | Low |
| `packages/observability/tests/console-exporter.test.ts` | Test new dashboard formatter | Low |
| `packages/runtime/src/execution-engine.ts` | Pass tool execution data to metrics | Low |

---

## Notes

- **ANSI Colors**: Reuse existing color scheme (GREEN, YELLOW, RED, CYAN)
- **Unicode Safety**: Box drawing works on modern terminals; fallback to ASCII if needed
- **Performance**: Dashboard formatting is post-execution, no impact on agent latency
- **Backward Compat**: Can add `showMetricsDashboard?: boolean` config flag if needed
- **Future**: Dashboard formatter returns structured object + string, enabling JSON export later
