import { describe, test, expect, beforeEach } from "bun:test";
import { Effect } from "effect";
import { createMockLLM, createMockLLMFromMap } from "../src/mocks/llm.js";
import { createMockToolService } from "../src/mocks/tools.js";
import { createMockEventBus } from "../src/mocks/event-bus.js";

// ─── MockLLM ────────────────────────────────────────────────────────────────

describe("createMockLLM", () => {
  test("matches rules in order — first match wins", async () => {
    const mock = createMockLLM([
      { match: "hello", response: "first match" },
      { match: "hello", response: "second match" },
    ]);

    const result = await Effect.runPromise(
      mock.service.complete({
        messages: [{ role: "user", content: "hello world" }],
      }),
    );

    expect(result.content).toBe("first match");
  });

  test("matches with regex", async () => {
    const mock = createMockLLM([
      { match: /capital.*France/i, response: "Paris" },
    ]);

    const result = await Effect.runPromise(
      mock.service.complete({
        messages: [{ role: "user", content: "What is the capital of France?" }],
      }),
    );

    expect(result.content).toBe("Paris");
  });

  test("falls through to default when no rule matches", async () => {
    const mock = createMockLLM([
      { match: "specific-pattern", response: "matched" },
    ]);

    const result = await Effect.runPromise(
      mock.service.complete({
        messages: [{ role: "user", content: "unrelated input" }],
      }),
    );

    expect(result.content).toBe("FINAL ANSWER: mock response");
  });

  test("tracks call count", async () => {
    const mock = createMockLLM([]);

    expect(mock.callCount).toBe(0);

    await Effect.runPromise(
      mock.service.complete({
        messages: [{ role: "user", content: "first" }],
      }),
    );
    expect(mock.callCount).toBe(1);

    await Effect.runPromise(
      mock.service.complete({
        messages: [{ role: "user", content: "second" }],
      }),
    );
    expect(mock.callCount).toBe(2);
  });

  test("tracks call messages and responses", async () => {
    const mock = createMockLLM([
      { match: "greeting", response: "Hello!" },
    ]);

    await Effect.runPromise(
      mock.service.complete({
        messages: [{ role: "user", content: "greeting" }],
      }),
    );

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].response).toBe("Hello!");
  });

  test("reset clears calls", async () => {
    const mock = createMockLLM([]);

    await Effect.runPromise(
      mock.service.complete({
        messages: [{ role: "user", content: "test" }],
      }),
    );
    expect(mock.callCount).toBe(1);

    mock.reset();
    expect(mock.callCount).toBe(0);
    expect(mock.calls).toHaveLength(0);
  });

  test("embed returns zero vectors", async () => {
    const mock = createMockLLM([]);
    const vectors = await Effect.runPromise(
      mock.service.embed(["hello", "world"]),
    );

    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(768);
    expect(vectors[0][0]).toBe(0);
  });

  test("uses custom token count from rule", async () => {
    const mock = createMockLLM([
      { match: "test", response: "response", tokens: 42 },
    ]);

    const result = await Effect.runPromise(
      mock.service.complete({
        messages: [{ role: "user", content: "test" }],
      }),
    );

    expect(result.usage.outputTokens).toBe(42);
  });
});

describe("createMockLLMFromMap", () => {
  test("creates rules from string map", async () => {
    const mock = createMockLLMFromMap({
      capital: "Paris",
      weather: "Sunny",
    });

    const result = await Effect.runPromise(
      mock.service.complete({
        messages: [{ role: "user", content: "What is the capital?" }],
      }),
    );

    expect(result.content).toBe("Paris");
  });

  test("falls through to default for unmatched input", async () => {
    const mock = createMockLLMFromMap({ specific: "matched" });

    const result = await Effect.runPromise(
      mock.service.complete({
        messages: [{ role: "user", content: "other" }],
      }),
    );

    expect(result.content).toBe("FINAL ANSWER: mock response");
  });
});

// ─── MockToolService ────────────────────────────────────────────────────────

