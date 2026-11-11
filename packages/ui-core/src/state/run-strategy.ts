/**
 * Which reasoning strategy a run used, folded from its events. One rule for
 * every reader (a run view, a run list, a server that stores a run row), so
 * two surfaces never name different strategies for the same run. Pure.
 *
 * The strategy a run started with comes from the most authoritative source
 * seen, first-seen within a source:
 *   1. `AgentStarted.config.builder.strategy` (the resolved run config),
 *   2. `ReasoningIterationProgress.strategy` or `StrategySwitched.from` (the
 *      kernel's own loop),
 *   3. `ReasoningStepCompleted.strategy` (a step event; sub-calls such as the
 *      structured-output pipeline have published their own labels here).
 *
 * The strategy it ended on comes from the run's report
 * (`StreamCompleted.metadata.strategyUsed`, `AgentCompleted.strategyUsed`)
 * when present, else the last `StrategySwitched.to`.
 */

/** How much a strategy name can be trusted; higher wins. `0` = none seen. */
export type StrategyRank = 0 | 1 | 2 | 3;

/** Rank of `AgentStarted.config.builder.strategy`. */
export const STRATEGY_RANK_CONFIG: StrategyRank = 3;
/** Rank of the kernel loop's own events (`ReasoningIterationProgress`, `StrategySwitched.from`). */
export const STRATEGY_RANK_LOOP: StrategyRank = 2;
/** Rank of `ReasoningStepCompleted.strategy`. */
export const STRATEGY_RANK_STEP: StrategyRank = 1;

/** A strategy name an event offers, with how far to trust it. */
export interface StrategyClaim {
  readonly strategy: string;
  readonly rank: StrategyRank;
}

/** What one event says about the run's strategy. */
export interface StrategyClaims {
  /** The strategy the run started with, when this event names it. */
  readonly started?: StrategyClaim;
  /** The strategy the run ended on, when this event names it (`rank` 2 = reported, 1 = a switch). */
  readonly ended?: StrategyClaim;
}

/** Folded strategy state; start from {@link initialRunStrategy}. */
export interface RunStrategyState {
  readonly started?: string;
  readonly startedRank: StrategyRank;
  readonly ended?: string;
  readonly endedRank: StrategyRank;
}

/** The empty fold. */
export const initialRunStrategy: RunStrategyState = { startedRank: 0, endedRank: 0 };

/** The run's strategy for display. */
export interface RunStrategy {
  /** The strategy the run started with. */
  readonly strategy?: string;
  /** The strategy it ended on, only when it differs from `strategy` (a mid-run switch). */
  readonly switchedTo?: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const rec = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/**
 * What one event (its `_tag` and payload) says about the run's strategy.
 * Events that name no strategy return `{}`.
 */
export function strategyClaimsOf(type: string, payload: Record<string, unknown>): StrategyClaims {
  switch (type) {
    case "AgentStarted": {
      const s = str(rec(rec(payload.config)?.builder)?.strategy);
      return s ? { started: { strategy: s, rank: STRATEGY_RANK_CONFIG } } : {};
    }
    case "ReasoningIterationProgress": {
      const s = str(payload.strategy);
      return s ? { started: { strategy: s, rank: STRATEGY_RANK_LOOP } } : {};
    }
    case "ReasoningStepCompleted": {
      const s = str(payload.strategy);
      return s ? { started: { strategy: s, rank: STRATEGY_RANK_STEP } } : {};
    }
    case "StrategySwitched": {
      const from = str(payload.from);
      const to = str(payload.to);
      return {
        ...(from ? { started: { strategy: from, rank: STRATEGY_RANK_LOOP } } : {}),
        ...(to ? { ended: { strategy: to, rank: STRATEGY_RANK_STEP } } : {}),
      };
    }
    case "StreamCompleted":
    case "AgentCompleted": {
      const s = str(rec(payload.metadata)?.strategyUsed) ?? str(payload.strategyUsed);
      return s ? { ended: { strategy: s, rank: STRATEGY_RANK_LOOP } } : {};
    }
    default:
      return {};
  }
}

/**
 * Fold one event into the strategy state. The started strategy takes a claim
 * only when it outranks the stored one (first-seen within a rank); the ended
 * strategy takes a claim of equal or higher rank (last switch wins).
 */
export function foldRunStrategy(state: RunStrategyState, type: string, payload: Record<string, unknown>): RunStrategyState {
  const { started, ended } = strategyClaimsOf(type, payload);
  if (!started && !ended) return state;
  let next = state;
  if (started && started.rank > next.startedRank) next = { ...next, started: started.strategy, startedRank: started.rank };
  if (ended && ended.rank >= next.endedRank) next = { ...next, ended: ended.strategy, endedRank: ended.rank };
  return next;
}

/** The strategy to show: what the run started with, and what it switched to when that differs. */
export function runStrategyOf(state: RunStrategyState): RunStrategy {
  const strategy = state.started ?? state.ended;
  const switchedTo = state.ended !== undefined && state.ended !== strategy ? state.ended : undefined;
  return { ...(strategy !== undefined ? { strategy } : {}), ...(switchedTo !== undefined ? { switchedTo } : {}) };
}

/** Fold a whole event list (`{ type, payload }`) into the run's strategy. */
export function runStrategyOfEvents(
  events: readonly { readonly type: string; readonly payload: Record<string, unknown> }[],
): RunStrategy {
  return runStrategyOf(events.reduce((s, e) => foldRunStrategy(s, e.type, e.payload), initialRunStrategy));
}
