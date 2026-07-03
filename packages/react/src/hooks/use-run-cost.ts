import { useMemo } from "react";
import type { RunState } from "@reactive-agents/ui-core";

export function useRunCost(state: RunState): { tokens: number; usd: number } {
  return useMemo(() => state.cost ?? { tokens: 0, usd: 0 }, [state.cost]);
}
