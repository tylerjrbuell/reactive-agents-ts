/**
 * The planning toggles of the harness config (`.withHarness`) as switches. The builder panel keeps
 * the harness as JSON text; these read and write four booleans in that text and leave every other
 * key alone. The defaults shown are the framework's (`HarnessConfig` in the runtime package):
 * Cortex only displays them and writes a key when the user flips it. Pure.
 */

/** One planning switch: the harness key, its words, and the framework's default. */
export interface HarnessToggle {
  readonly key: "planRecon" | "planBudget" | "wrapUpReserve" | "planToolCatalog";
  readonly label: string;
  readonly hint: string;
  /** The framework's default when the key is absent. */
  readonly defaultOn: boolean;
}

/** The toggles, in the order the panel lists them. */
export const HARNESS_PLAN_TOGGLES: readonly HarnessToggle[] = [
  { key: "planRecon", label: "Plan recon", hint: "In Plan mode the model may call read-only tools (a few calls) to look up facts the plan needs. What it learns shows as findings on the plan.", defaultOn: false },
  { key: "planBudget", label: "Plan budget", hint: "A run that starts from a plan gets its iteration limit raised to fit the plan's steps.", defaultOn: false },
  { key: "wrapUpReserve", label: "Wrap-up reserve", hint: "Keep the last iterations for writing the answer once the work is done, instead of another tool call.", defaultOn: false },
  { key: "planToolCatalog", label: "Plan tool catalog", hint: "Plan mode names the tools the execute step will have, so steps can point at them.", defaultOn: true },
];

type Parsed = { readonly ok: true; readonly value: Record<string, unknown> } | { readonly ok: false };

function parse(text: string): Parsed {
  if (text.trim() === "") return { ok: true, value: {} };
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? { ok: true, value: v as Record<string, unknown> } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** True when the harness text can be edited by a switch (blank, or a JSON object). */
export const harnessTextEditable = (text: string): boolean => parse(text).ok;

/** The switch's state: the text's boolean for `toggle.key`, else the framework's default. */
export function harnessToggleOn(text: string, toggle: HarnessToggle): boolean {
  const p = parse(text);
  const v = p.ok ? p.value[toggle.key] : undefined;
  return typeof v === "boolean" ? v : toggle.defaultOn;
}

/**
 * The text with `toggle.key` set to `on`. Other keys keep their order and values. The text is
 * returned unchanged when it is not a JSON object (the panel then asks the user to fix it).
 */
export function setHarnessToggle(text: string, toggle: HarnessToggle, on: boolean): string {
  const p = parse(text);
  if (!p.ok) return text;
  return JSON.stringify({ ...p.value, [toggle.key]: on }, null, 2);
}
