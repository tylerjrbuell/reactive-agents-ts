import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";

import {
  builtinTools,
  metaToolDefinitions,
  shellExecuteTool,
  dockerExecuteTool,
  todoTool,
  requestUserInputTool,
  activateSkillTool,
  ragIngestTool,
  relateTool,
  scratchpadWriteTool,
  scratchpadReadTool,
  defineTool,
  isReadOnlyTool,
  readOnlyTools,
} from "../src/index.js";
import type { ToolDefinition } from "../src/types.js";

const ALL: ReadonlyArray<ToolDefinition> = [
  ...builtinTools.map((t) => t.definition),
  ...metaToolDefinitions,
  shellExecuteTool,
  dockerExecuteTool,
  todoTool,
  requestUserInputTool,
  activateSkillTool,
  ragIngestTool,
  scratchpadWriteTool,
  scratchpadReadTool,
];

const EXPECTED_READ_ONLY: Record<string, boolean> = {
  "web-search": true,
  "crypto-price": true,
  "http-get": true,
  "file-read": true,
  "list-directory": true,
  grep: true,
  "file-write": false,
  "file-edit": false,
  "code-execute": false,
  "shell-execute": false,
  "docker-execute": false,
  "context-status": true,
  "final-answer": true,
  brief: true,
  find: true,
  pulse: true,
  recall: true,
  relate: false,
  checkpoint: true,
  "discover-tools": true,
  todo: true,
  request_user_input: true,
  "activate-skill": true,
  "rag-ingest": false,
  "scratchpad-write": true,
  "scratchpad-read": true,
};

describe("built-in read-only classification", () => {
  it("covers every built-in exactly (no unclassified tool)", () => {
    expect(ALL.map((d) => d.name).sort()).toEqual(Object.keys(EXPECTED_READ_ONLY).sort());
  });

  for (const def of ALL) {
    it(`${def.name} => readOnly=${EXPECTED_READ_ONLY[def.name]}`, () => {
      expect(def.mutatesExternalState).toBeDefined();
      expect(isReadOnlyTool(def)).toBe(EXPECTED_READ_ONLY[def.name]);
    });
  }

  it("mutating tools set the flag true, never merely approval-gated", () => {
    for (const name of ["file-write", "file-edit", "code-execute", "shell-execute", "docker-execute"]) {
      expect(ALL.find((d) => d.name === name)?.mutatesExternalState).toBe(true);
    }
  });

  it("persistent-write tools (shared doc store, memory graph) are not read-only", () => {
    expect(ragIngestTool.mutatesExternalState).toBe(true);
    expect(isReadOnlyTool(ragIngestTool)).toBe(false);
    expect(isReadOnlyTool(relateTool)).toBe(false);
  });

  it("readOnlyTools filters to the read-only subset", () => {
    const names = readOnlyTools(ALL).map((d) => d.name);
    expect(names).toContain("file-read");
    expect(names).toContain("http-get");
    expect(names).not.toContain("file-write");
    expect(names).not.toContain("shell-execute");
  });
});

describe("fail-closed for unknown tools", () => {
  it("defineTool default is not read-only", () => {
    const t = defineTool({
      name: "user-tool",
      description: "x",
      input: Schema.Struct({}),
      handler: () => Effect.succeed("ok"),
    });
    expect(t.definition.mutatesExternalState).toBeUndefined();
    expect(isReadOnlyTool(t.definition)).toBe(false);
  });

  it("omitted flag is not read-only; approval overrides a false flag", () => {
    expect(isReadOnlyTool({ requiresApproval: false })).toBe(false);
    expect(isReadOnlyTool({ mutatesExternalState: false, requiresApproval: true })).toBe(false);
    expect(isReadOnlyTool({ mutatesExternalState: false, requiresApproval: false })).toBe(true);
  });
});
