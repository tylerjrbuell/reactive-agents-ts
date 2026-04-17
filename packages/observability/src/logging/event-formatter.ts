import type { LogEvent } from "../types.js";

/**
 * Format a LogEvent into a human-readable [tag:value] string.
 *
 * Output format follows: emoji status, [tag:value] labels, details
 * - Phases use .1f duration (e.g., 32.5s)
 * - Tools use .2f duration (e.g., 1.20s)
 * - Emojis: → starting, ✓ success, ✗ error, ⚠️ warning, 📊 metric, ℹ️ info, 💡 hint
 */
export function formatEvent(event: LogEvent): string {
  switch (event._tag) {
    case "phase_started": {
      return `→ [phase:${event.phase}] Starting...`;
    }

    case "phase_complete": {
      const icon =
        event.status === "success" ? "✓" : event.status === "error" ? "✗" : "⚠️";
      const durationSec = (event.duration / 1000).toFixed(1);
      const details = event.details ? ` — ${event.details}` : "";
      return `${icon} [phase:${event.phase}] ${durationSec}s${details}`;
    }

    case "tool_call": {
      return `  → [tool:${event.tool}] call ${event.iteration}`;
    }

    case "tool_result": {
      const icon = event.status === "success" ? "✓" : "✗";
      const durationSec = (event.duration / 1000).toFixed(2);
      const error = event.error ? ` — ${event.error}` : "";
      return `  ${icon} [tool:${event.tool}] ${durationSec}s${error}`;
    }

    case "metric": {
      const unit = event.unit ? ` ${event.unit}` : "";
      return `  📊 [metric:${event.name}] ${event.value}${unit}`;
    }

    case "warning": {
      const ctx = event.context ? ` (${event.context})` : "";
      return `⚠️ [warning] ${event.message}${ctx}`;
    }

    case "error": {
      const err = event.error
        ? `: ${event.error.message}`
        : "";
      return `✗ [error] ${event.message}${err}`;
    }

    case "iteration": {
      const summary = event.summary
        ? ` — ${event.summary.substring(0, 60)}${event.summary.length > 60 ? "..." : ""}`
        : "";
      return `  [iter:${event.iteration}:${event.phase}]${summary}`;
    }

    case "completion": {
      const icon = event.success ? "✓" : "✗";
      return `${icon} [completion] ${event.summary}`;
    }

    case "notice": {
      const icon = event.level === "info" ? "ℹ️" : "💡";
      const link = event.docsLink ? ` (${event.docsLink})` : "";
      return `${icon} ${event.title} — ${event.message}${link}`;
    }
  }
}
