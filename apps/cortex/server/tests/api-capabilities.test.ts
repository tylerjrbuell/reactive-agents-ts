import { describe, it, expect } from "bun:test";
import { capabilitiesRouter } from "../api/capabilities.js";

describe("GET /api/capabilities", () => {
  it("returns the framework capability manifest", async () => {
    const res = await capabilitiesRouter.handle(
      new Request("http://localhost/api/capabilities"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      version: string;
      strategies: { name: string }[];
      builderMethods: { name: string }[];
      configFields: { path: string }[];
    };
    expect(body.version).toBeTruthy();
    const strategyNames = body.strategies.map((s) => s.name);
    expect(strategyNames).toContain("blueprint");
    expect(strategyNames).toContain("code-action");
    expect(strategyNames).toContain("direct");
    expect(body.builderMethods.map((b) => b.name)).toContain("withModelRouting");
    expect(body.configFields.some((f) => f.path === "provider")).toBe(true);
  });
});
