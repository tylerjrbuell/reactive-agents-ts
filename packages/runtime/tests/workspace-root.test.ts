// Run: bun test packages/runtime/tests/workspace-root.test.ts --timeout 20000
//
// Agent working directory: `.withTools({ workspace })` and the per-run
// `run(task, { workspace })` / `runStream` / `runEffect` override.
//
// The workspace binds the run-scoped file root (`engine/start-run.ts`), so the
// file tools resolve relative paths against it and refuse paths outside it, and
// `shell-execute` runs with it as its working directory. Precedence:
// run option > builder option > ambient `withFileRoot()` > none.
//
// RED-ON-CUT (verified by temporary mutation):
// - drop the workspace branch in `startRun`: the builder, run-override,
//   runStream, sub-agent and precedence cells fail (writes land elsewhere).
// - drop the run-root wrapper in `tool-init-layer.ts`: the shell cell fails
//   (`pwd` prints the /tmp sandbox, not the workspace).
import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentEvent } from "@reactive-agents/core";
import { withFileRoot } from "@reactive-agents/tools";
import { Effect } from "effect";
import { ReactiveAgents, ToolsOptionError, agentConfigToBuilder } from "../src/index.js";

const roots: string[] = [];
const strays: string[] = [];
const mkRoot = (tag: string): string => {
  const r = mkdtempSync(join(tmpdir(), `ra-workspace-${tag}-`));
  roots.push(r);
  return r;
};
afterEach(() => {
  for (const p of strays.splice(0)) rmSync(p, { force: true });
});
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

type ToolDone = { readonly toolName: string; readonly success: boolean; readonly result?: unknown; readonly error?: unknown };

const writeAgent = (name: string, workspace?: string) =>
  ReactiveAgents.create()
    .withName("workspace-write")
    .withProvider("test")
    .withModel("test")
    .withTestScenario([
      { match: "Write", text: "Writing.", toolCall: { name: "file-write", args: { path: name, content: "export {}\n" } } },
      { text: "FINAL ANSWER: done." },
    ] as never)
    .withTools({ builtins: ["file-write"], adaptive: false, ...(workspace !== undefined ? { workspace } : {}) })
    .withMaxIterations(4)
    .build();

