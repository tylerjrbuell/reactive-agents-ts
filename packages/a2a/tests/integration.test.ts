import { describe, it, expect, afterEach } from "bun:test";
import { Effect } from "effect";
import { A2AClient, createA2AClient } from "../src/client/a2a-client.js";
import { generateAgentCard } from "../src/agent-card.js";
import { discoverAgent } from "../src/client/discovery.js";
import { findBestAgent, matchCapabilities } from "../src/client/capability-matcher.js";

let servers: ReturnType<typeof Bun.serve>[] = [];

afterEach(() => {
  for (const s of servers) s.stop(true);
  servers = [];
});

const startServer = (handler: (req: Request) => Response | Promise<Response>) => {
  const s = Bun.serve({ port: 0, fetch: handler });
  servers.push(s);
  return s;
};

describe("A2A Integration", () => {
  it("should send a message and retrieve the completed task", async () => {
    const tasks = new Map<string, any>();

    const server = startServer(async (req) => {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/.well-known/agent.json") {
        return Response.json(generateAgentCard({ name: "test-agent", url: `http://localhost:${server.port}` }));
      }
      if (req.method === "POST") {
        const body = await req.json() as any;
        if (body.method === "message/send") {
          const taskId = crypto.randomUUID();
          tasks.set(taskId, { id: taskId, status: { state: "completed" }, result: "Hello back!" });
          return Response.json({ jsonrpc: "2.0", result: { taskId }, id: body.id });
        }
        if (body.method === "tasks/get") {
          const task = tasks.get(body.params?.id);
          if (task) return Response.json({ jsonrpc: "2.0", result: task, id: body.id });
          return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Not found" }, id: body.id });
        }
      }
      return new Response("Not Found", { status: 404 });
    });

    const layer = createA2AClient({ baseUrl: `http://localhost:${server.port}` });

    // Send message
    const sendResult = await Effect.gen(function* () {
      const client = yield* A2AClient;
      return yield* client.sendMessage({
        message: { role: "user", parts: [{ kind: "text", text: "Hello" }] },
      });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(sendResult.taskId).toBeDefined();

    // Get task result
    const task = await Effect.gen(function* () {
      const client = yield* A2AClient;
      return yield* client.getTask({ id: sendResult.taskId });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect((task as any).status.state).toBe("completed");
    expect((task as any).result).toBe("Hello back!");
  });

  it("should discover an agent via .well-known/agent.json", async () => {
    const card = generateAgentCard({
      name: "discoverable-agent",
      description: "An agent that can be discovered",
      url: "http://localhost:0",
      skills: [{ id: "search", name: "Search", description: "Search the web", tags: ["search"] }],
    });

    const server = startServer((req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") return Response.json(card);
      if (url.pathname === "/agent/card") return Response.json(card);
      return new Response("Not Found", { status: 404 });
    });

    const discovered = await Effect.runPromise(discoverAgent(`http://localhost:${server.port}`));

    expect(discovered.name).toBe("discoverable-agent");
    expect(discovered.skills).toHaveLength(1);
    expect(discovered.skills![0].id).toBe("search");
  });

  it("should match and rank agents by capabilities", () => {
    const agents = [
      generateAgentCard({
        name: "search-agent",
        url: "http://a",
        skills: [
          { id: "web-search", name: "Web Search", description: "Search", tags: ["search", "web"] },
        ],
      }),
      generateAgentCard({
        name: "math-agent",
        url: "http://b",
        skills: [
          { id: "calculator", name: "Calculator", description: "Math", tags: ["math"] },
        ],
      }),
      generateAgentCard({
        name: "general-agent",
        url: "http://c",
        skills: [
          { id: "web-search", name: "Web Search", description: "Search", tags: ["search"] },
          { id: "calculator", name: "Calculator", description: "Math", tags: ["math"] },
        ],
      }),
    ];

    // Find best agent for search
    const searchResult = findBestAgent(agents, { skillIds: ["web-search"] });
    expect(searchResult).toBeDefined();
    // Both search-agent and general-agent match; general-agent has it too
    expect(["search-agent", "general-agent"]).toContain(searchResult!.agent.name);

    // Match with tags
    const tagResults = matchCapabilities(agents, { tags: ["search", "math"] });
    expect(tagResults.length).toBeGreaterThanOrEqual(2);
    // general-agent has both tags, should score highest
    expect(tagResults[0].agent.name).toBe("general-agent");
  });

  it("should handle agent card generation with full config", () => {
    const card = generateAgentCard({
      name: "full-agent",
      description: "A fully configured agent",
      version: "2.0.0",
      url: "https://agent.example.com",
      organization: "Acme Corp",
      organizationUrl: "https://acme.example.com",
      capabilities: { streaming: false, pushNotifications: true },
      skills: [
        { id: "code", name: "Code", description: "Write code", tags: ["programming"] },
      ],
    });

    expect(card.name).toBe("full-agent");
    expect(card.version).toBe("2.0.0");
    expect(card.protocolVersion).toBe("0.3.0");
    expect(card.provider.organization).toBe("Acme Corp");
    expect(card.capabilities.streaming).toBe(false);
    expect(card.capabilities.pushNotifications).toBe(true);
    expect(card.skills).toHaveLength(1);
  });

  it("should handle full pipeline: discover → send → poll → complete", async () => {
    const taskStore = new Map<string, any>();

    const server = startServer(async (req) => {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/.well-known/agent.json") {
        return Response.json(generateAgentCard({
          name: "pipeline-agent",
          url: `http://localhost:${server.port}`,
          skills: [{ id: "echo", name: "Echo", description: "Echoes input", tags: ["echo"] }],
        }));
      }

      if (req.method === "POST") {
        const body = await req.json() as any;

        if (body.method === "message/send") {
          const taskId = crypto.randomUUID();
          const text = body.params?.message?.parts?.find((p: any) => p.kind === "text")?.text ?? "";
          // Simulate async completion
          taskStore.set(taskId, { id: taskId, status: { state: "completed" }, result: `Echo: ${text}` });
          return Response.json({ jsonrpc: "2.0", result: { taskId }, id: body.id });
        }

        if (body.method === "tasks/get") {
          const task = taskStore.get(body.params?.id);
          if (!task) return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Not found" }, id: body.id });
          return Response.json({ jsonrpc: "2.0", result: task, id: body.id });
        }

        if (body.method === "agent/card") {
          return Response.json({ jsonrpc: "2.0", result: generateAgentCard({
            name: "pipeline-agent",
            url: `http://localhost:${server.port}`,
          }), id: body.id });
        }
      }

      return new Response("Not Found", { status: 404 });
    });

    const baseUrl = `http://localhost:${server.port}`;

    // 1. Discover
    const card = await Effect.runPromise(discoverAgent(baseUrl));
    expect(card.name).toBe("pipeline-agent");

    // 2. Send via client
    const layer = createA2AClient({ baseUrl });
    const sendResult = await Effect.gen(function* () {
      const client = yield* A2AClient;
      return yield* client.sendMessage({
        message: { role: "user", parts: [{ kind: "text", text: "Hello world" }] },
      });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(sendResult.taskId).toBeDefined();

    // 3. Get result
    const task = await Effect.gen(function* () {
      const client = yield* A2AClient;
      return yield* client.getTask({ id: sendResult.taskId });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect((task as any).status.state).toBe("completed");
    expect((task as any).result).toBe("Echo: Hello world");
  });

  it("should cancel an in-progress task", async () => {
    const taskStore = new Map<string, any>();

    const server = startServer(async (req) => {
      if (req.method === "POST") {
        const body = await req.json() as any;

        if (body.method === "message/send") {
          const taskId = crypto.randomUUID();
          taskStore.set(taskId, { id: taskId, status: { state: "working" } });
          return Response.json({ jsonrpc: "2.0", result: { taskId }, id: body.id });
        }

        if (body.method === "tasks/cancel") {
          const task = taskStore.get(body.params?.id);
          if (task) {
            task.status = { state: "canceled" };
            return Response.json({ jsonrpc: "2.0", result: task, id: body.id });
          }
          return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Not found" }, id: body.id });
        }
      }
      return new Response("Not Found", { status: 404 });
    });

    const layer = createA2AClient({ baseUrl: `http://localhost:${server.port}` });

    // Send
    const sendResult = await Effect.gen(function* () {
      const client = yield* A2AClient;
      return yield* client.sendMessage({
        message: { role: "user", parts: [{ kind: "text", text: "Long task" }] },
      });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    // Cancel
    const canceled = await Effect.gen(function* () {
      const client = yield* A2AClient;
      return yield* client.cancelTask({ id: sendResult.taskId });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect((canceled as any).status.state).toBe("canceled");
  });
});
