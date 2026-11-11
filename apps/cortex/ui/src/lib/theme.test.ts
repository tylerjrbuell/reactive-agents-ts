import { describe, expect, test } from "bun:test";
import { parseTheme, resolveTheme, THEME_OPTIONS, toggledTheme } from "./theme.js";

describe("theme setting", () => {
  test("parseTheme keeps the three choices and falls back to dark", () => {
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme(undefined)).toBe("dark");
    expect(parseTheme("sepia")).toBe("dark");
  });

  test("system follows the OS; dark and light are pinned", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  test("the top-bar switch pins the opposite of what is showing", () => {
    expect(toggledTheme("dark")).toBe("light");
    expect(toggledTheme("light")).toBe("dark");
  });

  test("options list system first, in sentence case", () => {
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual(["system", "dark", "light"]);
    expect(THEME_OPTIONS[0]?.label).toBe("Follow the system setting");
  });
});
