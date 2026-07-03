/**
 * The single machine-readable description of the framework's agent-config
 * surface. Cortex (and any UI) reads this to render controls + validate parity,
 * so new strategies / builder methods / config fields surface automatically.
 * Kept honest by:
 *   - strategy-catalog.test.ts (catalog == registry keys)
 *   - builder-methods.test.ts   (descriptors == builder prototype)
 *   - config-fields.test.ts     (fields from AgentConfigSchema)
 */
import { STRATEGY_CATALOG, type StrategyCatalogEntry } from "@reactive-agents/reasoning";
import { deriveBuilderMethods, type BuilderMethodDescriptor } from "./builder-methods.js";
import { deriveConfigFields, type ConfigFieldDescriptor } from "./config-fields.js";

export type StrategyDescriptor = StrategyCatalogEntry;

export interface CapabilityManifest {
  /** Bumped when the manifest SHAPE changes (not on content changes). */
  readonly version: string;
  readonly strategies: readonly StrategyDescriptor[];
  readonly builderMethods: readonly BuilderMethodDescriptor[];
  readonly configFields: readonly ConfigFieldDescriptor[];
}

const MANIFEST_VERSION = "1";

let cached: CapabilityManifest | null = null;

/** Pure + memoized: the framework's capability surface as data. */
export function getCapabilityManifest(): CapabilityManifest {
  if (cached) return cached;
  cached = {
    version: MANIFEST_VERSION,
    strategies: STRATEGY_CATALOG,
    builderMethods: deriveBuilderMethods(),
    configFields: deriveConfigFields(),
  };
  return cached;
}

export type { BuilderMethodDescriptor, ConfigFieldDescriptor };
