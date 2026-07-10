// Run: bun test packages/runtime/tests/meta-tools-default-surface.test.ts
//
// The default toolbox was 67% meta-tools the model never called.
//
// WIRE-MEASURED 2026-07-10 (logging proxy in front of Ollama): a default
// `.withTools({builtins:[3 file tools]})` agent sent 8 tool schemas per
// request — brief (~234 tok), pulse (~245), find (~221), recall (~423),
// discover-tools (~141) alongside the 3 asked for. 5,062 of 7,472 schema
// chars, EVERY request; live traces showed ZERO meta-tool calls. Worse:
// `find`'s scope:"auto" silently fell back to WEB SEARCH — a caller who
// allowlisted two file tools got network egress, and that web search is where
// claude-haiku-4-5 got the exchange rate it fabricated with (2026-07-09).
//
// Leading harnesses (Claude Agent SDK / Claude Code) expose task tools only;
// harness state is injected into the prompt, not offered back to the model as
// callable schemas. New policy, four tiers:
//
//   not called             → recall (+find IFF .withDocuments()); brief/pulse OFF
//   .withMetaTools()       → full suite (explicit opt-in, unchanged)
//   .withMetaTools({...})  → exactly what you name (unchanged)
//   .withMetaTools(false)  → none (unchanged)
//
// ORACLE: the framework's OWN trace. `llm-exchange` events record
// `toolSchemaNames` — the schema list of the actual provider request, the
// boundary the wire proxy proved authoritative. Asserting here (a) pins the
// exposure where the model experiences it, and (b) keeps the trace loop
// itself exercised in CI. The earlier scenario-based draft of this test
// "passed" for unregistered tools because a test-scenario call to an unknown
// tool vanishes silently — config- and behavior-level oracles both lied;
// the request record does not.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src";

const TRACE_DIR = mkdtempSync(join(tmpdir(), "ra-meta-surface-"));
const PRIOR_DIR = process.env.REACTIVE_AGENTS_TRACE_DIR;
const PRIOR_FLAG = process.env.REACTIVE_AGENTS_TRACE;
process.env.REACTIVE_AGENTS_TRACE_DIR = TRACE_DIR;
delete process.env.REACTIVE_AGENTS_TRACE; // ensure tracing is not env-disabled

afterAll(() => {
  if (PRIOR_DIR === undefined) delete process.env.REACTIVE_AGENTS_TRACE_DIR;
  else process.env.REACTIVE_AGENTS_TRACE_DIR = PRIOR_DIR;
  if (PRIOR_FLAG !== undefined) process.env.REACTIVE_AGENTS_TRACE = PRIOR_FLAG;
  rmSync(TRACE_DIR, { recursive: true, force: true });
});

/** Union of toolSchemaNames across every request the run sent. */
const exposedToolNames = async (
  configure: (b: ReturnType<typeof ReactiveAgents.create>) => ReturnType<typeof ReactiveAgents.create>,
): Promise<Set<string>> => {
  const before = new Set(readdirSync(TRACE_DIR));
  const agent = await configure(
    ReactiveAgents.create()
      .withProvider("test")
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(2),
  ).build();
  try {
    await agent.run("do a small thing and answer");
  } finally {
    await agent.dispose();
  }
  const names = new Set<string>();
  for (const f of readdirSync(TRACE_DIR)) {
    if (before.has(f)) continue;
    for (const line of readFileSync(join(TRACE_DIR, f), "utf8").split("\n")) {
      if (!line.includes('"llm-exchange"')) continue;
      const e = JSON.parse(line) as { toolSchemaNames?: readonly string[] };
      for (const n of e.toolSchemaNames ?? []) names.add(n);
    }
  }
  return names;
};

describe("DEFAULT (no .withMetaTools): task-facing set only", () => {
  test("brief/pulse/find are ABSENT from every request", async () => {
    // recall is deliberately NOT asserted present: it carries its own
    // ablation-validated overflow gate (filterRecallByOverflow, default-on
    // since Phase-3) and appears only once a stored key is visible in the
    // window — schema tokens only when there is something to recall. That
    // gate is pinned in the reasoning package; here we pin only that the
    // introspection suite stays out of the request.
    const names = await exposedToolNames((b) => b.withTools({ builtins: ["file-read"] }));
    expect(names.size).toBeGreaterThan(0); // the oracle itself is alive
    expect(names.has("file-read")).toBe(true);
    expect(names.has("brief")).toBe(false);
    expect(names.has("pulse")).toBe(false);
    expect(names.has("find")).toBe(false);
  });

  test("find appears when documents are configured — their retrieval surface", async () => {
    const names = await exposedToolNames((b) =>
      b
        .withTools({ builtins: ["file-read"] })
        .withDocuments([{ content: "Refund policy: 30 days.", source: "policy" }]),
    );
    expect(names.has("find")).toBe(true);
    expect(names.has("brief")).toBe(false); // documents do not drag the rest in
  });
});

describe("explicit tiers are unchanged", () => {
  test(".withMetaTools() bare → the full suite (recall still overflow-gated)", async () => {
    const names = await exposedToolNames((b) => b.withTools().withMetaTools());
    for (const t of ["brief", "pulse", "find"]) expect(names.has(t)).toBe(true);
  });

  test(".withMetaTools({pulse:true}) → pulse yes, brief no", async () => {
    const names = await exposedToolNames((b) => b.withTools().withMetaTools({ pulse: true }));
    expect(names.has("pulse")).toBe(true);
    expect(names.has("brief")).toBe(false);
  });

  test(".withMetaTools(false) → no meta-tools, recall included", async () => {
    const names = await exposedToolNames((b) =>
      b.withTools({ builtins: ["file-read"] }).withMetaTools(false),
    );
    expect(names.has("recall")).toBe(false);
    expect(names.has("brief")).toBe(false);
    expect(names.has("file-read")).toBe(true); // task tools untouched
  });
});

describe("the harness skill teaches only what is callable", () => {
  test("default-set skill never mentions brief/pulse/find", async () => {
    const { buildHarnessSkill } = await import("../src/harness-resolver.js");
    const skill = buildHarnessSkill("local", { recall: true });
    expect(skill).toContain("recall");
    for (const absent of ["brief", "pulse", "find"]) expect(skill).not.toContain(absent);
  });

  test("full-suite skill mentions all four", async () => {
    const { buildHarnessSkill } = await import("../src/harness-resolver.js");
    const skill = buildHarnessSkill("frontier", { brief: true, find: true, pulse: true, recall: true });
    for (const t of ["brief", "find", "pulse", "recall"]) expect(skill).toContain(t);
  });

  test("nothing enabled → no skill text at all (no empty reference block)", async () => {
    const { buildHarnessSkill } = await import("../src/harness-resolver.js");
    expect(buildHarnessSkill("local", {})).toBeNull();
  });
});

describe("the recall schema is the slim four-mode surface", () => {
  test("advertised parameters are key/content/query/full only", async () => {
    const { recallTool } = await import("@reactive-agents/tools");
    const names = recallTool.parameters.map((p) => p.name);
    expect(names.sort()).toEqual(["content", "full", "key", "query"]);
  });

  test("the handler still honors a segmented read at runtime (back-compat)", async () => {
    const { makeRecallHandler } = await import("@reactive-agents/tools");
    const { Ref, Effect } = await import("effect");
    const store = await Effect.runPromise(Ref.make(new Map([["big", "x".repeat(1_000)]])));
    const out = await Effect.runPromise(makeRecallHandler(store)({ key: "big", start: 10, maxChars: 5 }));
    expect(JSON.stringify(out)).toContain("xxxxx");
  });
});
