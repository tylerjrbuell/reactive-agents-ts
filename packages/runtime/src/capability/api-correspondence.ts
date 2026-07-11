/**
 * The wither ↔ config-key correspondence — the JOIN that makes the dual API
 * self-maintaining (spec §3.3).
 *
 * `deriveBuilderMethods()` (the fluent surface) and `deriveConfigFields()` (the
 * declarative surface, derived from `AgentConfigSchema`) are the two projections
 * of the single source. This module joins them so BOTH doc pages render from one
 * table and the drift-gate (`api-correspondence.test.ts`) can assert:
 *   (a) every declared `configKey` resolves to a real schema leaf, and
 *   (b) every non-plumbing schema leaf is reachable by ≥1 wither OR createAgent.
 */
import { deriveBuilderMethods } from "./builder-methods.js";
import { deriveConfigFields } from "./config-fields.js";

export interface CorrespondenceRow {
  /** Builder method name. */
  readonly wither: string;
  /** AgentConfig key(s) it sets (exact leaf or subtree prefix); empty for overlays. */
  readonly configKeys: readonly string[];
  /** True when kind === "overlay" (code-only, no config home). */
  readonly overlay: boolean;
  /** Reason a method is overlay-only (recorded). */
  readonly reason?: string;
  /** Any declared configKey that does NOT resolve against the schema (drift signal a). */
  readonly orphanKeys: readonly string[];
}

/**
 * Schema leaves that are intentionally settable ONLY via the declarative
 * `createAgent(config)` surface (no fluent wither). Empty today — every schema
 * leaf is reachable by a wither. Add a key here (with justification) if a future
 * field is declarative-only; the drift-gate (b) then accepts it as non-orphan.
 */
export const CONFIG_ONLY_KEYS: ReadonlySet<string> = new Set<string>([]);

/**
 * A declared `configKey` resolves iff it is an exact schema leaf OR a prefix of
 * ≥1 leaf (a subtree root like `memory` covering every `memory.*` leaf).
 */
export function keyResolves(key: string, leafPaths: ReadonlySet<string>): boolean {
  if (leafPaths.has(key)) return true;
  const prefix = `${key}.`;
  for (const p of leafPaths) if (p.startsWith(prefix)) return true;
  return false;
}

/** A schema leaf is covered iff some configKey is an exact match or a prefix of it. */
export function leafCovered(leaf: string, configKeys: ReadonlySet<string>): boolean {
  if (configKeys.has(leaf)) return true;
  // Walk ancestor prefixes: "observability.logging.level" → "observability.logging", "observability".
  const parts = leaf.split(".");
  for (let i = parts.length - 1; i >= 1; i--) {
    if (configKeys.has(parts.slice(0, i).join("."))) return true;
  }
  return false;
}

/** Join the fluent + declarative projections into the correspondence table. */
export function deriveCorrespondence(): CorrespondenceRow[] {
  const withers = deriveBuilderMethods();
  const leafPaths = new Set(deriveConfigFields().map((f) => f.path));

  return withers.map((w) => {
    const configKeys = w.configKeys ?? [];
    const orphanKeys = configKeys.filter((k) => !keyResolves(k, leafPaths));
    return {
      wither: w.name,
      configKeys,
      overlay: w.kind === "overlay",
      ...(w.overlayReason ? { reason: w.overlayReason } : {}),
      orphanKeys,
    };
  });
}

/**
 * The set of every schema leaf covered by ≥1 wither's configKeys. Used by the
 * drift-gate (b) and the docs generator.
 */
export function coveredLeaves(): Set<string> {
  const rows = deriveCorrespondence();
  const configKeys = new Set<string>();
  for (const r of rows) for (const k of r.configKeys) configKeys.add(k);

  const covered = new Set<string>();
  for (const f of deriveConfigFields()) {
    if (leafCovered(f.path, configKeys)) covered.add(f.path);
  }
  return covered;
}

/**
 * Schema leaves reachable by neither a wither nor the declarative-only escape
 * set. A non-empty result means the two APIs are not equipotent (drift-gate b).
 */
export function orphanLeaves(): string[] {
  const covered = coveredLeaves();
  return deriveConfigFields()
    .map((f) => f.path)
    .filter((p) => !covered.has(p) && !CONFIG_ONLY_KEYS.has(p))
    .sort();
}

/** Correspondence coverage summary (reported by CI / the docs generator). */
export function correspondenceCoverage(): {
  readonly withers: number;
  readonly configWithers: number;
  readonly overlayWithers: number;
  readonly schemaLeaves: number;
  readonly coveredLeaves: number;
  readonly orphanLeaves: readonly string[];
  readonly orphanKeys: readonly { wither: string; key: string }[];
} {
  const rows = deriveCorrespondence();
  const orphanKeys = rows.flatMap((r) =>
    r.orphanKeys.map((key) => ({ wither: r.wither, key })),
  );
  const leaves = deriveConfigFields().length;
  const covered = coveredLeaves().size;
  return {
    withers: rows.length,
    configWithers: rows.filter((r) => !r.overlay).length,
    overlayWithers: rows.filter((r) => r.overlay).length,
    schemaLeaves: leaves,
    coveredLeaves: covered,
    orphanLeaves: orphanLeaves(),
    orphanKeys,
  };
}
