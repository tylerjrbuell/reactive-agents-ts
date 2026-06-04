import { describe, it, expect } from "bun:test";
import type { TaskContract } from "@reactive-agents/core";
import { ReactiveAgents } from "../builder.js";
import { validateBuild, validateTaskContract } from "../build-validation.js";
import { computeExposedToolNames } from "../builder/contract-tool-set.js";

/**
 * Realization-plan P2 / Drift S7 — TaskContract build-time enforcement.
 *
 * `.withContract(c)` threads a TaskContract into `build()`, which validates it
 * against the agent's statically-knowable exposed-tool set and the resolved
 * model capability, merging results into the SAME errors[]/warnings[] path
 * `validateBuild` already throws on (strict → throw, non-strict → warn).
 *
 * Tool-set checks use `provider: "test"` (deterministic build, no API key,
 * no capability resolution). ModelFloor checks exercise `validateBuild`
 * directly with `provider: "ollama"` + a static-table model so the real
 * resolved Capability is used without needing a live ollama connection
 * (validation errors throw before the connection pre-flight).
 */

const successOracle = { type: "regex" as const, pattern: "ok" };

describe("withContract — required tool exposure", () => {
  it("throws under strict when a required tool is NOT exposed", async () => {
    const contract: TaskContract = {
      prompt: "do the thing",
      tools: [{ kind: "required", name: "file-read" }],
      success: successOracle,
    };
    // builtins not opted in → file-read is registered but not in exposed set.
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withStrictValidation()
      .withContract(contract);
    await expect(builder.build()).rejects.toThrow(/file-read/);
  });

  it("builds clean when the required tool IS exposed via builtins opt-in", async () => {
    const contract: TaskContract = {
      prompt: "do the thing",
      tools: [{ kind: "required", name: "file-read" }],
      success: successOracle,
    };
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withStrictValidation()
      .withTools({ builtins: ["file-read"] })
      .withContract(contract)
      .build();
    await agent.dispose();
    expect(agent).toBeDefined();
  });

  it("builds clean when the required tool is a registered custom tool", async () => {
    const contract: TaskContract = {
      prompt: "do the thing",
      tools: [{ kind: "required", name: "my-tool" }],
      success: successOracle,
    };
    const { Effect } = await import("effect");
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withStrictValidation()
      .withTools({
        tools: [
          {
            definition: {
              name: "my-tool",
              description: "x",
              parameters: [],
              source: "function" as const,
              requiresApproval: false,
              riskLevel: "low" as const,
              timeoutMs: 30_000,
            },
            handler: () => Effect.succeed("ok"),
          },
        ],
      })
      .withContract(contract)
      .build();
    await agent.dispose();
    expect(agent).toBeDefined();
  });
});

describe("withContract — forbidden tool absence", () => {
  it("throws under strict when a forbidden tool IS exposed", async () => {
    const contract: TaskContract = {
      prompt: "summarize, no shell",
      tools: [{ kind: "forbidden", name: "shell-execute" }],
      success: successOracle,
    };
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withStrictValidation()
      .withTerminalTools()
      .withContract(contract);
    await expect(builder.build()).rejects.toThrow(/shell-execute/);
  });

  it("builds clean when the forbidden tool is absent", async () => {
    const contract: TaskContract = {
      prompt: "summarize, no shell",
      tools: [{ kind: "forbidden", name: "shell-execute" }],
      success: successOracle,
    };
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withStrictValidation()
      .withContract(contract)
      .build();
    await agent.dispose();
    expect(agent).toBeDefined();
  });
});

describe("withContract — non-strict downgrades to warnings", () => {
  it("does NOT throw a violated contract when strict is off", async () => {
    const contract: TaskContract = {
      prompt: "do the thing",
      tools: [{ kind: "required", name: "file-read" }],
      success: successOracle,
    };
    // No .withStrictValidation() → violations are warnings, build succeeds.
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withContract(contract)
      .build();
    await agent.dispose();
    expect(agent).toBeDefined();
  });
});