describe("workspace: file tools resolve and confine to the agent's working directory", () => {
  it("builder workspace: a relative file-write lands in the workspace", async () => {
    const ws = mkRoot("builder");
    const name = `ws-builder-${randomUUID()}.ts`;
    strays.push(join(process.cwd(), name));
    const agent = await writeAgent(name, ws);
    try {
      await agent.run(`Write ${name}`);
    } finally {
      await agent.dispose();
    }
    expect(existsSync(join(process.cwd(), name))).toBe(false);
    expect(existsSync(join(ws, name))).toBe(true);
  }, 20000);

  it("run({ workspace }) overrides the builder workspace for that run only", async () => {
    const builderWs = mkRoot("b");
    const runWs = mkRoot("r");
    const name = `ws-override-${randomUUID()}.ts`;
    strays.push(join(process.cwd(), name));
    const agent = await writeAgent(name, builderWs);
    try {
      await agent.run(`Write ${name}`, { workspace: runWs });
    } finally {
      await agent.dispose();
    }
    expect(existsSync(join(runWs, name))).toBe(true);
    expect(existsSync(join(builderWs, name))).toBe(false);
  }, 20000);

  it("runStream({ workspace }): the write lands in the run's workspace", async () => {
    const ws = mkRoot("stream");
    const name = `ws-stream-${randomUUID()}.ts`;
    strays.push(join(process.cwd(), name));
    const agent = await writeAgent(name);
    try {
      for await (const _ev of agent.runStream(`Write ${name}`, { workspace: ws })) {
        // drain
      }
    } finally {
      await agent.dispose();
    }
    expect(existsSync(join(process.cwd(), name))).toBe(false);
    expect(existsSync(join(ws, name))).toBe(true);
  }, 20000);

  it("runEffect({ workspace }): the write lands in the run's workspace", async () => {
    const ws = mkRoot("effect");
    const name = `ws-effect-${randomUUID()}.ts`;
    strays.push(join(process.cwd(), name));
    const agent = await writeAgent(name);
    try {
      await Effect.runPromise(agent.runEffect(`Write ${name}`, { workspace: ws }));
    } finally {
      await agent.dispose();
    }
    expect(existsSync(join(ws, name))).toBe(true);
  }, 20000);

  it("a path outside the workspace is refused", async () => {
    const ws = mkRoot("confine");
    const outside = mkRoot("outside");
    const target = join(outside, `ws-escape-${randomUUID()}.ts`);
    const agent = await writeAgent(target, ws);
    const writes: ToolDone[] = [];
    await agent.subscribe((e: AgentEvent) => {
      if (e._tag === "ToolCallCompleted" && e.toolName === "file-write") writes.push(e);
    });
    try {
      // The refused write fails the run; the bare builder then rejects. Only the refusal matters here.
      await agent.run(`Write ${target}`).catch(() => undefined);
    } finally {
      await agent.dispose();
    }
    expect(writes.length).toBeGreaterThan(0);
    expect(existsSync(target)).toBe(false);
    expect(writes.every((w) => !w.success)).toBe(true);
    expect(JSON.stringify(writes)).toContain("Path traversal");
  }, 20000);

  it("builder workspace wins over an ambient withFileRoot(); with no workspace the ambient root still works", async () => {
    const ws = mkRoot("prec-ws");
    const ambient = mkRoot("prec-ambient");
    const a = `ws-prec-a-${randomUUID()}.ts`;
    strays.push(join(process.cwd(), a));
    const withWs = await writeAgent(a, ws);
    try {
      await withFileRoot(ambient, () => withWs.run(`Write ${a}`));
    } finally {
      await withWs.dispose();
    }
    expect(existsSync(join(ws, a))).toBe(true);
    expect(existsSync(join(ambient, a))).toBe(false);

    const b = `ws-prec-b-${randomUUID()}.ts`;
    strays.push(join(process.cwd(), b));
    const noWs = await writeAgent(b);
    try {
      await withFileRoot(ambient, () => noWs.run(`Write ${b}`));
    } finally {
      await noWs.dispose();
    }
    expect(existsSync(join(ambient, b))).toBe(true);
  }, 20000);

  it("a dynamic sub-agent resolves relative paths against the parent's workspace", async () => {
    const ws = mkRoot("parent");
    const file = `ws-child-${randomUUID()}.txt`;
    writeFileSync(join(ws, file), "CHILD-SAW-WORKSPACE-41c2");
    const agent = await ReactiveAgents.create()
      .withName("workspace-parent")
      .withProvider("test")
      .withModel("test")
      .withDynamicSubAgents({ maxIterations: 3 })
      .withTools({ adaptive: false, workspace: ws })
      .withTestScenario([
        { match: "KIDTASK", toolCall: { name: "file-read", args: { path: file } } },
        { match: "ROOTTASK", toolCall: { name: "spawn-agent", args: { task: "KIDTASK read the file", name: "kid", tools: ["file-read"] } } },
        { text: "FINAL ANSWER: done." },
      ] as never)
      .withMaxIterations(4)
      .build();
    const reads: ToolDone[] = [];
    await agent.subscribe((e: AgentEvent) => {
      if (e._tag === "ToolCallCompleted" && e.toolName === "file-read") reads.push(e);
    });
    try {
      await agent.run("ROOTTASK: delegate the read.");
    } finally {
      await agent.dispose();
    }
    expect(reads.some((r) => r.success && JSON.stringify(r.result).includes("CHILD-SAW-WORKSPACE-41c2"))).toBe(true);
  }, 20000);
});

describe("workspace: shell-execute runs in the workspace", () => {
  type Terminal = true | { readonly cwd?: string; readonly allowUnsafeCwd?: boolean };
  const shellAgent = (workspace?: string, terminal: Terminal = true) =>
    ReactiveAgents.create()
      .withName("workspace-shell")
      .withProvider("test")
      .withModel("test")
      .withTestScenario([
        { match: "Print", text: "Running.", toolCall: { name: "shell-execute", args: { command: "pwd" } } },
        { text: "FINAL ANSWER: done." },
      ] as never)
      .withTools({ terminal, adaptive: false, ...(workspace !== undefined ? { workspace } : {}) })
      .withMaxIterations(4)
      .build();

  const runPwd = async (workspace: string | undefined, runWorkspace?: string, terminal: Terminal = true): Promise<string> => {
    const agent = await shellAgent(workspace, terminal);
    const done: ToolDone[] = [];
    await agent.subscribe((e: AgentEvent) => {
      if (e._tag === "ToolCallCompleted" && e.toolName === "shell-execute") done.push(e);
    });
    try {
      await agent.run("Print the working directory", runWorkspace !== undefined ? { workspace: runWorkspace } : undefined);
    } finally {
      await agent.dispose();
    }
    expect(done.length).toBeGreaterThan(0);
    return JSON.stringify(done.map((d) => d.result ?? d.error));
  };

  it("builder workspace: `pwd` prints the workspace", async () => {
    const ws = mkRoot("shell");
    expect(await runPwd(ws)).toContain(ws);
  }, 20000);

  it("run({ workspace }): `pwd` prints the run's workspace", async () => {
    const builderWs = mkRoot("shell-b");
    const runWs = mkRoot("shell-r");
    const out = await runPwd(builderWs, runWs);
    expect(out).toContain(runWs);
    expect(out).not.toContain(builderWs);
  }, 20000);

  it("a relative terminal.cwd resolves inside the workspace", async () => {
    const ws = mkRoot("shell-sub");
    mkdirSync(join(ws, "pkg"));
    expect(await runPwd(ws, undefined, { cwd: "pkg" })).toContain(join(ws, "pkg"));
  }, 20000);

  it("a terminal.cwd outside the workspace is refused; allowUnsafeCwd lets it run there", async () => {
    const ws = mkRoot("shell-in");
    const outside = mkRoot("shell-out");
    const refused = await runPwd(ws, undefined, { cwd: outside });
    expect(refused).toContain("outside the workspace");
    expect(await runPwd(ws, undefined, { cwd: outside, allowUnsafeCwd: true })).toContain(outside);
  }, 20000);

  it("CONTROL: no workspace — `pwd` prints the default /tmp sandbox", async () => {
    expect(await runPwd(undefined)).toContain("rax-sandbox-");
  }, 20000);
});

