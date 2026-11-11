import { formatRelativeTime, formatTurnDuration, turnStrategiesOf } from "@reactive-agents/ui-core";

/**
 * Quiet per-message metadata for the chat: when a message was sent (relative,
 * with the absolute time on hover) and which strategies an assistant turn ran,
 * read from what its runs reported (`StreamCompleted.metadata.strategyUsed` on
 * the turn and each sub-agent), never from config. Pure.
 */

/**
 * `just now`, `1 minute ago`, `3 hours ago`, `yesterday`, `4 days ago`; older than a
 * week (or in the future by more than a minute) reads as the short date. ui-core's
 * shared `formatRelativeTime`.
 */
export const relativeTime = formatRelativeTime;

/** `Nov 10, 2026, 7:21 PM` (in the viewer's locale and zone unless given). */
export function absoluteTime(ts: number, opts: { readonly locale?: string; readonly timeZone?: string } = {}): string {
  return new Date(ts).toLocaleString(opts.locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  });
}

/** A turn with a reported strategy and sub-agents whose turns may report theirs. */
export interface StrategyTurn {
  readonly strategy?: string;
  readonly subAgents?: readonly { readonly turn: StrategyTurn }[];
}

/** The chip for an assistant turn's strategies; `undefined` when no run reported one. */
export interface StrategyChip {
  /** `ReAct`, or `ReAct + Reflexion` when sub-agents ran other strategies. */
  readonly label: string;
  /** Tooltip: what the label means. */
  readonly title: string;
}

/**
 * Build the strategy chip. `labelOf` maps a strategy id to its display name (the
 * quick bar's catalog); unknown ids show as reported.
 */
export function strategyChip(turn: StrategyTurn, labelOf: (id: string) => string = (id) => id): StrategyChip | undefined {
  const s = turnStrategiesOf(turn, (t) => (t.subAgents ?? []).map((a) => a.turn));
  if (s.main === undefined && s.delegated.length === 0) return undefined;
  const main = s.main !== undefined ? labelOf(s.main) : undefined;
  const delegated = s.delegated.map(labelOf);
  const label = [main, ...delegated].filter((p): p is string => p !== undefined).join(" + ");
  const title = [
    main !== undefined ? `Strategy this run reported: ${main}` : undefined,
    delegated.length > 0 ? `Sub-agents ran: ${delegated.join(", ")}` : undefined,
  ]
    .filter((p): p is string => p !== undefined)
    .join(". ");
  return { label, title };
}

/** How long an assistant turn ran and when it finished, for the action row. */
export interface TurnTiming {
  /** `Ran 42s` once finished (with a reported duration); `Running 12s` while it streams. */
  readonly ran?: string;
  /** When it finished: relative text plus the absolute time for the hover. Absent while running. */
  readonly finished?: { readonly relative: string; readonly absolute: string; readonly at: number };
}

/**
 * Timing for an assistant turn. Duration comes from the run's reported
 * `metadata.duration`; only a turn still running counts up from its send time.
 */
export function turnTiming(
  turn: { readonly ts: number; readonly streaming?: boolean; readonly durationMs?: number; readonly finishedAt?: number },
  now: number,
  opts: { readonly locale?: string; readonly timeZone?: string } = {},
): TurnTiming {
  if (turn.streaming === true) return turn.ts > 0 ? { ran: `Running ${formatTurnDuration(now - turn.ts)}` } : {};
  const at = turn.finishedAt ?? (turn.ts > 0 ? turn.ts : undefined);
  return {
    ...(turn.durationMs !== undefined ? { ran: `Ran ${formatTurnDuration(turn.durationMs)}` } : {}),
    ...(at !== undefined ? { finished: { relative: relativeTime(at, Math.max(now, at), opts), absolute: absoluteTime(at, opts), at } } : {}),
  };
}
