// Run: bun test packages/runtime/tests/subagent/agent-tool-parameters.test.ts --timeout 30000
//
// `.withAgentTool(name, { parameters })` takes typed input as a JSON Schema
// object (plain data, so it round-trips through AgentConfig). The parent model
// sees the properties as the tool's parameters; a call whose arguments break the
// schema fails with a typed SubAgentInputError before any sub-agent runs.
//
// Red-on-cut: delete the `validateSubAgentInput` line in
// src/builder/build-effect/local-agent-tools.ts and the invalid-input cases
// fail (the call starts a child instead); delete the `compileSubAgentInputCheck`
// call in applyWithAgentTool and the declaration-refusal cases fail.
import { describe, expect, it } from "bun:test";
import { Effect, Exit, Cause, Option } from "effect";
import * as toolsMod from "@reactive-agents/tools";
import { ReactiveAgents } from "../../src/index.js";
import { createLocalAgentToolRegistration } from "../../src/builder/build-effect/local-agent-tools.js";
import { parametersToJsonSchema, toToolParameters } from "../../src/builder/build-effect/sub-agent-parameters.js";
import { SubAgentInputError, SubAgentParametersError } from "../../src/errors/sub-agent-parameters-error.js";
import type { AgentToolOptions } from "../../src/builder/types.js";

const reviewSchema = {
  type: "object",
  properties: {
    repo: { type: "string", description: "owner/repo" },
    prNumber: { type: "integer", minimum: 1 },
    focus: { type: "string", enum: ["security", "style"] },
  },
  required: ["repo", "prNumber"],
  additionalProperties: false,
} as const;

const registration = (parameters: NonNullable<AgentToolOptions["agent"]>["parameters"]) =>
  createLocalAgentToolRegistration(
    { name: "review-pr", agent: { name: "reviewer", maxIterations: 2, parameters } },
    {
      toolsMod: {
        createAgentTool: toolsMod.createAgentTool,
        composeSubAgentDirectivePrompt: toolsMod.composeSubAgentDirectivePrompt,
        finalizeSubAgentResult: toolsMod.finalizeSubAgentResult,
      },
      agentId: "parent-agent",
      getParentContext: () => undefined,
    },
  );

const failureOf = async (args: Record<string, unknown>) => {
  const exit = await Effect.runPromiseExit(registration(reviewSchema).handler(args));
  if (!Exit.isFailure(exit)) return undefined;
  return Option.getOrUndefined(Cause.failureOption(exit.cause));
};

describe("sub-agent tool definition", () => {
  it("exposes JSON Schema properties as the tool's typed parameters, next to `input`", () => {
    const { def } = registration(reviewSchema);
    const byName = Object.fromEntries(def.parameters.map((p) => [p.name, p]));
    expect(byName.input).toBeDefined();
    expect(byName.repo).toMatchObject({ type: "string", required: true, description: "owner/repo" });
    expect(byName.prNumber).toMatchObject({ type: "number", required: true });
    expect(byName.focus).toMatchObject({ type: "string", required: false, enum: ["security", "style"] });
  });

  it("keeps a ToolParameter list working", () => {
    const list = [{ name: "repo", type: "string", description: "r", required: true }] as const;
    const { def } = registration(list);
    expect(def.parameters.map((p) => p.name)).toEqual(["input", "repo"]);
  });

  it("converts a ToolParameter list to a JSON Schema and back", () => {
    const list = [
      { name: "repo", type: "string", description: "r", required: true },
      { name: "kind", type: "string", description: "k", required: false, enum: ["a", "b"] },
    ] as const;
    const schema = parametersToJsonSchema(list);
    expect(schema).toMatchObject({ type: "object", required: ["repo"] });
    expect(toToolParameters(schema).map((p) => [p.name, p.required, p.enum])).toEqual([
      ["repo", true, undefined],
      ["kind", false, ["a", "b"]],
    ]);
  });
});

describe("sub-agent tool input validation", () => {
  it("fails a call that is missing a required argument", async () => {
    const err = await failureOf({ repo: "o/r" });
    expect(err).toBeInstanceOf(SubAgentInputError);
    expect((err as SubAgentInputError).issues.join(" ")).toContain("prNumber");
    expect((err as SubAgentInputError).toolName).toBe("review-pr");
  });

  it("fails a call with a wrongly typed or out-of-range argument", async () => {
    const err = (await failureOf({ repo: "o/r", prNumber: "42" })) as SubAgentInputError;
    expect(err).toBeInstanceOf(SubAgentInputError);
    expect(err.issues.join(" ")).toContain("$.prNumber");
    const low = (await failureOf({ repo: "o/r", prNumber: 0 })) as SubAgentInputError;
    expect(low.issues.join(" ")).toContain("$.prNumber");
  });

  it("fails a call with an argument the schema forbids, but lets `input` through", async () => {
    const err = (await failureOf({ repo: "o/r", prNumber: 1, surprise: true })) as SubAgentInputError;
    expect(err).toBeInstanceOf(SubAgentInputError);
    expect(err.issues.join(" ")).toContain("surprise");
  });

  it("accepts a valid call (and the catch-all `input`) without an input error", async () => {
    const exit = await Effect.runPromiseExit(
      registration(reviewSchema).handler({ input: "review it", repo: "o/r", prNumber: 7, focus: "style" }),
    );
    if (Exit.isFailure(exit)) {
      expect(Option.getOrUndefined(Cause.failureOption(exit.cause))).not.toBeInstanceOf(SubAgentInputError);
    }
  }, 30000);
});

describe(".withAgentTool declaration", () => {
  it("refuses a JSON Schema the validator cannot check", () => {
    expect(() =>
      ReactiveAgents.create().withAgentTool("t", {
        name: "t",
        parameters: { type: "object", dependentRequired: { a: ["b"] } },
      }),
    ).toThrow(SubAgentParametersError);
  });

  it("refuses a non-object JSON Schema", () => {
    expect(() =>
      ReactiveAgents.create().withAgentTool("t", { name: "t", parameters: { type: "string" } }),
    ).toThrow(/object/);
  });

  it("round-trips a JSON Schema through toConfig / fromConfig", async () => {
    const builder = ReactiveAgents.create()
      .withName("parent")
      .withProvider("test")
      .withAgentTool("review-pr", { name: "reviewer", parameters: reviewSchema });
    const config = builder.toConfig();
    expect(config.agentTools?.[0]?.agent?.parameters).toEqual(reviewSchema);
    const again = (await ReactiveAgents.fromConfig(config)).toConfig();
    expect(again.agentTools?.[0]?.agent?.parameters).toEqual(reviewSchema);
  });

  it("stores a ToolParameter list as a JSON Schema in the config", () => {
    const config = ReactiveAgents.create()
      .withName("parent")
      .withProvider("test")
      .withAgentTool("t", {
        name: "t",
        parameters: [{ name: "repo", type: "string", description: "r", required: true }],
      })
      .toConfig();
    expect(config.agentTools?.[0]?.agent?.parameters).toMatchObject({ type: "object", required: ["repo"] });
  });
});
