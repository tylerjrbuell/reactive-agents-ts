# Observability Dashboard — chalk+boxen Upgrade

**Date:** 2026-03-12
**Status:** Approved

## Goal

Replace raw ANSI escape codes in the observability dashboard formatter with `chalk` + `boxen`, matching the brand palette used in the CLI's `ui.ts`. Eliminate the duplicate `renderDashboard()` in the CLI. Result: one canonical, visually polished dashboard that renders identically whether called from user code or from `rax`.

## Scope

### packages/observability

- Add `chalk ^5.4.0` and `boxen ^8.0.1` to `package.json` dependencies.
- Rewrite `formatMetricsDashboard()` in `src/exporters/console-exporter.ts`:
  - Remove all raw `\x1b[...]` ANSI constants (`RESET`, `BOLD`, `DIM`, `RED`, etc.).
  - Replace with `chalk.hex()` using brand palette:
    - Violet `#8b5cf6` — section headers
    - Cyan `#06b6d4` — section titles, tool names
    - Green `#22c55e` — success icons
    - Yellow `#eab308` — warnings
    - Red `#ef4444` — errors
    - Dim `#6b7280` — muted/secondary text
  - Header card becomes a `boxen` rounded box; border color driven by execution status (green/red/yellow).
  - Phase timeline, tool table, and alerts sections use `chalk.hex()` for coloring.
- API surface unchanged: `formatMetricsDashboard(data: DashboardData): string`.

### apps/cli

- Remove from `src/ui.ts`:
  - `renderDashboard()` function
  - Local `DashboardPhase`, `DashboardTool`, `DashboardData` interface definitions
- Update `src/commands/demo.ts`:
  - Remove `renderDashboard` and `DashboardData` imports from `../ui.js`
  - Import `formatMetricsDashboard` and `DashboardData` from `@reactive-agents/observability`
  - Replace `renderDashboard(dashboardData)` call with `console.log(formatMetricsDashboard(dashboardData))`
- Check all other CLI commands for any remaining `renderDashboard` usage and update.

## Non-Goals

- No new package (`@reactive-agents/ui`) — chalk/boxen go directly into observability.
- No changes to `DashboardData` shape or `buildDashboardData()` logic.
- No changes to metrics collection, EventBus wiring, or exporters other than the formatter.

## Acceptance Criteria

1. `bun test` passes across all packages (1921 tests).
2. `bun run build` succeeds for both `packages/observability` and `apps/cli`.
3. `rax demo` renders the dashboard using boxen + chalk colors.
4. No raw `\x1b[` ANSI constants remain in `console-exporter.ts`.
5. `renderDashboard` is removed from `ui.ts`; no remaining references in the CLI.
