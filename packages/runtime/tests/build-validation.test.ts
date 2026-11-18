import { describe, test, expect, afterEach } from "bun:test";
import { ReactiveAgents } from "../src";
import { validateProviderConnection, logBuildInfo } from "../src/build-validation";
import { withStdoutTTY } from "./_helpers-tty.js";

describe("Build-time validation", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in originalEnv)) delete process.env[k];
    });
    Object.assign(process.env, originalEnv);
  });

  test("warns (does NOT throw) on missing API key by default", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    // Default is backward-compatible warn-then-succeed so the common
    // "build to inspect config" pattern and keyless CI runs keep working.
    const agent = await ReactiveAgents.create().withProvider("anthropic").build();

    console.warn = origWarn;
    await agent.dispose();
    expect(warnings.some((w) => w.includes("ANTHROPIC_API_KEY"))).toBe(true);
  });

  test("under strict, missing-key error carries fix instructions and is a typed BuildValidationError", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { BuildValidationError } = await import("../src/build-validation");
    let caught: unknown;
    try {
      await ReactiveAgents.create().withProvider("anthropic").withStrictValidation().build();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BuildValidationError);
    expect((caught as Error).message).toContain("ANTHROPIC_API_KEY");
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
    // Ollama doesn't require an API key. The endpoint is pinned to a closed
    // port so the test never reaches a real local Ollama: the build must fail
    // on the connection pre-flight, NOT on an API key check.
    const savedEndpoint = process.env.OLLAMA_ENDPOINT;
    process.env.OLLAMA_ENDPOINT = "http://127.0.0.1:1";
    try {
      await expect(ReactiveAgents.create().withProvider("ollama").build()).rejects.toThrow(
        /Cannot connect to Ollama|Provider connection failed/,
      );
    } finally {
      if (savedEndpoint === undefined) delete process.env.OLLAMA_ENDPOINT;
      else process.env.OLLAMA_ENDPOINT = savedEndpoint;
    }
  });

  test("logBuildInfo never prints an API key prefix or substring (FF-1)", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-super-secret-value-12345";
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);
    try {
      logBuildInfo("anthropic", "claude-sonnet-4-6", undefined, { stdoutIsTTY: () => true });
    } finally {
      console.log = origLog;
    }
    expect(lines.length).toBe(1);
    expect(lines[0]).not.toContain("sk-ant");
    expect(lines[0]).not.toContain(process.env.ANTHROPIC_API_KEY!.slice(0, 8));
    expect(lines[0]).toContain("(set)");
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

  test("under strict, fails fast on unknown-for-provider model", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    await expect(
      ReactiveAgents.create().withProvider("anthropic").withModel("gpt-4o").withStrictValidation().build(),
    ).rejects.toThrow(/gpt-4o[\s\S]*anthropic/);
  });

  test("warns (does NOT throw) on unknown-for-provider model by default", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    const agent = await ReactiveAgents.create().withProvider("anthropic").withModel("gpt-4o").build();

    console.warn = origWarn;
    await agent.dispose();
    expect(warnings.some((w) => w.includes("gpt-4o") && w.includes("anthropic"))).toBe(true);
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

  test("logs resolved provider info on build (terminal stdout)", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test123";
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => {
      if (typeof msg === "string") logs.push(msg);
    };

    // A piped stdout stays quiet (tests/quiet-first-run-output.test.ts).
    const agent = await withStdoutTTY(true, () => ReactiveAgents.create().withProvider("anthropic").build());

    console.log = origLog;
    await agent.dispose();
    expect(logs.some((l) => l.includes("Provider:") && l.includes("anthropic"))).toBe(true);
  });
});
