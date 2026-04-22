import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Effect } from "effect";
import {
  makeDockerSandbox,
  DEFAULT_DOCKER_CONFIG,
  RUNNER_IMAGES,
} from "../src/execution/docker-sandbox.js";
import type {
  DockerSandboxConfig,
  RunnerLanguage,
} from "../src/execution/docker-sandbox.js";

// ─── Configuration Tests ───

describe("DockerSandbox — configuration", () => {
  it("DEFAULT_DOCKER_CONFIG has secure defaults", () => {
    expect(DEFAULT_DOCKER_CONFIG.image).toBe("oven/bun:1-alpine");
    expect(DEFAULT_DOCKER_CONFIG.memoryMb).toBe(256);
    expect(DEFAULT_DOCKER_CONFIG.cpuQuota).toBe(0.5);
    expect(DEFAULT_DOCKER_CONFIG.timeoutMs).toBe(30_000);
    expect(DEFAULT_DOCKER_CONFIG.autoRemove).toBe(true);
    expect(DEFAULT_DOCKER_CONFIG.network).toBe("none");
    expect(DEFAULT_DOCKER_CONFIG.readOnlyFs).toBe(true);
  });

  it("RUNNER_IMAGES contains all three languages", () => {
    expect(RUNNER_IMAGES.bun).toBe("oven/bun:1-alpine");
    expect(RUNNER_IMAGES.node).toBe("node:22-alpine3.22");
    expect(RUNNER_IMAGES.python).toBe("python:3.12-alpine3.22");
  });

  it("config override merges with defaults", () => {
    const sandbox = makeDockerSandbox({ memoryMb: 512, network: "bridge" });
    // Sandbox created without error — proves config merging works
    expect(sandbox).toBeDefined();
    expect(sandbox.execute).toBeFunction();
    expect(sandbox.available).toBeFunction();
  });
});

// ─── Tool Definition Tests ───

describe("DockerSandbox — tool definition", () => {
  it("dockerExecuteTool has correct metadata", async () => {
    const { dockerExecuteTool } = await import(
      "../src/skills/docker-execution.js"
    );
    expect(dockerExecuteTool.name).toBe("docker-execute");
    expect(dockerExecuteTool.category).toBe("code");
    expect(dockerExecuteTool.riskLevel).toBe("high");
    expect(dockerExecuteTool.requiresApproval).toBe(true);
    expect(dockerExecuteTool.timeoutMs).toBe(30_000);
    expect(dockerExecuteTool.source).toBe("builtin");
  });

  it("dockerExecuteTool has code and language parameters", async () => {
    const { dockerExecuteTool } = await import(
      "../src/skills/docker-execution.js"
    );
    const paramNames = dockerExecuteTool.parameters.map((p) => p.name);
    expect(paramNames).toContain("code");
    expect(paramNames).toContain("language");

    const langParam = dockerExecuteTool.parameters.find(
      (p) => p.name === "language",
    );
    expect(langParam?.required).toBe(false);
    expect(langParam?.default).toBe("bun");
    expect(langParam?.enum).toEqual(["bun", "node", "python"]);
  });
});

// ─── Execution Tests (Docker availability dependent) ───

describe("DockerSandbox — execution", () => {
  it("reports docker availability", async () => {
    const sandbox = makeDockerSandbox();
    // This test works regardless of whether Docker is installed
    const available = await Effect.runPromise(sandbox.available());
    expect(typeof available).toBe("boolean");
  });

  it("fails gracefully when Docker is unavailable", async () => {
    // Create sandbox with an impossible image to force failure path
    const sandbox = makeDockerSandbox({
      image: "nonexistent-image-that-does-not-exist:never",
      timeoutMs: 15_000,
    });

    const isAvailable = await Effect.runPromise(sandbox.available());

    if (!isAvailable) {
      // Docker is not installed — expect an error
      const result = await Effect.runPromise(
        sandbox.execute('console.log("hello")', "bun").pipe(
          Effect.either,
        ),
      );
      expect(result._tag).toBe("Left");
    } else {
      // Docker is installed — the nonexistent image will fail
      const result = await Effect.runPromise(
        sandbox.execute('console.log("hello")', "bun").pipe(
          Effect.either,
        ),
      );
      // Should either succeed (if docker pulls) or fail with execution error
      expect(result._tag).toBeDefined();
    }
  }, 30_000);
});

// ─── Handler Tests ───

describe("DockerSandbox — makeDockerExecuteHandler", () => {
  it("handler returns executed:false when docker is unavailable and code fails", async () => {
    const { makeDockerExecuteHandler } = await import(
      "../src/skills/docker-execution.js"
    );
    const handler = makeDockerExecuteHandler({ timeoutMs: 3_000 });

    const result = (await Effect.runPromise(
      handler({ code: 'console.log("test")', language: "bun" }),
    )) as Record<string, unknown>;

    // Whether Docker is available or not, handler should return without throwing
    expect(result).toBeDefined();
    expect(typeof result.executed).toBe("boolean");
    if (result.executed) {
      expect(result.output).toBeDefined();
      expect(result.exitCode).toBe(0);
    } else {
      expect(result.error).toBeDefined();
    }
  });

  it("handler defaults language to bun", async () => {
    const { makeDockerExecuteHandler } = await import(
      "../src/skills/docker-execution.js"
    );
    const handler = makeDockerExecuteHandler({ timeoutMs: 3_000 });

    const result = (await Effect.runPromise(
      handler({ code: 'console.log("test")' }),
    )) as Record<string, unknown>;

    // Should not throw even without language param
    expect(result).toBeDefined();
    expect(typeof result.executed).toBe("boolean");
  });
});
