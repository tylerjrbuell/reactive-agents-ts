/**
 * Seam pin: one namespace for `.withTools({ builtins })` (parent decision
 * 2026-11-06 on skills-and-extension-model spec §12.8 Q1).
 *
 * `builtins: "x"` is sugar for `builtins: ["x"]`: names resolve through the
 * tools-owned `BUILTIN_TOOLSET_ALIASES` exactly like array entries, the
 * runtime owns no member lists, and both spellings give the same permitted
 * set. A single name that resolves to nothing is a ToolsOptionError. Plus the
 * build notice for an agent with zero capability tools.
 */
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Either } from "effect";
import { BUILTIN_TOOLSET_ALIASES } from "@reactive-agents/tools";
import { builtinsAsList, isKnownBuiltinName, normalizeBuiltinsOption } from "../src/builder/builtins-option";
import { computeExposedToolNames, noCapabilityToolsNotice } from "../src/builder/contract-tool-set";
import { asBuilderState } from "../src/builder/withers/_state";
import { ReactiveAgents, ToolsOptionError } from "../src";

const hasReadAlias = Object.prototype.hasOwnProperty.call(BUILTIN_TOOLSET_ALIASES, "read");

/** Permitted built-in set the agent ends up with for one `.withTools()` call. */
const permitted = (builtins: string | readonly string[]): string[] => {
  const s = asBuilderState(ReactiveAgents.create().withTools({ builtins }));
  return computeExposedToolNames(s._toolsOptions).sort();
};

describe("builtins: one namespace", () => {
  const NAMES = [...Object.keys(BUILTIN_TOOLSET_ALIASES), "all", "*", "file-read", "Research"];

  it.each(NAMES)('builtins: "%s" and builtins: ["%s"] give the same stored value and permitted set', (name) => {
    const scalar = asBuilderState(ReactiveAgents.create().withTools({ builtins: name }))._toolsOptions?.builtins;
    const list = asBuilderState(ReactiveAgents.create().withTools({ builtins: [name] }))._toolsOptions?.builtins;
    expect(scalar).toEqual([name]);
    expect(scalar).toEqual(list);
    expect(permitted(name)).toEqual(permitted([name]));
    expect(permitted(name).length).toBeGreaterThan(0);
  });

  it('"research" keeps its tools-owned members (not widened by the runtime)', () => {
    expect(permitted("research")).toEqual([...(BUILTIN_TOOLSET_ALIASES["research"] ?? [])].sort());
  });

  it.skipIf(!hasReadAlias)('"read" resolves through the tools alias table', () => {
    expect(permitted("read")).toEqual([...(BUILTIN_TOOLSET_ALIASES["read"] ?? [])].sort());
  });

  it("runtime config receives the list form", () => {
    expect(builtinsAsList("web")).toEqual(["web"]);
    expect(builtinsAsList(true)).toBe(true);
    expect(builtinsAsList(["a"])).toEqual(["a"]);
    expect(builtinsAsList(undefined)).toBeUndefined();
  });

  it("a single unknown name is a ToolsOptionError; an array entry keeps its old behavior", () => {
    expect(isKnownBuiltinName("reed")).toBe(false);
    const bad = normalizeBuiltinsOption("reed");
    expect(Either.isLeft(bad) && bad.left._tag).toBe("ToolsOptionError");
    expect(() => ReactiveAgents.create().withTools({ builtins: "reed" })).toThrow(ToolsOptionError);
    expect(() => ReactiveAgents.create().withTools({ builtins: ["reed"] })).not.toThrow();
  });

  it("there is no workspace preset: the scalar resolves to the tools alias like the array", () => {
    expect(permitted("workspace")).toEqual(permitted(["workspace"]));
  });

  it("workspace confinement comes from workspace:, not from the builtins name", () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-builtins-ws-"));
    try {
      const s = asBuilderState(ReactiveAgents.create().withTools({ builtins: "file-read", workspace: dir }));
      expect(s._toolsOptions?.builtins).toEqual(["file-read"]);
      expect(s._toolsOptions?.workspace).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("zero-capability-tools notice", () => {
  const base = { requiredTools: undefined, hasMcpServers: false, hasAgentTools: false, hasDocuments: false };

  it("names only toolsets that exist, with their tools-owned members", () => {
    const notice = noCapabilityToolsNotice({ ...base, toolsOptions: {} }) ?? "";
    expect(notice).toContain(`builtins: "research" (${(BUILTIN_TOOLSET_ALIASES["research"] ?? []).join(", ")})`);
    expect(notice.includes('builtins: "read"')).toBe(hasReadAlias);
    expect(notice).toContain('workspace: "<dir>"');
  });

  it("is silent when any capability source exists", () => {
    expect(noCapabilityToolsNotice({ ...base, toolsOptions: { builtins: ["file-read"] } })).toBeUndefined();
    expect(noCapabilityToolsNotice({ ...base, toolsOptions: { builtins: "web" } })).toBeUndefined();
    expect(noCapabilityToolsNotice({ ...base, toolsOptions: { terminal: true } })).toBeUndefined();
    expect(noCapabilityToolsNotice({ ...base, toolsOptions: {}, requiredTools: ["web-search"] })).toBeUndefined();
    expect(noCapabilityToolsNotice({ ...base, toolsOptions: {}, hasMcpServers: true })).toBeUndefined();
    expect(noCapabilityToolsNotice({ ...base, toolsOptions: {}, hasAgentTools: true })).toBeUndefined();
    expect(noCapabilityToolsNotice({ ...base, toolsOptions: {}, hasDocuments: true })).toBeUndefined();
  });

  it("fires for an array entry that matches nothing", () => {
    expect(noCapabilityToolsNotice({ ...base, toolsOptions: { builtins: ["reed"] } })).toBeDefined();
  });

  describe("build emits it once", () => {
    const spies: Array<ReturnType<typeof spyOn>> = [];
    afterEach(() => {
      for (const s of spies.splice(0)) s.mockRestore();
    });
    const captured = (): string[] => {
      const lines: string[] = [];
      for (const method of ["log", "warn", "error", "info"] as const) {
        spies.push(
          spyOn(console, method).mockImplementation((...args: unknown[]) => {
            lines.push(args.map(String).join(" "));
          }),
        );
      }
      return lines;
    };
    const noticeCount = (lines: readonly string[]) =>
      lines.filter((l) => l.includes("has no capability tools")).length;

    it("for .withTools() with no tools", async () => {
      const lines = captured();
      const agent = await ReactiveAgents.create().withTestScenario([{ text: "FINAL ANSWER: ok" }]).withTools().build();
      await agent.dispose();
      expect(noticeCount(lines)).toBe(1);
    });

    it('not for .withTools({ builtins: "research" })', async () => {
      const lines = captured();
      const agent = await ReactiveAgents.create()
        .withTestScenario([{ text: "FINAL ANSWER: ok" }])
        .withTools({ builtins: "research" })
        .build();
      await agent.dispose();
      expect(noticeCount(lines)).toBe(0);
    });

    it("not when tools are never enabled", async () => {
      const lines = captured();
      const agent = await ReactiveAgents.create().withTestScenario([{ text: "FINAL ANSWER: ok" }]).build();
      await agent.dispose();
      expect(noticeCount(lines)).toBe(0);
    });
  });
});
