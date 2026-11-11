/**
 * Settings · Appearance · Theme (Bench spec section 8, Settings). `system`
 * follows the OS colour scheme; `dark` and `light` pin one. The top-bar
 * switch pins the opposite of what is showing, so it always flips the page.
 */

/** The stored choice. */
export type ThemeSetting = "system" | "dark" | "light";

/** The theme actually painted. */
export type ResolvedTheme = "dark" | "light";

/** The three choices, in display order, with their labels. */
export const THEME_OPTIONS: readonly { readonly value: ThemeSetting; readonly label: string }[] = [
  { value: "system", label: "Follow the system setting" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

/** Read a stored value; anything unknown falls back to `dark` (the shipped default). */
export function parseTheme(value: unknown): ThemeSetting {
  return value === "system" || value === "light" ? value : "dark";
}

/** The theme to paint for a setting, given whether the OS prefers dark. */
export function resolveTheme(setting: ThemeSetting, systemPrefersDark: boolean): ResolvedTheme {
  if (setting === "system") return systemPrefersDark ? "dark" : "light";
  return setting;
}

/** The setting the top-bar switch stores: the opposite of what is showing. */
export function toggledTheme(showing: ResolvedTheme): ThemeSetting {
  return showing === "dark" ? "light" : "dark";
}
