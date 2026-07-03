import * as React from "react";
import type { RunState } from "@reactive-agents/ui-core";
import { useRunCost } from "../hooks/use-run-cost.js";

export interface CostMeterProps {
  readonly state: RunState;
  readonly className?: string;
}

export function CostMeter({ state, className }: CostMeterProps): React.ReactElement {
  const { tokens, usd } = useRunCost(state);
  return (
    <div className={className} data-ra-cost data-ra-usd={usd} data-ra-tokens={tokens}>
      <span data-ra-cost-usd>${usd.toFixed(4)}</span>
      <span data-ra-cost-tokens>{tokens} tok</span>
    </div>
  );
}
