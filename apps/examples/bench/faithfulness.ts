import { existsSync, readFileSync } from "node:fs";

export interface CoverageResult {
  readonly coverage: number; // 0..1
  readonly missing: readonly string[];
}

/** Pure: fraction of expectedSections present (case-sensitive substring) in the deliverable text. */
export function sectionCoverage(text: string | null, expectedSections: readonly string[]): CoverageResult {
  if (expectedSections.length === 0) return { coverage: 1, missing: [] };
  if (!text) return { coverage: 0, missing: [...expectedSections] };
  const missing = expectedSections.filter((s) => !text.includes(s));
  return { coverage: (expectedSections.length - missing.length) / expectedSections.length, missing };
}

/** Reads ./bench-out/<taskId>.md (or returns null if absent) then grades it. */
export function gradeDeliverable(taskId: string, expectedSections: readonly string[], dir = "./bench-out"): CoverageResult {
  const path = `${dir}/${taskId}.md`;
  const text = existsSync(path) ? readFileSync(path, "utf8") : null;
  return sectionCoverage(text, expectedSections);
}
