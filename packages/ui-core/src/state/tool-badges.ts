import type { StepCall, TurnStep } from "./turn-steps.js";

/**
 * Compact badge view of a tool group: one badge per tool, so a chat can show
 * `web-search ×3 · file-write · fetch ✗` at a glance instead of a long text
 * list. Failed calls colour their tool's badge; a failure a later call of the
 * same tool fixed shows as fixed, not failed. Pure.
 */

/** How a badge reads at a glance. `failed` = a failure nothing fixed; `fixed` = every failure was fixed. */
export type ToolBadgeTone = "running" | "failed" | "fixed" | "ok";

/** One tool in a group. */
export interface ToolBadge {
  /** Display name without an MCP server prefix. */
  readonly name: string;
  /** Calls of this tool in the group. */
  readonly count: number;
  /** Calls that failed. */
  readonly failed: number;
  /** Of those, failures a later call fixed. */
  readonly fixed: number;
  /** True while a call of this tool runs. */
  readonly running: boolean;
  readonly tone: ToolBadgeTone;
  /** `web-search ×3`, `fetch ×2 · 1 failed`, for a tooltip or screen reader. */
  readonly label: string;
}

/** Badges for one group, capped, with the rest folded into an overflow count. */
export interface ToolBadges {
  /** Shown badges: failing tools first, then the rest in first-call order. */
  readonly badges: readonly ToolBadge[];
  /** Tools beyond the cap (`+N`). */
  readonly overflow: number;
  /** The hidden tools' names, for the overflow tooltip. */
  readonly overflowNames: readonly string[];
  /** Failed calls nothing fixed, across the whole group (hidden badges included). */
  readonly unfixed: number;
  /** Group tone: running beats failed beats fixed beats ok. */
  readonly tone: ToolBadgeTone;
}

const toneOf = (running: boolean, failed: number, fixed: number): ToolBadgeTone =>
  running ? "running" : failed > fixed ? "failed" : failed > 0 ? "fixed" : "ok";

const RANK: Record<ToolBadgeTone, number> = { failed: 0, running: 1, fixed: 2, ok: 3 };

/**
 * Badges for the steps of one tool group (a `TranscriptTools.steps` list, or
 * any steps). `max` caps the shown badges (default 4); a failing tool is never
 * hidden behind the overflow while a healthy one shows.
 */
export function toolBadgesOf<C extends StepCall>(steps: readonly TurnStep<C>[], opts: { readonly max?: number } = {}): ToolBadges {
  const max = Math.max(1, opts.max ?? 4);
  const fixedIds = new Set(steps.flatMap((s) => s.failures.filter((f) => f.fixedBy !== undefined).map((f) => f.callId)));
  const byName = new Map<string, { count: number; failed: number; fixed: number; running: boolean; order: number }>();
  for (const step of steps) {
    for (const action of step.actions) {
      const prev = byName.get(action.shortName) ?? { count: 0, failed: 0, fixed: 0, running: false, order: byName.size };
      for (const c of action.calls) {
        prev.count += 1;
        if (c.status === "failed") {
          prev.failed += 1;
          if (fixedIds.has(c.id)) prev.fixed += 1;
        }
        if (c.status === "running") prev.running = true;
      }
      byName.set(action.shortName, prev);
    }
  }
  const all = [...byName.entries()].map(([name, b]): ToolBadge & { order: number } => ({
    name,
    count: b.count,
    failed: b.failed,
    fixed: b.fixed,
    running: b.running,
    tone: toneOf(b.running, b.failed, b.fixed),
    label: [
      b.count > 1 ? `${name} ×${b.count}` : name,
      b.failed > 0 ? `${b.failed} failed${b.fixed > 0 ? `, ${b.fixed} fixed` : ""}` : undefined,
    ]
      .filter((p): p is string => p !== undefined)
      .join(" · "),
    order: b.order,
  }));
  // Failing and running tools claim the visible slots first; display keeps first-call order.
  const shown = new Set(
    [...all]
      .sort((a, b) => RANK[a.tone] - RANK[b.tone] || a.order - b.order)
      .slice(0, max)
      .map((b) => b.name),
  );
  const strip = ({ order: _order, ...b }: ToolBadge & { order: number }): ToolBadge => b;
  const badges = all.filter((b) => shown.has(b.name)).map(strip);
  const hidden = all.filter((b) => !shown.has(b.name));
  const unfixed = all.reduce((n, b) => n + (b.failed - b.fixed), 0);
  const anyRunning = all.some((b) => b.running);
  const failed = all.reduce((n, b) => n + b.failed, 0);
  return {
    badges,
    overflow: hidden.length,
    overflowNames: hidden.map((b) => b.name),
    unfixed,
    tone: anyRunning ? "running" : unfixed > 0 ? "failed" : failed > 0 ? "fixed" : "ok",
  };
}
