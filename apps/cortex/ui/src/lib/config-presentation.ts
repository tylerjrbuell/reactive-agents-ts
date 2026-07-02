/**
 * UI polish layer over the framework manifest. The manifest guarantees a field
 * EXISTS; this map decides how it LOOKS. Anything not here renders with a default
 * widget inferred from its type — so a NEW framework field appears automatically
 * (functional but plain) instead of vanishing. The manifest-coverage guard
 * (manifest-coverage.test.ts) surfaces fields with neither a hint nor an
 * intentional default so they get styled over time.
 */
import type { ConfigFieldDescriptor } from "./capabilities.js";

export type Widget =
  | "toggle"
  | "slider"
  | "select"
  | "text"
  | "textarea"
  | "number"
  | "tag-input"
  | "custom";

export interface PresentationHint {
  group: string;
  label: string;
  widget: Widget;
  order: number;
  /** Conditional visibility given the current config object. */
  showIf?: (cfg: Record<string, unknown>) => boolean;
  help?: string;
}

/** Keyed by config-field path OR builder-method name (for overlay controls). */
export const PRESENTATION: Readonly<Record<string, PresentationHint>> = {
  provider: { group: "Model", label: "Provider", widget: "select", order: 10 },
  model: { group: "Model", label: "Model", widget: "select", order: 20 },
  temperature: { group: "Model", label: "Temperature", widget: "slider", order: 30 },
  maxTokens: { group: "Model", label: "Max tokens", widget: "number", order: 40 },
  numCtx: { group: "Model", label: "Context window (num_ctx)", widget: "number", order: 50 },

  "reasoning.defaultStrategy": { group: "Reasoning", label: "Strategy", widget: "select", order: 10 },
  systemPrompt: { group: "Reasoning", label: "System prompt", widget: "textarea", order: 20 },
  "reasoning.enableStrategySwitching": { group: "Reasoning", label: "Strategy switching", widget: "toggle", order: 30 },

  "execution.maxIterations": { group: "Execution", label: "Max iterations", widget: "number", order: 10 },
  "execution.minIterations": { group: "Execution", label: "Min iterations", widget: "number", order: 20 },
  "execution.timeoutMs": { group: "Execution", label: "Timeout (ms)", widget: "number", order: 30 },

  // Overlay builder methods keyed by method name (rendered from builderMethods):
  withModelRouting: {
    group: "Model",
    label: "Cost-aware model routing",
    widget: "custom",
    order: 60,
    help: "Route each run to the cheapest capable tier (haiku/sonnet/opus).",
  },
};

/** Paths intentionally left to the default widget (acknowledged, not forgotten). */
export const INTENTIONAL_DEFAULTS: ReadonlySet<string> = new Set<string>([]);

const DEFAULT_WIDGET: Record<ConfigFieldDescriptor["type"], Widget> = {
  boolean: "toggle",
  number: "number",
  string: "text",
  enum: "select",
  array: "tag-input",
  object: "custom",
  unknown: "text",
};

/** Return the explicit hint for a field, or a type-appropriate default. */
export function hintFor(descriptor: ConfigFieldDescriptor): PresentationHint {
  const explicit = PRESENTATION[descriptor.path];
  if (explicit) return explicit;
  return {
    group: "More",
    label: descriptor.path.split(".").slice(-1)[0] ?? descriptor.path,
    widget: DEFAULT_WIDGET[descriptor.type],
    order: 999,
    ...(descriptor.description ? { help: descriptor.description } : {}),
  };
}
