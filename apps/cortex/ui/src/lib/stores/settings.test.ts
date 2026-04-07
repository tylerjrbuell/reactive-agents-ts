import { describe, it, expect } from "bun:test";
import { DEFAULTS, type CortexSettings } from "./settings.js";

describe("CortexSettings", () => {
  it("DEFAULTS includes theme for layout / persisted UI preference", () => {
    expect(DEFAULTS.theme === "dark" || DEFAULTS.theme === "light").toBe(true);
  });

  it("CortexSettings type includes theme (compile-time shape for +layout applyTheme)", () => {
    const row: CortexSettings = { ...DEFAULTS };
    expect(row.theme).toBe(DEFAULTS.theme);
  });

  it("DEFAULTS includes ollamaEndpoint for ChatSessionList / Ollama model fetch", () => {
    expect(typeof DEFAULTS.ollamaEndpoint).toBe("string");
  });

  it("DEFAULTS enables UI tooltips (opt-out in settings)", () => {
    expect(DEFAULTS.tooltipsEnabled).toBe(true);
  });
});
