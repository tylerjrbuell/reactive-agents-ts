import { describe, expect, test } from "bun:test";
import { attachRow, effectsLines, effectsOf, type AttachServer, type EffectsCfg } from "./mcp-attach.js";

const srv = (over: Partial<AttachServer> = {}): AttachServer => ({
  serverId: "s1",
  name: "files",
  tools: [{ toolName: "files/read" }, { toolName: "files/write" }],
  ...over,
});
const cfg = (over: Partial<EffectsCfg> = {}): EffectsCfg => ({ tools: [], mcpServerIds: [], terminalTools: false, ...over });

describe("attachRow: the attach rule is tool-selection's (attached = all, named = subset)", () => {
  test("off, all, subset follow the config", () => {
    expect(attachRow(cfg(), srv()).mode).toBe("off");
    const all = attachRow(cfg({ mcpServerIds: ["s1"] }), srv());
    expect(all).toMatchObject({ mode: "all", available: 2, total: 2, canToggle: true });
    expect(all.note).toContain("Every tool is available");
    const subset = attachRow(cfg({ mcpServerIds: ["s1"], tools: ["files/read"] }), srv());
    expect(subset).toMatchObject({ mode: "subset", available: 1 });
    expect(subset.note).toContain("Only the highlighted tools");
  });

  test("a server with no cached tools cannot be attached and says how to fix it", () => {
    const r = attachRow(cfg(), srv({ tools: [] }));
    expect(r.canToggle).toBe(false);
    expect(r.note).toContain("Refresh the server");
  });

  test("a disabled server cannot be attached, but one already attached can be detached", () => {
    const off = attachRow(cfg(), srv({ enabled: false }));
    expect(off).toMatchObject({ disabled: true, canToggle: false });
    expect(off.nameTip).toContain("Enable it in Lab");
    const attached = attachRow(cfg({ mcpServerIds: ["s1"] }), srv({ enabled: false }));
    expect(attached).toMatchObject({ disabled: true, canToggle: true, nameTip: "Stop using this server" });
    expect(attached.note).toContain("an agent skips it");
  });

  test("a server from an older build with no enabled field reads as on", () => {
    expect(attachRow(cfg(), srv()).disabled).toBe(false);
  });
});

describe("effectsOf", () => {
  test("read-only tools: attached, enabled servers only, covered by the readOnly option", () => {
    const servers = [srv({ config: { readOnly: ["read"] } }), srv({ serverId: "s2", name: "db", tools: [{ toolName: "db/q" }], config: { readOnly: true } })];
    expect(effectsOf(cfg({ mcpServerIds: ["s1"] }), servers, []).readOnly).toEqual(["files/read"]);
    expect(effectsOf(cfg({ mcpServerIds: ["s1", "s2"] }), servers, []).readOnly).toEqual(["files/read", "db/q"]);
    expect(effectsOf(cfg(), servers, []).readOnly).toEqual([]);
    expect(effectsOf(cfg({ mcpServerIds: ["s2"] }), [{ ...servers[1]!, enabled: false }], []).readOnly).toEqual([]);
  });

  test("a subset only counts the named tools", () => {
    const servers = [srv({ config: { readOnly: true } })];
    expect(effectsOf(cfg({ mcpServerIds: ["s1"], tools: ["files/write"] }), servers, []).readOnly).toEqual(["files/write"]);
  });

  test("approval: selected tools the framework gates, shell-execute when the host shell is on", () => {
    const required = ["file-write", "code-execute", "shell-execute"];
    expect(effectsOf(cfg({ tools: ["file-write"] }), [], required).approval).toEqual(["file-write"]);
    expect(effectsOf(cfg({ terminalTools: true }), [], required).approval).toEqual(["shell-execute"]);
    expect(effectsOf(cfg({ tools: ["file-write"], askBeforeRiskyTools: false }), [], required).approval).toEqual([]);
  });

  test("shell: off, host or docker", () => {
    expect(effectsOf(cfg(), [], []).shell).toBe("off");
    expect(effectsOf(cfg({ terminalTools: true }), [], []).shell).toBe("host");
    expect(effectsOf(cfg({ terminalTools: true, terminalShellOptions: { sandbox: "docker" } }), [], []).shell).toBe("docker");
    expect(effectsOf(cfg({ tools: ["shell-execute"] }), [], []).shell).toBe("host");
  });
});

describe("effectsLines", () => {
  test("empty and populated wording", () => {
    const none = effectsLines({ readOnly: [], approval: [], shell: "off" });
    expect(none.map((l) => l.label)).toEqual(["No read-only MCP tools", "Nothing asks first", "Shell off"]);
    const some = effectsLines({ readOnly: ["a/b"], approval: ["file-write", "code-execute"], shell: "host" });
    expect(some.map((l) => l.label)).toEqual(["1 read-only MCP tool", "2 tools ask first", "Shell on this machine"]);
    expect(some[2]?.names).toEqual(["shell-execute"]);
  });
});
