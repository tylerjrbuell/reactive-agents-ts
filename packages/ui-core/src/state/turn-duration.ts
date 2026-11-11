/**
 * How long a run took, in the form a chat shows it: `12s`, `2m 05s`, `1h 02m`.
 * Negative or non-finite input reads as `0s`. Pure.
 */
export function formatTurnDuration(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
  if (total < 60) return `${total}s`;
  const pad = (n: number): string => String(n).padStart(2, "0");
  const m = Math.floor(total / 60);
  if (m < 60) return `${m}m ${pad(total % 60)}s`;
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}
