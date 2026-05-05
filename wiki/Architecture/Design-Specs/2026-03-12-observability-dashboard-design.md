# Observability Dashboard — chalk+boxen Upgrade

**Date:** 2026-03-12
**Status:** Approved

## Goal

Replace raw ANSI escape codes in the observability dashboard formatter with `chalk` + `boxen`, matching the brand palette used in the CLI's `ui.ts`. Eliminate the duplicate `renderDashboard()` in the CLI. Result: one canonical, visually polished dashboard that renders identically whether called from user code or from `rax`.

## Scope

### packages/observability

- Add `chalk ^5.4.0` and `boxen ^8.0.1` to `package.json` dependencies. These exact versions are already used in `apps/cli/package.json`; Bun workspace deduplication should resolve a single copy.
- Rewrite `formatMetricsDashboard()` in `src/exporters/console-exporter.ts`:
  - Remove all raw `\x1b[...]` ANSI constants (`RESET`, `BOLD`, `DIM`, `RED`, etc.).
  - Replace with `chalk.hex()` using brand palette (sourced from `apps/cli/src/ui.ts`):
    - Violet `#8b5cf6` — section headers
    - Cyan `#06b6d4` — section titles, tool names
    - Green `#22c55e` — success icons
    - Yellow `#eab308` — warnings
    - Red `#ef4444` — errors
    - Dim `#6b7280` — muted/secondary text
  - Header card becomes a `boxen` rounded box; border color driven by execution status (green success / red error / yellow partial).
  - Phase timeline, tool table, and alerts sections use `chalk.hex()` for coloring.
- API surface unchanged: `formatMetricsDashboard(data: DashboardData): string`. Callers doing `console.log(formatMetricsDashboard(data))` continue to work without changes.
- `chalk` respects `NO_COLOR` and `FORCE_COLOR` env vars and TTY detection automatically. In CI or non-TTY environments chalk emits plain text. This is acceptable — the acceptance criteria target removal of hand-written ANSI constants only, not chalk-emitted codes.

### Emoji width handling

Emoji characters occupy 2 terminal columns but have a string `.length` of 1–2 code units. This causes misaligned box borders and ragged padding whenever emoji appear inside manually-padded strings. Rules:

- **Inside `boxen` boxes** — let boxen own all padding; do not manually pad content strings that contain emoji. Boxen does not currently account for wide characters, so keep emoji out of the padded header lines entirely, or place them only at the start of a line where trailing padding is not needed.
- **Outside boxen (timeline / tools / alerts tree lines)** — do not use `String.padEnd()` or `String.padStart()` on strings that contain emoji. Use a `visualWidth(s)` helper that counts emoji as 2 columns and pads with spaces to the target width manually. The existing `buildBoxLine()` helper in the current code demonstrates the pattern — extract it as a reusable utility.
- **Section headers** (e.g. `📊 Execution Timeline`) — these are standalone `console.log` lines with no trailing border alignment requirement, so emoji are safe here.
- Acceptance: all tree-branch columns (`├─`, `└─` prefix, phase name column, duration column, icon column) must visually align when viewed in a standard 80-column terminal.

### apps/cli

**Interface reconciliation required** — `ui.ts` and `console-exporter.ts` define structurally different `DashboardData` shapes:

| Field | `ui.ts` | `console-exporter.ts` |
|---|---|---|
| `DashboardTool.calls` | `calls: number` | `callCount: number` |
| `DashboardTool.errors` | `errors: number` | `errorCount: number; successCount: number` |
| `DashboardPhase.detail` | `detail?: string` | `details?: string` |
| `DashboardData.alerts` | `readonly string[]` | `readonly DashboardAlert[]` |

When updating `demo.ts`, align the object literals to the observability types (e.g. `callCount` not `calls`). The `alerts` field changes from `string[]` to `DashboardAlert[]` — demo currently passes `alerts: []` so no runtime change needed, just the import type.

**Changes:**
- Remove from `src/ui.ts`:
  - `renderDashboard()` function
  - Local `DashboardPhase`, `DashboardTool`, `DashboardData` interface definitions (lines 199–224)
- Update `src/commands/demo.ts`:
  - Remove `renderDashboard` and `DashboardData` imports from `../ui.js`
  - Import `formatMetricsDashboard` and `DashboardData` from `@reactive-agents/observability`
  - Replace `renderDashboard(dashboardData)` with `console.log(formatMetricsDashboard(dashboardData))`
  - Note: `renderDashboard()` was `void` (called `console.log` internally); `formatMetricsDashboard()` returns `string` — the explicit `console.log()` wrapper is required
- Check all other CLI files for any remaining `renderDashboard` usage and update accordingly

### Tests

Existing `formatMetricsDashboard` tests in `packages/observability/tests/` assert on plain text content (e.g. `.toContain("[think]")`) and should continue passing since chalk/boxen preserve text. If any tests break due to boxen border characters in the header, update them to use `strip-ansi` before asserting or assert on content below the header box.

## Non-Goals

- No new package (`@reactive-agents/ui`) — chalk/boxen go directly into observability.
- No changes to `DashboardData` shape, `buildDashboardData()` logic, or metrics collection.
- No changes to EventBus wiring or other exporters.

## Acceptance Criteria

1. `bun test` passes across all packages (1921 tests).
2. `bun run build` succeeds for both `packages/observability` and `apps/cli`.
3. `rax demo` renders the dashboard with boxen + chalk colors *(manual smoke-test)*.
4. No raw `\x1b[` hand-written ANSI constants remain in `console-exporter.ts`.
5. `renderDashboard` is removed from `ui.ts`; no remaining references in the CLI.
6. `formatMetricsDashboard` is exported from `@reactive-agents/observability` and importable from user code.
7. Timeline, tool, and alert tree columns align cleanly with no ragged offsets caused by emoji double-width characters *(manual smoke-test)*.
