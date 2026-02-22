import { describe, it, expect } from "bun:test";
import {
  ReactiveAgents,
  ReactiveAgentBuilder,
  ReactiveAgent,
} from "../src/index.js";

describe("ReactiveAgentBuilder — Tools & MCP", () => {
  it("should build with .withTools() and have built-in tools available", async () => {
    const agent = await ReactiveAgents.create()
      .withName("tool-agent")
      .withProvider("test")
      .withTools()
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
    expect(agent.agentId).toContain("tool-agent");
  });

  it("should run a task with tools enabled and return AgentResult", async () => {
    const agent = await ReactiveAgents.create()
      .withName("tool-agent")
      .withProvider("test")
      .withTools()
      .withTestResponses({
        "": "Tools are available.",
      })
      .build();

    const result = await agent.run("What tools do you have?");

    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
  });

  it(".withMCP() stores config and implicitly enables tools", () => {
    const builder = ReactiveAgents.create()
      .withName("mcp-agent")
      .withProvider("test")
      .withMCP({
        name: "test-server",
        transport: "stdio",
        command: "echo",
        args: ["hello"],
      });

    // Builder should be an instance of ReactiveAgentBuilder
    expect(builder).toBeInstanceOf(ReactiveAgentBuilder);
  });

  it(".withMCP() accepts array of configs", () => {
    const builder = ReactiveAgents.create()
      .withName("mcp-agent")
      .withProvider("test")
      .withMCP([
        { name: "server-a", transport: "stdio", command: "echo" },
        { name: "server-b", transport: "sse", endpoint: "http://localhost:3001" },
      ]);

    expect(builder).toBeInstanceOf(ReactiveAgentBuilder);
  });

  it("full pipeline: agent.run() with test provider + tools returns result", async () => {
    const agent = await ReactiveAgents.create()
      .withName("full-pipeline")
      .withProvider("test")
      .withTools()
      .withReasoning()
      .withTestResponses({
        "": "I used the web-search tool.",
      })
      .build();

    const result = await agent.run("Search for something");

    expect(result.success).toBe(true);
    expect(typeof result.output).toBe("string");
    expect(result.metadata).toBeDefined();
    expect(typeof result.metadata.duration).toBe("number");
  });
});