describe("withContract — modelFloor vs resolved capability (validateBuild)", () => {
  // qwen3:14b resolves via static-table: window 85196 chars, thinking false,
  // dialect native-fc (probed 2026-06-03).
  const exposed = ["file-read"];

  it("errors under strict when modelFloor.window exceeds the resolved window", () => {
    const contract: TaskContract = {
      prompt: "x",
      tools: [],
      modelFloor: { window: 999_999_999 },
      success: successOracle,
    };
    const res = validateBuild("ollama", "qwen3:14b", "qwen3:14b", true, {
      contract,
      exposedToolNames: exposed,
    });
    expect(res.errors.some((e) => /window/i.test(e))).toBe(true);
  });

  it("warns (not errors) on an unmet window floor when strict is off", () => {
    const contract: TaskContract = {
      prompt: "x",
      tools: [],
      modelFloor: { window: 999_999_999 },
      success: successOracle,
    };
    const res = validateBuild("ollama", "qwen3:14b", "qwen3:14b", false, {
      contract,
      exposedToolNames: exposed,
    });
    expect(res.errors.some((e) => /window/i.test(e))).toBe(false);
    expect(res.warnings.some((e) => /window/i.test(e))).toBe(true);
  });

  it("errors under strict when modelFloor.thinking is required but unsupported", () => {
    const contract: TaskContract = {
      prompt: "x",
      tools: [],
      modelFloor: { thinking: true },
      success: successOracle,
    };
    const res = validateBuild("ollama", "qwen3:14b", "qwen3:14b", true, {
      contract,
      exposedToolNames: exposed,
    });
    expect(res.errors.some((e) => /thinking/i.test(e))).toBe(true);
  });

  it("does not flag modelFloor when the floor is satisfied", () => {
    const contract: TaskContract = {
      prompt: "x",
      tools: [],
      modelFloor: { window: 1000, nativeFC: true },
      success: successOracle,
    };
    const res = validateBuild("ollama", "qwen3:14b", "qwen3:14b", true, {
      contract,
      exposedToolNames: exposed,
    });
    expect(res.errors.some((e) => /window|thinking|native/i.test(e))).toBe(
      false,
    );
  });

  it("throws end-to-end from build() under strict when modelFloor.window unmet", async () => {
    // Throws at validateBuild (before the ollama connection pre-flight), so
    // this needs no live ollama. Closes the literal success-criterion wording
    // ("modelFloor-unmet ... throw under strict") at the build() boundary.
    const contract: TaskContract = {
      prompt: "x",
      tools: [],
      modelFloor: { window: 999_999_999 },
      success: successOracle,
    };
    const builder = ReactiveAgents.create()
      .withProvider("ollama")
      .withModel("qwen3:14b")
      .withStrictValidation()
      .withContract(contract);
    await expect(builder.build()).rejects.toThrow(/window/i);
  });
});

describe("withContract — exposed-tool-set mirrors runtime base-schema", () => {
  it("a builtin named in allowedTools counts as exposed (no builtins:true)", () => {
    // Regression guard: tool-schemas.ts:99-102 opts a builtin INTO the base
    // schema when it's named in allowedTools, even without builtins:true. The
    // static set must mirror this or a valid strict build would false-throw.
    const exposed = computeExposedToolNames({ allowedTools: ["file-read"] });
    expect(exposed).toContain("file-read");
  });

  it("a builtin NOT opted in is absent from the exposed set", () => {
    const exposed = computeExposedToolNames(undefined);
    expect(exposed).not.toContain("file-read");
  });

  it("allowedTools restricts the surviving set to the allowlist", () => {
    const exposed = computeExposedToolNames({
      builtins: ["file-read", "web-search"],
      allowedTools: ["file-read"],
    });
    expect(exposed).toContain("file-read");
    expect(exposed).not.toContain("web-search");
  });
});

describe("withContract — available kind requires exposure", () => {
  it("throws under strict when an available tool is NOT exposed", async () => {
    const contract: TaskContract = {
      prompt: "x",
      tools: [{ kind: "available", name: "web-search" }],
      success: successOracle,
    };
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withStrictValidation()
      .withContract(contract);
    await expect(builder.build()).rejects.toThrow(/web-search/);
  });
});

describe("withContract — MCP downgrades missing-required to a warning", () => {
  it("does not error a missing required tool when MCP is configured", () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    const contract: TaskContract = {
      prompt: "x",
      tools: [{ kind: "required", name: "mcp-only-tool" }],
      success: successOracle,
    };
    validateTaskContract(
      contract,
      /* exposedToolNames */ [],
      /* resolvedCapability */ undefined,
      /* hasMcpServers */ true,
      /* strict */ true,
      warnings,
      errors,
    );
    expect(errors.some((e) => /mcp-only-tool/.test(e))).toBe(false);
    expect(warnings.some((e) => /mcp-only-tool/.test(e))).toBe(true);
  });
});
