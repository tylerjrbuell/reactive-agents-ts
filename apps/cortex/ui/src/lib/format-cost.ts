/**
 * The one USD formatter for chat cost surfaces (header, drawer, session total, export).
 * Four decimals; a positive amount below the 4th decimal reads "<$0.0001", never "$0.0000".
 * An exact zero is a real, known zero and renders "$0.0000".
 */
export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.0001) return "<$0.0001";
  return `$${usd.toFixed(4)}`;
}
