/**
 * Example 04: A2A Agent Communication
 *
 * Demonstrates two agents communicating via the A2A (Agent-to-Agent) protocol:
 * - Agent A starts as an A2A server with Bun.serve()
 * - Agent B discovers Agent A and sends it a task via JSON-RPC
 * - Agent B retrieves the completed result
 *
 * Usage:
 *   bun run apps/examples/src/04-a2a-agents.ts
 */

import { ReactiveAgents } from "@reactive-agents/runtime";
import { generateAgentCard } from "@reactive-agents/a2a";

console.log("=== Reactive Agents: A2A Communication Example ===\n");

// ─── Step 1: Build a "specialist" agent that will serve as the A2A server ───

const specialist = await ReactiveAgents.create()
  .withName("specialist-agent")
  .withProvider("test")
  .withTestResponses({
    "": "The answer is 42. This is the ultimate answer to life, the universe, and everything.",
  })
  .withMaxIterations(3)
  .build();

console.log("Built specialist agent.\n");

// ─── Step 2: Start an A2A server for the specialist ───

const agentCard = generateAgentCard({
  name: "specialist-agent",
  description: "A specialist agent that answers deep questions",
  url: "http://localhost:0", // port assigned by Bun
  skills: [
    { id: "deep-questions", name: "Deep Questions", description: "Answers philosophical questions", tags: ["philosophy"] },
  ],
});

const tasks = new Map<string, { id: string; status: { state: string }; result?: unknown }>();

const server = Bun.serve({
  port: 0, // auto-assign
  async fetch(req) {
    const url = new URL(req.url);

    // Agent Card discovery
    if (req.method === "GET" && (url.pathname === "/.well-known/agent.json" || url.pathname === "/agent/card")) {
      return Response.json(agentCard);
    }

    // JSON-RPC endpoint
    if (req.method === "POST" && url.pathname === "/") {
      const body = await req.json() as { method: string; params?: any; id?: string };

      if (body.method === "agent/card") {
        return Response.json({ jsonrpc: "2.0", result: agentCard, id: body.id });
      }

      if (body.method === "message/send") {
        const taskId = crypto.randomUUID();
        const textPart = body.params?.message?.parts?.find((p: any) => p.kind === "text");
        const input = textPart?.text ?? "no input";

        tasks.set(taskId, { id: taskId, status: { state: "working" } });

        // Run agent asynchronously
        specialist.run(input).then(
          (result) => {
            tasks.set(taskId, { id: taskId, status: { state: "completed" }, result: result.output });
          },
          () => {
            tasks.set(taskId, { id: taskId, status: { state: "failed" } });
          },
        );

        return Response.json({ jsonrpc: "2.0", result: { taskId }, id: body.id });
      }

      if (body.method === "tasks/get") {
        const task = tasks.get(body.params?.id);
        if (!task) return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Not found" }, id: body.id });
        return Response.json({ jsonrpc: "2.0", result: task, id: body.id });
      }

      return Response.json({ jsonrpc: "2.0", error: { code: -32601, message: "Method not found" }, id: body.id });
    }

    return new Response("Not Found", { status: 404 });
  },
});

const baseUrl = `http://localhost:${server.port}`;
console.log(`A2A server running at ${baseUrl}`);
console.log(`Agent Card: ${baseUrl}/.well-known/agent.json\n`);

// ─── Step 3: Discover the agent ───

console.log("Discovering remote agent...");
const discoveredCard = await fetch(`${baseUrl}/.well-known/agent.json`).then((r) => r.json());
console.log(`Discovered: ${discoveredCard.name} (${discoveredCard.description})`);
console.log(`Skills: ${discoveredCard.skills.map((s: any) => s.name).join(", ")}\n`);

// ─── Step 4: Send a task via JSON-RPC ───

const question = "What is the meaning of life?";
console.log(`Sending task: "${question}"`);

const sendResult = await fetch(baseUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    method: "message/send",
    params: { message: { role: "user", parts: [{ kind: "text", text: question }] } },
    id: "1",
  }),
}).then((r) => r.json()) as { result: { taskId: string } };

const taskId = sendResult.result.taskId;
console.log(`Task ID: ${taskId}\n`);

// ─── Step 5: Poll for completion ───

console.log("Waiting for result...");
let taskResult: any;
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 100));
  taskResult = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "tasks/get", params: { id: taskId }, id: "2" }),
  }).then((r) => r.json());

  if (taskResult.result?.status?.state === "completed" || taskResult.result?.status?.state === "failed") break;
}

// ─── Step 6: Display the result ───

console.log("\n--- Result ---");
console.log(`State: ${taskResult.result?.status?.state}`);
console.log(`Output: ${taskResult.result?.result}`);

// Cleanup
server.stop(true);
console.log("\nServer stopped. Done.");