describe("workspace: validation and config round-trip", () => {
  it("withTools({ workspace }) with a missing directory throws ToolsOptionError", () => {
    const missing = join(tmpdir(), `ra-workspace-missing-${randomUUID()}`);
    expect(() => ReactiveAgents.create().withTools({ workspace: missing })).toThrow(ToolsOptionError);
  });

  it("withTools({ workspace }) naming a file, not a directory, throws ToolsOptionError", () => {
    const ws = mkRoot("file");
    const file = join(ws, "not-a-dir.txt");
    writeFileSync(file, "x");
    expect(() => ReactiveAgents.create().withTools({ workspace: file })).toThrow(ToolsOptionError);
  });

  it("run({ workspace }) with a missing directory rejects naming the option and writes nothing", async () => {
    const name = `ws-badrun-${randomUUID()}.ts`;
    strays.push(join(process.cwd(), name));
    const agent = await writeAgent(name);
    const missing = join(tmpdir(), `ra-workspace-missing-${randomUUID()}`);
    try {
      const err = await agent.run(`Write ${name}`, { workspace: missing }).then(
        () => undefined,
        (e: unknown) => e,
      );
      // run() rejects with its one-line boundary error (agent/run-contract.ts).
      expect(String(err)).toContain(`run({ workspace }): '${missing}' does not exist`);
      expect(String(err)).not.toContain("Unexpected error");
      const effectErr = await Effect.runPromise(Effect.flip(agent.runEffect(`Write ${name}`, { workspace: missing })));
      expect(effectErr.message).toContain("does not exist");
    } finally {
      await agent.dispose();
    }
    expect(existsSync(join(process.cwd(), name))).toBe(false);
  }, 20000);

  it("runStream({ workspace }) with a missing directory ends in StreamError without throwing", async () => {
    const name = `ws-badstream-${randomUUID()}.ts`;
    strays.push(join(process.cwd(), name));
    const agent = await writeAgent(name);
    const missing = join(tmpdir(), `ra-workspace-missing-${randomUUID()}`);
    const tags: string[] = [];
    try {
      for await (const ev of agent.runStream(`Write ${name}`, { workspace: missing })) tags.push(ev._tag);
    } finally {
      await agent.dispose();
    }
    expect(tags.at(-1)).toBe("StreamError");
    expect(existsSync(join(process.cwd(), name))).toBe(false);
  }, 20000);

  it("toConfig() carries tools.workspace as an absolute path and agentConfigToBuilder restores it", async () => {
    const ws = mkRoot("config");
    const config = ReactiveAgents.create().withName("cfg").withProvider("test").withTools({ workspace: ws }).toConfig();
    expect(config.tools?.workspace).toBe(ws);
    const name = `ws-config-${randomUUID()}.ts`;
    strays.push(join(process.cwd(), name));
    const restored = await (await agentConfigToBuilder(config))
      .withTestScenario([
        { match: "Write", toolCall: { name: "file-write", args: { path: name, content: "x" } } },
        { text: "FINAL ANSWER: done." },
      ] as never)
      .withTools({ builtins: ["file-write"], adaptive: false })
      .withMaxIterations(4)
      .build();
    try {
      await restored.run(`Write ${name}`);
    } finally {
      await restored.dispose();
    }
    expect(readFileSync(join(ws, name), "utf8")).toBe("x");
  }, 20000);
});
