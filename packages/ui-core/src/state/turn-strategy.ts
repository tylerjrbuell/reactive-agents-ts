/**
 * Which reasoning strategies a turn ran, read from what the runs REPORTED
 * (`StreamCompleted.metadata.strategyUsed` on the turn and on each sub-agent),
 * never inferred from config. Pure.
 */

/** Anything carrying a reported strategy and (optionally) sub-agents that do too. */
export interface StrategySource {
  readonly strategy?: string;
}

/** The turn's strategies: its own, then the distinct ones its sub-agents ran. */
export interface TurnStrategies {
  /** The strategy the turn's run reported (the last one, after any switch). */
  readonly main?: string;
  /** Distinct strategies its sub-agents reported (any depth), excluding `main`, in first-seen order. */
  readonly delegated: readonly string[];
}

/**
 * Collect a turn's strategies. `children` returns a node's sub-agents (live:
 * `Object.values(trace.subAgents).map(b => b.trace)`; persisted:
 * `(trace.subAgents ?? []).map(p => p.trace)`).
 */
export function turnStrategiesOf<T extends StrategySource>(turn: T, children: (node: T) => readonly T[]): TurnStrategies {
  const seen: string[] = [];
  const walk = (node: T): void => {
    for (const c of children(node)) {
      if (c.strategy !== undefined && c.strategy !== turn.strategy && !seen.includes(c.strategy)) seen.push(c.strategy);
      walk(c);
    }
  };
  walk(turn);
  return { ...(turn.strategy !== undefined ? { main: turn.strategy } : {}), delegated: seen };
}
