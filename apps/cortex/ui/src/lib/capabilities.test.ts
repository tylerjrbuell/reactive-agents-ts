import { describe, it, expect } from "bun:test";
import { loadCapabilities, strategyOptions, type CapabilityManifest } from "./capabilities.js";

const MANIFEST: CapabilityManifest = {
  version: "1",
  strategies: [
    { name: "reactive", aliases: ["react"], label: "ReAct", description: "", multiStep: false },
    { name: "blueprint", aliases: ["rewoo"], label: "Blueprint (ReWOO)", description: "", multiStep: true },
  ],
  builderMethods: [],
  configFields: [],
};

describe("capabilities store", () => {
  it("loads the manifest via injected fetch", async () => {
    const fake = (async () => new Response(JSON.stringify(MANIFEST))) as unknown as typeof fetch;
    const m = await loadCapabilities(fake);
    expect(m.strategies).toHaveLength(2);
  });

  it("throws on non-ok response", async () => {
    const fake = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(loadCapabilities(fake)).rejects.toThrow();
  });

  it("maps strategies to {value,label} options", () => {
    const opts = strategyOptions(MANIFEST);
    expect(opts).toContainEqual({ value: "blueprint", label: "Blueprint (ReWOO)" });
    expect(opts).toContainEqual({ value: "reactive", label: "ReAct" });
  });
});
