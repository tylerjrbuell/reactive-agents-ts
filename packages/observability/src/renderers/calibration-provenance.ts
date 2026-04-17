export interface CalibrationProvenance {
  readonly modelId: string;
  readonly sources: readonly ("prior" | "community" | "local")[];
  readonly localSamples: number;
  readonly summary: Partial<{
    parallelCallCapability: string;
    classifierReliability: string;
    toolCallDialect: string;
  }>;
}

/**
 * Render a one-line calibration provenance string for the execution summary.
 * Example: "calibration: cogito | source: prior+local (12 samples) | parallel=reliable classifier=low"
 */
export function renderCalibrationProvenance(p: CalibrationProvenance): string {
  const sourceLabel =
    p.sources.length === 1 && p.sources[0] === "prior"
      ? "prior-only"
      : p.sources.join("+");
  const samplePart = p.sources.includes("local") ? ` (${p.localSamples} samples)` : "";
  const bits: string[] = [];
  if (p.summary.parallelCallCapability) bits.push(`parallel=${p.summary.parallelCallCapability}`);
  if (p.summary.classifierReliability) bits.push(`classifier=${p.summary.classifierReliability}`);
  if (p.summary.toolCallDialect) bits.push(`dialect=${p.summary.toolCallDialect}`);
  const summaryPart = bits.length > 0 ? ` | ${bits.join(" ")}` : "";
  return `calibration: ${p.modelId} | source: ${sourceLabel}${samplePart}${summaryPart}`;
}
