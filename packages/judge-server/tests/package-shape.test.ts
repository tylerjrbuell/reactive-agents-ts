// Run: bun test packages/judge-server/tests/package-shape.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import pkg from "../package.json" with { type: "json" };

describe("judge-server package shape", () => {
  it("declares the @reactive-agents/judge-server name", () => {
    expect(pkg.name).toBe("@reactive-agents/judge-server");
  }, 15000);

  it("declares engines.bun >=1.1.0 (consistent with workspace)", () => {
    expect(pkg.engines?.bun).toMatch(/^>=1\.1/);
  }, 15000);

  it("depends on @reactive-agents/eval (judge service source)", () => {
    expect(pkg.dependencies).toHaveProperty("@reactive-agents/eval");
  }, 15000);

  it("depends on effect (Effect-TS)", () => {
    expect(pkg.dependencies).toHaveProperty("effect");
  }, 15000);

  it("has a 'start' script that runs src/index.ts", () => {
    expect(pkg.scripts?.start).toMatch(/bun (run )?src\/index\.ts/);
  }, 15000);
});
