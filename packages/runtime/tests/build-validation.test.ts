import { describe, test, expect, afterEach } from "bun:test";
import { ReactiveAgents } from "../src";

describe("Build-time validation", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in originalEnv)) delete process.env[k];
    });
    Object.assign(process.env, originalEnv);
  });

  test("warns on missing API key for anthropic provider", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    const agent = await ReactiveAgents.create().withProvider("anthropic").build();

    console.warn = origWarn;
    await agent.dispose();
    expect(warnings.some((w) => w.includes("ANTHROPIC_API_KEY"))).toBe(true);
  });

  test("throws on missing API key with strict validation", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(
      ReactiveAgents.create().withProvider("anthropic").withStrictValidation().build(),
    ).rejects.toThrow("ANTHROPIC_API_KEY");
  });

  test("skips API key check for ollama provider", async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    const agent = await ReactiveAgents.create().withProvider("ollama").build();

    console.warn = origWarn;
    await agent.dispose();
    expect(warnings.some((w) => w.includes("API_KEY"))).toBe(false);
  });

  test("skips validation for test provider", async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    const agent = await ReactiveAgents.create().withProvider("test").build();

    console.warn = origWarn;
    await agent.dispose();
    expect(warnings.some((w) => w.includes("API_KEY"))).toBe(false);
  });

  test("warns on model/provider mismatch", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    const agent = await ReactiveAgents.create()
      .withProvider("anthropic")
      .withModel("gpt-4o")
      .build();

    console.warn = origWarn;
    await agent.dispose();
    expect(warnings.some((w) => w.includes("gpt-4o") && w.includes("anthropic"))).toBe(true);
  });

  test("logs resolved provider info on build", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test123";
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => {
      if (typeof msg === "string") logs.push(msg);
    };

    const agent = await ReactiveAgents.create().withProvider("anthropic").build();

    console.log = origLog;
    await agent.dispose();
    expect(logs.some((l) => l.includes("Provider:") && l.includes("anthropic"))).toBe(true);
  });
});
