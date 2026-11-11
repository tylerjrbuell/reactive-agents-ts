/**
 * Settings page rules (Bench spec section 8, Settings): the section nav, the
 * API key badges and what the Save button writes. Rendering lives in
 * `routes/settings/+page.svelte`.
 */
import type { CortexSettings } from "./stores/settings.js";

/** One entry of the Settings section nav; `id` is the section's element id. */
export interface SettingsSection {
  readonly id: string;
  readonly label: string;
}

/** The Settings sections, in page order. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "defaults", label: "Defaults" },
  { id: "providers", label: "Providers" },
  { id: "notifications", label: "Notifications" },
  { id: "appearance", label: "Appearance" },
  { id: "storage", label: "Storage" },
  { id: "developer", label: "Developer" },
  { id: "about", label: "About" },
];

/** The cloud providers whose keys `GET /api/health/providers` reports, with their env variable. */
export const KEYED_PROVIDERS: readonly { readonly key: string; readonly label: string; readonly env: string }[] = [
  { key: "anthropic", label: "Anthropic", env: "ANTHROPIC_API_KEY" },
  { key: "openai", label: "OpenAI", env: "OPENAI_API_KEY" },
  { key: "gemini", label: "Gemini", env: "GEMINI_API_KEY" },
];

/** One key badge: the provider, whether its key was found, and the badge text. */
export interface KeyBadge {
  readonly key: string;
  readonly tone: "ok" | "bad";
  readonly text: string;
}

/**
 * Badges for the providers the server reported, found keys first. A provider
 * the server did not report is left out (no claim either way).
 */
export function keyBadgesOf(health: Readonly<Record<string, string>>): KeyBadge[] {
  const badges: KeyBadge[] = [];
  for (const p of KEYED_PROVIDERS) {
    const status = health[p.key];
    if (status === "ok") badges.push({ key: p.key, tone: "ok", text: p.label });
    else if (status === "missing") badges.push({ key: p.key, tone: "bad", text: `${p.label} missing` });
  }
  return badges.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "ok" ? -1 : 1));
}

/** The env variable that holds a provider's key, when Cortex knows it. */
export function keyEnvOf(provider: string): string | undefined {
  return KEYED_PROVIDERS.find((p) => p.key === provider)?.env;
}

/** Settings · Appearance keys: they apply at once, so Save never writes them. */
export type AppearanceKey = "theme" | "motion";

/**
 * What Save writes: the form without the Appearance keys. Theme and Motion are
 * saved the moment they change (and the top-bar switch writes the theme too),
 * so a form opened earlier must not write a stale copy back over them.
 */
export function savePatchOf(form: CortexSettings): Omit<CortexSettings, AppearanceKey> {
  const { theme: _theme, motion: _motion, ...rest } = form;
  return rest;
}
