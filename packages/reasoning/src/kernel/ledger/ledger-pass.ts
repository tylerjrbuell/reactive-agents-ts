/**
 * Which pass of a run produced an entry. A sub-agent's whole ledger merges under
 * `sub-agent:<name>`, so a parent can see what a child actually did rather than
 * a summary string.
 *
 * Leaf module — extracted from run-scope.ts so run-ledger.ts (which needs the
 * type for `LedgerEntry.pass`) doesn't import the module that itself imports
 * run-ledger.ts (`LedgerEntry`, `RunLedger`, `appendEntries`).
 */
export type LedgerPass =
  | "verification-retry"
  | "continuation"
  | `sub-agent:${string}`;
