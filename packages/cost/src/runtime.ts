import type { BudgetLimits } from "./types.js";
import { DEFAULT_BUDGET_LIMITS } from "./types.js";
import { CostServiceLive } from "./cost-service.js";

export const createCostLayer = (budgetLimits?: Partial<BudgetLimits>) =>
  CostServiceLive({
    ...DEFAULT_BUDGET_LIMITS,
    ...budgetLimits,
  });
