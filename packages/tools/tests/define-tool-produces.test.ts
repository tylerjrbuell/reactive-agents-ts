// packages/tools/tests/define-tool-produces.test.ts
//
// FM-15 red-on-cut. `defineTool` had no `produces` field, so a user-authored
// tool could never mint an artifact fact — the harness's artifact ledger
// recognises a produced file ONLY from the tool's declared `produces`
// (act.ts resolveProduces). Measured consequence: a task naming a deliverable
// path ran the custom tool, wrote the file, and still held
// `deliverablesMissing:1` for the whole run, starving `evidenceDelta` until
// `low_delta_guard` marked a fully correct run `failed` with output nulled.
//
// Cutting the `produces` passthrough in define-tool.ts reddens the first test.
import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { defineTool } from "../src/define-tool.js";

describe("defineTool — produces (FM-15)", () => {
  it("threads produces:'file' onto the ToolDefinition so artifacts can be minted", () => {
    const tool = defineTool({
      name: "write-report",
      description: "Write a report to disk.",
      input: Schema.Struct({ path: Schema.String, body: Schema.String }),
      handler: (args) => Effect.succeed(`wrote ${args.path}`),
      produces: "file",
    });

    expect(tool.definition.produces).toBe("file");
  });

  it("accepts the other declared kinds", () => {
    const data = defineTool({
      name: "fetch-rows",
      description: "Fetch rows.",
      input: Schema.Struct({ q: Schema.String }),
      handler: () => Effect.succeed([]),
      produces: "data",
    });
    const none = defineTool({
      name: "ping",
      description: "Ping.",
      input: Schema.Struct({}),
      handler: () => Effect.succeed("pong"),
      produces: "none",
    });

    expect(data.definition.produces).toBe("data");
    expect(none.definition.produces).toBe("none");
  });

  it("omits produces when undeclared — the safe false-UNMET direction", () => {
    // An undeclared tool must NEVER fabricate an artifact. The resolver treats
    // absent as "data"; the field itself stays off the definition.
    const tool = defineTool({
      name: "no-declaration",
      description: "Undeclared.",
      input: Schema.Struct({ x: Schema.String }),
      handler: (args) => Effect.succeed(args.x),
    });

    expect(tool.definition.produces).toBeUndefined();
  });
});

describe("extractArtifactFacts — declaration-driven fallback (FM-15 layer 3)", () => {
  it("mints a path fact for a NON-builtin tool that declares produces:'file'", async () => {
    const { extractArtifactFacts } = await import("../src/artifacts/artifact-contract.js");
    const facts = extractArtifactFacts(
      "my_custom_writer",
      { path: "./out/report.md", content: "hi" },
      "file",
    );
    expect(facts.length).toBe(1);
    expect(facts[0]!.path).toBe("./out/report.md");
  });

  it("mints NOTHING for an undeclared non-builtin tool (safe false-UNMET)", async () => {
    const { extractArtifactFacts } = await import("../src/artifacts/artifact-contract.js");
    expect(extractArtifactFacts("my_custom_writer", { path: "./out/report.md" })).toEqual([]);
    expect(extractArtifactFacts("my_custom_writer", { path: "./x" }, "data")).toEqual([]);
    expect(extractArtifactFacts("my_custom_writer", { path: "./x" }, "none")).toEqual([]);
  });

  it("never treats a content body that mentions a path AS the path", async () => {
    const { extractArtifactFacts } = await import("../src/artifacts/artifact-contract.js");
    const facts = extractArtifactFacts(
      "my_custom_writer",
      { content: "please write ./evil.md", note: "./also-evil.md" },
      "file",
    );
    expect(facts).toEqual([]);
  });
});
