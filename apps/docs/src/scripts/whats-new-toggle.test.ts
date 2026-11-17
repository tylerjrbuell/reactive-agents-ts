// Run: bun run repo test apps/docs/src/scripts/whats-new-toggle.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyWhatsNewPref,
  readWhatsNewPref,
  syncSwitch,
  WHATS_NEW_ATTR,
  WHATS_NEW_STORAGE_KEY,
  writeWhatsNewPref,
} from "./whats-new-toggle.js";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const throwing = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: (): void => {
    throw new Error("blocked");
  },
};

describe("whats-new toggle", () => {
  it("defaults ON, persists OFF, and round-trips", () => {
    const s = memory();
    expect(readWhatsNewPref(s)).toBe(true);
    writeWhatsNewPref(s, false);
    expect(readWhatsNewPref(s)).toBe(false);
    writeWhatsNewPref(s, true);
    expect(readWhatsNewPref(s)).toBe(true);
  });

  it("survives blocked or missing storage", () => {
    expect(readWhatsNewPref(throwing)).toBe(true);
    expect(() => writeWhatsNewPref(throwing, false)).not.toThrow();
    expect(readWhatsNewPref(undefined)).toBe(true);
  });

  it("sets and clears the html attribute", () => {
    const attrs = new Map<string, string>();
    const root = { setAttribute: (n: string, v: string) => void attrs.set(n, v), removeAttribute: (n: string) => void attrs.delete(n) };
    applyWhatsNewPref(root, false);
    expect(attrs.get(WHATS_NEW_ATTR)).toBe("off");
    applyWhatsNewPref(root, true);
    expect(attrs.has(WHATS_NEW_ATTR)).toBe(false);
  });

  it("keeps aria-checked in sync", () => {
    const attrs = new Map<string, string>();
    syncSwitch({ setAttribute: (n, v) => void attrs.set(n, v) }, false);
    expect(attrs.get("aria-checked")).toBe("false");
  });

  it("the inline head script in astro.config uses the same key and attribute", () => {
    const cfg = readFileSync(join(import.meta.dir, "../../astro.config.mjs"), "utf8");
    expect(cfg).toContain(`localStorage.getItem('${WHATS_NEW_STORAGE_KEY}')==='off'`);
    expect(cfg).toContain(`setAttribute('${WHATS_NEW_ATTR}','off')`);
  });

  it("CSS hides markers only, never stability tags", () => {
    const css = readFileSync(join(import.meta.dir, "../styles/custom.css"), "utf8");
    const rule = css.match(/html\[data-ra-whats-new='off'\][^{]*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toContain(".ra-ind-marker");
    expect(rule).not.toContain("ra-ind-stability");
  });
});