describe("createMockToolService", () => {
  test("records tool calls with name, args, and timestamp", async () => {
    const mock = createMockToolService({ "web-search": { results: [] } });

    await Effect.runPromise(
      mock.service.execute({
        toolName: "web-search",
        arguments: { query: "test" },
      }),
    );

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].toolName).toBe("web-search");
    expect(mock.calls[0].arguments).toEqual({ query: "test" });
    expect(typeof mock.calls[0].timestamp).toBe("number");
  });

  test("returns configured result for known tool", async () => {
    const mock = createMockToolService({
      "file-read": { content: "hello world" },
    });

    const result = await Effect.runPromise(
      mock.service.execute({
        toolName: "file-read",
        arguments: { path: "./test.txt" },
      }),
    );

    expect(result.result).toEqual({ content: "hello world" });
  });

  test("returns default { success: true } for unknown tool", async () => {
    const mock = createMockToolService({});

    const result = await Effect.runPromise(
      mock.service.execute({
        toolName: "unknown-tool",
        arguments: {},
      }),
    );

    expect(result.result).toEqual({ success: true });
  });

  test("callsFor filters by tool name", async () => {
    const mock = createMockToolService({});

    await Effect.runPromise(
      mock.service.execute({ toolName: "tool-a", arguments: {} }),
    );
    await Effect.runPromise(
      mock.service.execute({ toolName: "tool-b", arguments: {} }),
    );
    await Effect.runPromise(
      mock.service.execute({ toolName: "tool-a", arguments: {} }),
    );

    expect(mock.callsFor("tool-a")).toHaveLength(2);
    expect(mock.callsFor("tool-b")).toHaveLength(1);
    expect(mock.callsFor("tool-c")).toHaveLength(0);
  });

  test("callCount tracks total calls", async () => {
    const mock = createMockToolService({});

    expect(mock.callCount).toBe(0);

    await Effect.runPromise(
      mock.service.execute({ toolName: "tool-a", arguments: {} }),
    );
    await Effect.runPromise(
      mock.service.execute({ toolName: "tool-b", arguments: {} }),
    );

    expect(mock.callCount).toBe(2);
  });

  test("reset clears all calls", async () => {
    const mock = createMockToolService({});

    await Effect.runPromise(
      mock.service.execute({ toolName: "tool-a", arguments: {} }),
    );
    expect(mock.callCount).toBe(1);

    mock.reset();
    expect(mock.callCount).toBe(0);
    expect(mock.calls).toHaveLength(0);
  });

  test("listTools returns definitions from configured keys", async () => {
    const mock = createMockToolService({
      "file-read": {},
      "web-search": {},
    });

    const tools = await Effect.runPromise(mock.service.listTools());

    expect(tools).toHaveLength(2);
    expect(tools.map((t: { name: string }) => t.name).sort()).toEqual([
      "file-read",
      "web-search",
    ]);
  });
});

// ─── MockEventBus ───────────────────────────────────────────────────────────

describe("createMockEventBus", () => {
  test("captures published events", async () => {
    const mock = createMockEventBus();

    await Effect.runPromise(
      mock.service.publish({ _tag: "TaskCreated", taskId: "task-1" }),
    );

    expect(mock.events).toHaveLength(1);
    expect(mock.events[0]._tag).toBe("TaskCreated");
    expect(mock.events[0].data).toEqual({ taskId: "task-1" });
  });

  test("captured(tag) filters events by tag", async () => {
    const mock = createMockEventBus();

    await Effect.runPromise(
      mock.service.publish({ _tag: "TaskCreated", taskId: "task-1" }),
    );
    await Effect.runPromise(
      mock.service.publish({
        _tag: "TaskCompleted",
        taskId: "task-1",
        success: true,
      }),
    );
    await Effect.runPromise(
      mock.service.publish({ _tag: "TaskCreated", taskId: "task-2" }),
    );

    expect(mock.captured("TaskCreated")).toHaveLength(2);
    expect(mock.captured("TaskCompleted")).toHaveLength(1);
    expect(mock.captured("AgentStarted")).toHaveLength(0);
  });

  test("eventCount tracks total events", async () => {
    const mock = createMockEventBus();

    expect(mock.eventCount).toBe(0);

    await Effect.runPromise(
      mock.service.publish({ _tag: "TaskCreated", taskId: "t1" }),
    );
    await Effect.runPromise(
      mock.service.publish({ _tag: "TaskCreated", taskId: "t2" }),
    );

    expect(mock.eventCount).toBe(2);
  });

  test("reset clears events and handlers", async () => {
    const mock = createMockEventBus();

    await Effect.runPromise(
      mock.service.publish({ _tag: "TaskCreated", taskId: "t1" }),
    );
    await Effect.runPromise(mock.service.on("TaskCreated", () => Effect.void));

    expect(mock.eventCount).toBe(1);

    mock.reset();
    expect(mock.eventCount).toBe(0);
    expect(mock.events).toHaveLength(0);
  });

  test("on() returns an unsubscribe function", async () => {
    const mock = createMockEventBus();

    const unsub = await Effect.runPromise(
      mock.service.on("TaskCreated", () => Effect.void),
    );

    expect(typeof unsub).toBe("function");
  });

  test("subscribe() returns an unsubscribe function", async () => {
    const mock = createMockEventBus();

    const unsub = await Effect.runPromise(
      mock.service.subscribe(() => Effect.void),
    );

    expect(typeof unsub).toBe("function");
  });
});
