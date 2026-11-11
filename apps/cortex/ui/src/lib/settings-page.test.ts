import { describe, expect, test } from "bun:test";
import { keyBadgesOf, keyEnvOf, savePatchOf, SETTINGS_SECTIONS } from "./settings-page.js";
import { DEFAULTS } from "./stores/settings.js";

describe("settings page", () => {
  test("sections follow the mockup order, with Appearance and About", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      "Defaults",
      "Providers",
      "Notifications",
      "Appearance",
      "Storage",
      "Developer",
      "About",
    ]);
  });

  test("key badges: found keys first, missing ones say so, unreported ones are left out", () => {
    expect(keyBadgesOf({ anthropic: "missing", openai: "ok" })).toEqual([
      { key: "openai", tone: "ok", text: "OpenAI" },
      { key: "anthropic", tone: "bad", text: "Anthropic missing" },
    ]);
    expect(keyBadgesOf({})).toEqual([]);
  });

  test("keyEnvOf names the variable for keyed providers only", () => {
    expect(keyEnvOf("anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(keyEnvOf("ollama")).toBeUndefined();
  });

  test("Save never writes Appearance (theme, motion apply at once)", () => {
    const patch = savePatchOf({ ...DEFAULTS, theme: "light", motion: "reduce", defaultModel: "m" });
    expect("theme" in patch).toBe(false);
    expect("motion" in patch).toBe(false);
    expect(patch.defaultModel).toBe("m");
  });
});
