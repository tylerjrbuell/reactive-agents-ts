/**
 * Freshness guard for the docs home page's golden run.
 *
 * The page replays one live capture and states its version and date. A capture
 * that lags the framework by more than MAX_MINORS_BEHIND minors (or lacks the
 * `capture` provenance block) misleads adopters about current behaviour, so
 * check-docs-sync fails on it. Refresh procedure: wiki/Reference/Docs-Derivation-Audit.md.
 */
import { parseMinor } from "../src/content/indicators";

export const MAX_MINORS_BEHIND = 2;

export interface GoldenCaptureLike {
  readonly capture?: {
    readonly frameworkVersion?: string;
    readonly capturedAt?: string;
  } | null;
}

/** Problems with one golden-run data file against the current framework version; empty when fresh. */
export function goldenRunProblems(label: string, data: GoldenCaptureLike, currentVersion: string): string[] {
  const cap = data.capture;
  if (!cap?.capturedAt || !/^\d{4}-\d{2}-\d{2}$/.test(cap.capturedAt)) {
    return [`${label}: capture.capturedAt missing or not YYYY-MM-DD`];
  }
  if (!cap.frameworkVersion) return [`${label}: capture.frameworkVersion missing`];
  const captured = parseMinor(cap.frameworkVersion);
  const current = parseMinor(currentVersion);
  if (!captured) return [`${label}: capture.frameworkVersion "${cap.frameworkVersion}" is not a version`];
  if (!current) return [`${label}: current version "${currentVersion}" is not a version`];
  if (captured.major !== current.major) {
    return [`${label}: captured on v${cap.frameworkVersion}, major differs from current v${currentVersion}`];
  }
  const behind = current.minor - captured.minor;
  if (behind > MAX_MINORS_BEHIND) {
    return [
      `${label}: captured ${cap.capturedAt} on v${cap.frameworkVersion}, ${behind} minors behind v${currentVersion} (max ${MAX_MINORS_BEHIND}); recapture (see wiki/Reference/Docs-Derivation-Audit.md)`,
    ];
  }
  return [];
}
