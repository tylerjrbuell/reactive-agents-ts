/**
 * tool-disclosure.ts — the public `.withTools({ disclosure })` setting and the
 * ONE precedence rule for how a run's permitted tools are presented.
 *
 * Disclosure and permission are separate axes (skills-and-extension-model
 * spec §12.2): the permitted set decides what MAY run; disclosure decides only
 * how that set is shown. Nothing here widens the permitted set.
 *
 * The public values map onto today's internal modes, with no new mechanism
 * (spec §12.5 F2): `all` → `full`, `index` → `index`, `discover` → `discover`.
 * `hybrid` stays an internal tier default and has no public name.
 *
 * Precedence, highest first (spec §12.7 change 5):
 *   1. `.withTools({ disclosure })`
 *   2. the deprecated `.withHarness({ lazyDisclosure, toolDiscovery, toolIndex })`
 *      switches, then the `RA_LAZY_TOOLS` / `RA_TOOL_DISCOVERY` / `RA_TOOL_INDEX`
 *      env flags
 *   3. `contextProfile.toolDisclosureMode`
 *   4. the tier default
 * The winner and its source are recorded on `run-started.config.disclosure`.
 */
import { fromDisclosureMode } from "@reactive-agents/reasoning";
import type { HarnessConfig, ResolvedHarness, ToolDisclosureMode } from "@reactive-agents/reasoning";
import type { ReactiveAgentsConfig } from "../types.js";

/** Public disclosure setting for `.withTools({ disclosure })`. */
export type ToolDisclosure = "all" | "index" | "discover";

/** Every valid {@link ToolDisclosure} value, for runtime validation of untyped callers. */
export const TOOL_DISCLOSURE_VALUES: readonly ToolDisclosure[] = ["all", "index", "discover"];

/** Type guard: `value` is a valid {@link ToolDisclosure}. */
export const isToolDisclosure = (value: unknown): value is ToolDisclosure =>
  typeof value === "string" && (TOOL_DISCLOSURE_VALUES as readonly string[]).includes(value);

/** The internal mode each public value maps onto. */
const INTERNAL_MODE: Readonly<Record<ToolDisclosure, ToolDisclosureMode>> = {
  all: "full",
  index: "index",
  discover: "discover",
};

/** The layer that decided a run's disclosure. */
export type DisclosureSource = "withTools" | "harness" | "env" | "profile" | "tier";

/**
 * The resolved disclosure of a run. `mode` uses the public names; `hybrid` is
 * the internal mid-tier default, and `custom` is a switch combination a caller
 * built from the deprecated switches that matches no named mode.
 */
export interface ResolvedDisclosure {
  readonly mode: ToolDisclosure | "hybrid" | "custom";
  readonly source: DisclosureSource;
}

const DISCLOSURE_SWITCHES = ["lazyDisclosure", "toolDiscovery", "toolIndex"] as const;
const DISCLOSURE_ENV_FLAGS = ["RA_LAZY_TOOLS", "RA_TOOL_DISCOVERY", "RA_TOOL_INDEX"] as const;

/**
 * The harness config a run resolves with: the caller's `.withHarness()` config,
 * with `.withTools({ disclosure })` expanded over its three disclosure switches.
 * Every switch is set explicitly, so neither `.withHarness` nor an env flag can
 * leak through. Unset disclosure returns the caller's config object unchanged,
 * so the envelope is byte-identical to one built without this setting.
 */
export function disclosureHarness(config: ReactiveAgentsConfig): HarnessConfig | undefined {
  const harness = config.reasoningOptions?.harness;
  if (config.toolDisclosure === undefined) return harness;
  return { ...harness, ...fromDisclosureMode(INTERNAL_MODE[config.toolDisclosure]) };
}

/** Name the resolved switch combination in public terms. */
function modeOf(h: Pick<ResolvedHarness, "lazyDisclosure" | "toolDiscovery" | "toolIndex">): ResolvedDisclosure["mode"] {
  if (!h.lazyDisclosure) return "all";
  if (h.toolIndex && h.toolDiscovery) return "hybrid";
  if (h.toolIndex) return "index";
  if (h.toolDiscovery) return "discover";
  return "custom";
}

/**
 * Report which layer decided the run's disclosure and the mode it resolved to.
 * `resolved` is the harness the run actually resolved (via
 * {@link disclosureHarness}); `env` is the process environment it read.
 * Pure apart from its arguments.
 */
export function resolveDisclosure(
  config: ReactiveAgentsConfig,
  resolved: Pick<ResolvedHarness, "lazyDisclosure" | "toolDiscovery" | "toolIndex">,
  env: NodeJS.ProcessEnv,
): ResolvedDisclosure {
  if (config.toolDisclosure !== undefined) return { mode: config.toolDisclosure, source: "withTools" };
  const mode = modeOf(resolved);
  const harness = config.reasoningOptions?.harness;
  if (DISCLOSURE_SWITCHES.some((k) => harness?.[k] !== undefined)) return { mode, source: "harness" };
  if (DISCLOSURE_ENV_FLAGS.some((k) => (env[k] ?? "") !== "")) return { mode, source: "env" };
  if (config.contextProfile?.toolDisclosureMode !== undefined) return { mode, source: "profile" };
  return { mode, source: "tier" };
}
