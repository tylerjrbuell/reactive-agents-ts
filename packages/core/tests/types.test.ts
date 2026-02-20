import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import {
  AgentSchema,
  AgentConfigSchema,
  TaskSchema,
  TaskConfigSchema,
  MessageSchema,
  RuntimeConfigSchema,
  TaskResultSchema,
  ReasoningStepSchema,
  defaultRuntimeConfig,
  generateAgentId,
  generateTaskId,
  generateMessageId,
  AgentError,
  AgentNotFoundError,
  TaskError,
  ValidationError,
  RuntimeError,
} from "../src/index.js";

describe("Types & Schemas", () => {
  describe("ID generation", () => {
    it("should generate unique agent IDs", () => {
      const id1 = generateAgentId();
      const id2 = generateAgentId();
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });

    it("should generate unique task IDs", () => {
      const id1 = generateTaskId();
      const id2 = generateTaskId();
      expect(id1).not.toBe(id2);
    });

    it("should generate unique message IDs", () => {
      const id1 = generateMessageId();
      const id2 = generateMessageId();
      expect(id1).not.toBe(id2);
    });
  });

  describe("AgentConfigSchema", () => {
    it("should decode a valid agent config", () => {
      const input = {
        name: "TestAgent",
        capabilities: [{ type: "tool", name: "search" }],
      };
      const decoded = Schema.decodeUnknownSync(AgentConfigSchema)(input);
      expect(decoded.name).toBe("TestAgent");
      expect(decoded.capabilities.length).toBe(1);
    });

    it("should reject invalid capability type", () => {
      const input = {
        name: "Bad",
        capabilities: [{ type: "invalid", name: "x" }],
      };
      expect(() =>
        Schema.decodeUnknownSync(AgentConfigSchema)(input),
      ).toThrow();
    });
  });

  describe("RuntimeConfigSchema", () => {
    it("should decode the default config", () => {
      const decoded =
        Schema.decodeUnknownSync(RuntimeConfigSchema)(defaultRuntimeConfig);
      expect(decoded.maxConcurrentTasks).toBe(10);
      expect(decoded.logLevel).toBe("info");
    });
  });

  describe("Error types", () => {
    it("should create AgentError with tag", () => {
      const err = new AgentError({ message: "test error" });
      expect(err._tag).toBe("AgentError");
      expect(err.message).toBe("test error");
    });

    it("should create AgentNotFoundError with tag", () => {
      const err = new AgentNotFoundError({
        agentId: "a1",
        message: "not found",
      });
      expect(err._tag).toBe("AgentNotFoundError");
      expect(err.agentId).toBe("a1");
    });

    it("should create TaskError with tag", () => {
      const err = new TaskError({ taskId: "t1", message: "failed" });
      expect(err._tag).toBe("TaskError");
      expect(err.taskId).toBe("t1");
    });

    it("should create ValidationError with tag", () => {
      const err = new ValidationError({
        field: "name",
        message: "required",
      });
      expect(err._tag).toBe("ValidationError");
      expect(err.field).toBe("name");
    });

    it("should create RuntimeError with tag", () => {
      const err = new RuntimeError({ message: "timeout" });
      expect(err._tag).toBe("RuntimeError");
    });
  });
});
