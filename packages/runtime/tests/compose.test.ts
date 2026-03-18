import { describe, test, expect } from "bun:test";
import { agentFn, pipe, parallel, race } from "../src/compose.js";

// ─── agentFn ─────────────────────────────────────────────────────────────────

describe("agentFn", () => {
  test("creates a callable agent function", async () => {
    const fn = agentFn(
      { name: "test-fn", provider: "test" },
      (b) => b.withTestScenario([{ text: "Hello from agentFn" }]),
    );
    const result = await fn("test input");
    expect(result.output).toContain("Hello from agentFn");
    await fn.dispose();
  });

  test("lazily builds agent on first call", async () => {
    const fn = agentFn(
      { name: "lazy-agent", provider: "test" },
      (b) => b.withTestScenario([{ text: "first call" }]),
    );
    expect(fn.config.name).toBe("lazy-agent");
    const result = await fn("go");
    expect(result.output).toContain("first call");
    await fn.dispose();
  });

  test("dispose cleans up the agent", async () => {
    const fn = agentFn(
      { name: "dispose-agent", provider: "test" },
      (b) => b.withTestScenario([{ text: "ok" }]),
    );
    await fn("go");
    await fn.dispose();
  });

  test("config property exposes the config", () => {
    const fn = agentFn({ name: "config-check", provider: "anthropic" });
    expect(fn.config.name).toBe("config-check");
    expect(fn.config.provider).toBe("anthropic");
  });
});

// ─── pipe ─────────────────────────────────────────────────────────────────────

describe("pipe", () => {
  test("chains two agents sequentially", async () => {
    const first = agentFn(
      { name: "first", provider: "test" },
      (b) => b.withTestScenario([{ text: "step-one-result" }]),
    );
    const second = agentFn(
      { name: "second", provider: "test" },
      (b) => b.withTestScenario([{ text: "final-result" }]),
    );
    const pipeline = pipe(first, second);
    const result = await pipeline("initial input");
    expect(result.output).toContain("final-result");
    await pipeline.dispose();
  });

  test("chains three agents", async () => {
    const a = agentFn(
      { name: "a", provider: "test" },
      (b) => b.withTestScenario([{ text: "from-a" }]),
    );
    const b2 = agentFn(
      { name: "b", provider: "test" },
      (b) => b.withTestScenario([{ text: "from-b" }]),
    );
    const c = agentFn(
      { name: "c", provider: "test" },
      (b) => b.withTestScenario([{ text: "from-c" }]),
    );
    const pipeline = pipe(a, b2, c);
    const result = await pipeline("start");
    expect(result.output).toContain("from-c");
    await pipeline.dispose();
  });

  test("pipe result is itself an AgentFn", async () => {
    const fn = agentFn(
      { name: "single", provider: "test" },
      (b) => b.withTestScenario([{ text: "ok" }]),
    );
    const pipeline = pipe(fn);
    expect(pipeline.config.name).toBe("pipe(single)");
    expect(typeof pipeline.dispose).toBe("function");
    await pipeline.dispose();
  });

  test("pipe result includes composition metadata", async () => {
    const a = agentFn(
      { name: "a", provider: "test" },
      (b) => b.withTestScenario([{ text: "a-output" }]),
    );
    const b2 = agentFn(
      { name: "b", provider: "test" },
      (b) => b.withTestScenario([{ text: "b-output" }]),
    );
    const pipeline = pipe(a, b2);
    const result = await pipeline("start");
    expect((result.metadata as any).compositionType).toBe("pipe");
    expect((result.metadata as any).stages).toBe(2);
    await pipeline.dispose();
  });
});

// ─── parallel ─────────────────────────────────────────────────────────────────

describe("parallel", () => {
  test("runs multiple agents concurrently on same input", async () => {
    const a = agentFn(
      { name: "agent-a", provider: "test" },
      (b) => b.withTestScenario([{ text: "result-a" }]),
    );
    const b2 = agentFn(
      { name: "agent-b", provider: "test" },
      (b) => b.withTestScenario([{ text: "result-b" }]),
    );
    const combined = parallel(a, b2);
    const result = await combined("same input");
    expect(result.success).toBe(true);
    expect(result.output).toContain("result-a");
    expect(result.output).toContain("result-b");
    await combined.dispose();
  });

  test("metadata includes individual results", async () => {
    const a = agentFn(
      { name: "a", provider: "test" },
      (b) => b.withTestScenario([{ text: "alpha" }]),
    );
    const b2 = agentFn(
      { name: "b", provider: "test" },
      (b) => b.withTestScenario([{ text: "beta" }]),
    );
    const combined = parallel(a, b2);
    const result = await combined("go");
    expect(result.metadata?.results).toBeDefined();
    expect((result.metadata!.results as any[]).length).toBe(2);
    await combined.dispose();
  });

  test("parallel result is composable with pipe", async () => {
    const a = agentFn(
      { name: "a", provider: "test" },
      (b) => b.withTestScenario([{ text: "data" }]),
    );
    const b2 = agentFn(
      { name: "b", provider: "test" },
      (b) => b.withTestScenario([{ text: "more data" }]),
    );
    const summarizer = agentFn(
      { name: "summarizer", provider: "test" },
      (b) => b.withTestScenario([{ text: "summary" }]),
    );
    const pipeline = pipe(parallel(a, b2), summarizer);
    const result = await pipeline("start");
    expect(result.output).toContain("summary");
    await pipeline.dispose();
  });

  test("parallel output formats each agent result with label", async () => {
    const a = agentFn(
      { name: "alpha", provider: "test" },
      (b) => b.withTestScenario([{ text: "output-from-alpha" }]),
    );
    const b2 = agentFn(
      { name: "beta", provider: "test" },
      (b) => b.withTestScenario([{ text: "output-from-beta" }]),
    );
    const combined = parallel(a, b2);
    const result = await combined("input");
    expect(result.output).toContain("[alpha]:");
    expect(result.output).toContain("[beta]:");
    await combined.dispose();
  });
});

// ─── race ─────────────────────────────────────────────────────────────────────

describe("race", () => {
  test("returns first result to complete", async () => {
    const fast = agentFn(
      { name: "fast", provider: "test" },
      (b) => b.withTestScenario([{ text: "fast-wins" }]),
    );
    const slow = agentFn(
      { name: "slow", provider: "test" },
      (b) => b.withTestScenario([{ text: "slow-loses" }]),
    );
    const racer = race(fast, slow);
    const result = await racer("go");
    expect(result.success).toBe(true);
    await racer.dispose();
  });

  test("race result is an AgentFn", async () => {
    const a = agentFn(
      { name: "a", provider: "test" },
      (b) => b.withTestScenario([{ text: "ok" }]),
    );
    const racer = race(a);
    expect(racer.config.name).toBe("race(a)");
    expect(typeof racer.dispose).toBe("function");
    await racer.dispose();
  });

  test("race result includes composition metadata", async () => {
    const a = agentFn(
      { name: "a", provider: "test" },
      (b) => b.withTestScenario([{ text: "ok" }]),
    );
    const b2 = agentFn(
      { name: "b", provider: "test" },
      (b) => b.withTestScenario([{ text: "ok too" }]),
    );
    const racer = race(a, b2);
    const result = await racer("go");
    expect((result.metadata as any).compositionType).toBe("race");
    expect((result.metadata as any).candidates).toBe(2);
    await racer.dispose();
  });
});
