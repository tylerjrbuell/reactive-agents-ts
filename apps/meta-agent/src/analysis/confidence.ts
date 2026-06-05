// apps/meta-agent/src/analysis/confidence.ts
import type { Confidence } from "./types.js";

export const assignConfidence = (recencyDays: number, corroboration: number): Confidence => {
  if (recencyDays <= 30 && corroboration >= 2) return "high";
  if (recencyDays <= 90 || corroboration >= 1) return "medium";
  return "low";
};
