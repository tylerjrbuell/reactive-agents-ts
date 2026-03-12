import { describe, test, expect } from "bun:test";
import { ReactiveAgents } from "../src";

describe("Memory tier naming", () => {
  test("withMemory() with no args defaults to standard tier", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withMemory()
      .build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  test("withMemory({ tier: 'standard' }) works", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withMemory({ tier: "standard" })
      .build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  test("withMemory('1') emits deprecation warning", async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => { if (typeof msg === "string") warnings.push(msg); };

    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withMemory("1")
      .build();

    console.warn = origWarn;
    await agent.dispose();
    expect(warnings.some((w) => w.includes("deprecated"))).toBe(true);
  });

  test("withMemory('2') emits deprecation warning mentioning enhanced", async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => { if (typeof msg === "string") warnings.push(msg); };

    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withMemory("2")
      .build();

    console.warn = origWarn;
    await agent.dispose();
    expect(warnings.some((w) => w.includes("deprecated") && w.includes("enhanced"))).toBe(true);
  });
});
