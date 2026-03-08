import type { BudgetLimits } from "./types.js";
import { DEFAULT_BUDGET_LIMITS } from "./types.js";
import { CostServiceLive, type CostServiceOptions } from "./cost-service.js";

export const createCostLayer = (
  budgetLimits?: Partial<BudgetLimits>,
  options?: CostServiceOptions,
) =>
  CostServiceLive(
    { ...DEFAULT_BUDGET_LIMITS, ...budgetLimits },
    options,
  );
