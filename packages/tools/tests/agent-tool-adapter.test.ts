import { Effect } from "effect";
import { describe, it, expect, beforeEach } from "bun:test";

import {
  createAgentTool,
  createRemoteAgentTool,
  executeAgentTool,
  executeRemoteAgentTool,
  MAX_RECURSION_DEPTH,
  type RemoteAgentClient,
} from "../src/adapters/agent-tool-adapter.js";

describe("Agent Tool Adapter", () => {
  describe("createAgentTool", () => {
    it("should create a tool definition from a local agent config", () => {
      const agent = {
        name: "Research Agent",
        description: "Research agent for finding information",
        capabilities: [
          { type: "tool" as const, name: "webSearch" },
          { type: "memory" as const, name: "semantic" },
        ],
      };

      const tool = createAgentTool("research", agent);

      expect(tool.name).toBe("research");
      expect(tool.description).toBe("Research agent for finding information");
      expect(tool.source).toBe("function");
      expect(tool.riskLevel).toBe("medium");
      expect(tool.timeoutMs).toBe(60_000);
      expect(tool.requiresApproval).toBe(true);
    });

    it("should derive input schema from agent capabilities", () => {
      const agent = {
        name: "Test Agent",
        capabilities: [
          { type: "tool" as const, name: "search" },
          { type: "reasoning" as const, name: "tree-of-thought" },
        ],
      };

      const tool = createAgentTool("test-agent", agent);

      const paramNames = tool.parameters.map((p) => p.name);
      expect(paramNames).toContain("toolName");
      expect(paramNames).toContain("input");
      expect(paramNames).toContain("reasoning");
    });

    it("should use default description when not provided", () => {
      const agent = {
        name: "My Agent",
        capabilities: [],
      };

      const tool = createAgentTool("my-agent", agent);

      expect(tool.description).toBe("Agent: My Agent");
    });

    it("should handle agent with only memory capability", () => {
      const agent = {
        name: "Memory Agent",
        capabilities: [{ type: "memory" as const, name: "episodic" }],
      };

      const tool = createAgentTool("memory-agent", agent);

      const paramNames = tool.parameters.map((p) => p.name);
      expect(paramNames).toContain("input");
      expect(paramNames).toContain("remember");
    });
  });

  describe("createRemoteAgentTool", () => {
    it("should create a tool definition for a remote A2A agent", () => {
      const tool = createRemoteAgentTool(
        "remote-research",
        "http://localhost:3000/agent/card",
        "http://localhost:3000"
      );

      expect(tool.name).toBe("remote-research");
      expect(tool.description).toContain("http://localhost:3000");
      expect(tool.source).toBe("plugin");
      expect(tool.riskLevel).toBe("high");
      expect(tool.timeoutMs).toBe(120_000);
      expect(tool.requiresApproval).toBe(true);
    });

    it("should include message and stream parameters", () => {
      const tool = createRemoteAgentTool(
        "test-remote",
        "http://localhost:3000/agent/card",
        "http://localhost:3000"
      );

      const paramNames = tool.parameters.map((p) => p.name);
      expect(paramNames).toContain("message");
      expect(paramNames).toContain("stream");

      const messageParam = tool.parameters.find((p) => p.name === "message");
      expect(messageParam?.required).toBe(true);
      expect(messageParam?.type).toBe("string");

      const streamParam = tool.parameters.find((p) => p.name === "stream");
      expect(streamParam?.required).toBe(false);
      expect(streamParam?.default).toBe(false);
    });
  });

  describe("executeAgentTool", () => {
    it("should execute the agent function and return result", async () => {
      const tool = createAgentTool("test", {
        name: "Test",
        capabilities: [],
      });

      const executeFn = async (input: Record<string, unknown>) => {
        return { processed: input.value };
      };

      const result = await executeAgentTool(tool, { value: 42 }, executeFn);

      expect(result).toEqual({ processed: 42 });
    });

    it("should throw ToolExecutionError on agent failure", async () => {
      const tool = createAgentTool("failing", {
        name: "Failing",
        capabilities: [],
      });

      const executeFn = async () => {
        throw new Error("Agent failed");
      };

      await expect(
        executeAgentTool(tool, {}, executeFn)
      ).rejects.toThrow("Agent failed");
    });

    it("should enforce max recursion depth", async () => {
      const tool = createAgentTool("deep", {
        name: "Deep",
        capabilities: [],
      });

      const executeFn = async () => "result";

      await expect(
        executeAgentTool(tool, {}, executeFn, MAX_RECURSION_DEPTH)
      ).rejects.toThrow(`Maximum agent recursion depth (${MAX_RECURSION_DEPTH}) exceeded`);
    });

    it("should allow execution within depth limit", async () => {
      const tool = createAgentTool("depth-test", {
        name: "DepthTest",
        capabilities: [],
      });

      const executeFn = async () => "result";

      const result = await executeAgentTool(tool, {}, executeFn, 1);

      expect(result).toBe("result");
    });
  });

  describe("executeRemoteAgentTool", () => {
    let mockClient: RemoteAgentClient;

    beforeEach(() => {
      mockClient = {
        sendMessage: (params) =>
          Effect.succeed({ taskId: "task-123" }),
        getTask: (params) =>
          Effect.succeed({ status: "completed", result: { data: "test" } }),
      };
    });

    it("should send message to remote agent and return task result", async () => {
      const tool = createRemoteAgentTool(
        "remote",
        "http://localhost:3000/agent/card",
        "http://localhost:3000"
      );

      const result = await executeRemoteAgentTool(
        tool,
        { message: "Hello agent" },
        mockClient,
        "http://localhost:3000/agent/card"
      );

      expect(result.taskId).toBe("task-123");
      expect(result.status).toBe("completed");
      expect(result.result).toEqual({ data: "test" });
    });

    it("should throw error when message is missing", async () => {
      const tool = createRemoteAgentTool(
        "remote",
        "http://localhost:3000/agent/card",
        "http://localhost:3000"
      );

      await expect(
        executeRemoteAgentTool(tool, {}, mockClient, "http://localhost:3000/agent/card")
      ).rejects.toThrow("Missing required parameter: message");
    });
  });

  describe("MAX_RECURSION_DEPTH", () => {
    it("should be 3", () => {
      expect(MAX_RECURSION_DEPTH).toBe(3);
    });
  });
});
