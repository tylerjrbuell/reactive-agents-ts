import { describe, it, expect } from "bun:test";
import { getCapabilityManifest } from "../src/capability/manifest.js";

describe("getCapabilityManifest", () => {
  it("assembles strategies + builderMethods + configFields", () => {
    const m = getCapabilityManifest();
    expect(m.version).toBeTruthy();
    expect(m.strategies.some((s) => s.name === "blueprint")).toBe(true);
    expect(m.strategies.some((s) => s.name === "code-action")).toBe(true);
    expect(m.strategies.some((s) => s.name === "direct")).toBe(true);
    expect(m.builderMethods.some((b) => b.name === "withModelRouting")).toBe(true);
    expect(m.configFields.some((f) => f.path === "provider")).toBe(true);
  });

  it("is stable across calls (memoized/pure)", () => {
    expect(getCapabilityManifest()).toBe(getCapabilityManifest());
  });

  it("every config-kind builder method points at a real config field (or parent)", () => {
    const m = getCapabilityManifest();
    const paths = new Set(m.configFields.map((f) => f.path));
    for (const bm of m.builderMethods.filter((b) => b.kind === "config" && b.configPath)) {
      const p = bm.configPath!;
      const ok = paths.has(p) || [...paths].some((x) => x.startsWith(p + "."));
      expect(ok, `builder ${bm.name} configPath '${p}' not in configFields`).toBe(true);
    }
  });
});
