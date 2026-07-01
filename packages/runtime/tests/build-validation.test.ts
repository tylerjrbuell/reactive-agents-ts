import { describe, test, expect, afterEach } from "bun:test";
import { ReactiveAgents } from "../src";
import { validateProviderConnection } from "../src/build-validation";

describe("Build-time validation", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in originalEnv)) delete process.env[k];
    });
    Object.assign(process.env, originalEnv);
  });

  test("fails fast (throws) on missing API key for anthropic provider by default", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(
      ReactiveAgents.create().withProvider("anthropic").build(),
    ).rejects.toThrow("ANTHROPIC_API_KEY");
  });

  test("missing-key error carries fix instructions and is a typed BuildValidationError", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { BuildValidationError } = await import("../src/build-validation");
    let caught: unknown;
    try {
      await ReactiveAgents.create().withProvider("anthropic").build();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BuildValidationError);
    expect((caught as Error).message).toContain("withLazyValidation");
    expect((caught as { failures: readonly string[] }).failures.length).toBeGreaterThan(0);
  });

  test("withLazyValidation restores warn-then-succeed on missing API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    const agent = await ReactiveAgents.create()
      .withProvider("anthropic")
      .withLazyValidation()
      .build();

    console.warn = origWarn;
    await agent.dispose();
    expect(warnings.some((w) => w.includes("ANTHROPIC_API_KEY"))).toBe(true);
  });

  test("REACTIVE_AGENTS_LAZY_VALIDATION=1 env also restores lazy behavior", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.REACTIVE_AGENTS_LAZY_VALIDATION = "1";
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
    // Ollama doesn't require an API key. Build succeeds if Ollama is running,
    // or throws a connection error if it isn't — either outcome is correct.
    try {
      const agent = await ReactiveAgents.create().withProvider("ollama").build();
      // Ollama is running — no API key error should have occurred
      await agent.dispose();
    } catch (e: any) {
      // Ollama is not running — should be a connection error, NOT an API key error
      expect(e.message).toMatch(/Cannot connect to Ollama|Provider connection failed/);
    }
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

  test("fails fast on unknown-for-provider model by default", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    await expect(
      ReactiveAgents.create().withProvider("anthropic").withModel("gpt-4o").build(),
    ).rejects.toThrow(/gpt-4o[\s\S]*anthropic/);
  });

  test("withLazyValidation demotes model/provider mismatch to a warning", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    const agent = await ReactiveAgents.create()
      .withProvider("anthropic")
      .withModel("gpt-4o")
      .withLazyValidation()
      .build();

    console.warn = origWarn;
    await agent.dispose();
    expect(warnings.some((w) => w.includes("gpt-4o") && w.includes("anthropic"))).toBe(true);
  });

  test("ollama connection check fails when service is unreachable", async () => {
    const result = await validateProviderConnection("ollama", "http://localhost:19999");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Cannot connect to Ollama");
    expect(result.error).toContain("ollama serve");
  });

  test("connection check passes for non-local providers", async () => {
    const result = await validateProviderConnection("anthropic");
    expect(result.ok).toBe(true);
  });

  test("connection check passes for test provider", async () => {
    const result = await validateProviderConnection("test");
    expect(result.ok).toBe(true);
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
