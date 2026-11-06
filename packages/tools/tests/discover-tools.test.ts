// Run: bun test packages/tools/tests/discover-tools.test.ts
//
// discover-tools must be HONEST. Root fix 2026-08-06: a query hunting a
// capability the permitted surface lacks ("read file" when only file-write is
// registered) used to return file-write as a confident match — the +1-per-token
// scorer hit "file" — and the model, told a read tool existed, thrashed and
// fabricated. The handler now applies a relevance floor and, on exhaustion,
// lists the COMPLETE set with an explicit "capability NOT available" signal.
import { describe, it, expect } from "bun:test";
import { Effect, Ref } from "effect";
import {
  makeDiscoverToolsHandler,
  type DiscoverableTool,
  type DiscoverToolsState,
} from "../src/skills/discover-tools.js";

const CATALOG: DiscoverableTool[] = [
  {
    name: "file-write",
    description:
      "Write text to a file, creating parent directories as needed (overwrites existing content).",
    parameters: [{ name: "path", type: "string", required: true }],
  },
  {
    name: "web-search",
    description: "Search the web and return the top results for a query.",
    parameters: [{ name: "query", type: "string", required: true }],
  },
];

async function run(query: string | undefined, catalog = CATALOG): Promise<string> {
  const discoveredRef = await Effect.runPromise(Ref.make(new Set<string>()));
  const state: DiscoverToolsState = {
    getAllToolDefinitions: () => catalog,
    discoveredRef,
  };
  const handler = makeDiscoverToolsHandler(state);
  const args = query === undefined ? {} : { query };
  return String(await Effect.runPromise(handler(args)));
}

describe("discover-tools handler — honesty", () => {
  it("does NOT report file-write as a match for a READ query (incidental token)", async () => {
    const out = await run("read file");
    // The old bug: "Top 1 tools matching 'read file' (now callable): file-write".
    expect(out).not.toContain("matching");
    expect(out).toContain("COMPLETE set");
    expect(out).toContain("NOT");
  });

  it("still lists the full set on an exhaustion answer so the model has ground truth", async () => {
    const out = await run("read file");
    // No pointer to a "## Skills" section that may not exist (audit 2026-11-06 row 9).
    expect(out).not.toContain("## Skills");
    expect(out).toContain("file-write");
    expect(out).toContain("web-search");
  });

  it("DOES return a confident match when the query clearly relates", async () => {
    const out = await run("search the web");
    expect(out).toContain("matching");
    expect(out).toContain("Skills are not listed here");
    expect(out).toContain("web-search");
    expect(out).not.toContain("file-write");
  });

  it("lists everything when no query is given", async () => {
    const out = await run(undefined);
    expect(out).toContain("2 TOOLS available");
    expect(out).toContain("Skills are not listed here");
    expect(out).toContain("file-write");
    expect(out).toContain("web-search");
  });

});

// An empty PERMITTED catalog is not an empty registry. Surface-hiding spike
// 2026-11-06 (acf2e652d): with builtins opt-in, 12 builtins were registered
// but filtered out of the run's catalog, and discover-tools answered "No tools
// registered." — a false claim. The catalog it sees is the run's permitted
// surface only; the text must say what it can and cannot see.
// Task-relevant appendix. A query answer ranks only the model's query, but the
// kernel already knows which tools the TASK needs. Live run (strict discover):
// query "crypto prices" returned crypto-price only; the task also needed
// web-search and the model never queried again. The kernel supplies its
// task-relevance ranking; discover-tools appends the unmatched ones and marks
// them discovered so they are callable next response. Synthetic fixtures only.
describe("discover-tools handler — task-relevant appendix", () => {
  const TASK_CATALOG: DiscoverableTool[] = [
    {
      name: "crypto-price",
      description: "Get current crypto prices for a coin symbol.",
      parameters: [{ name: "symbol", type: "string", required: true }],
    },
    {
      name: "web-search",
      description: "Search the web and return the top results.",
      parameters: [{ name: "query", type: "string", required: true }],
    },
    {
      name: "file-write",
      description: "Write text to a file.",
      parameters: [{ name: "path", type: "string", required: true }],
    },
    { name: "http-get", description: "Fetch a URL over HTTP.", parameters: [] },
    { name: "calc", description: "Evaluate an arithmetic expression.", parameters: [] },
    { name: "json-parse", description: "Parse a JSON string.", parameters: [] },
  ];

  async function runTask(
    query: string | undefined,
    taskRelevant: readonly string[] | undefined,
  ): Promise<{ out: string; discovered: Set<string> }> {
    const discoveredRef = await Effect.runPromise(Ref.make(new Set<string>()));
    const handler = makeDiscoverToolsHandler({
      getAllToolDefinitions: () => TASK_CATALOG,
      discoveredRef,
      ...(taskRelevant === undefined ? {} : { getTaskRelevantTools: () => taskRelevant }),
    });
    const args = query === undefined ? {} : { query };
    const out = String(await Effect.runPromise(handler(args)));
    const discovered = await Effect.runPromise(Ref.get(discoveredRef));
    return { out, discovered };
  }

  const HEADER = "Also needed for this task (now callable):";

  it("appends unmatched task-relevant tools and marks them discovered", async () => {
    const { out, discovered } = await runTask("crypto prices", ["crypto-price", "web-search"]);
    const lines = out.split("\n");
    const at = lines.indexOf(HEADER);
    expect(at).toBeGreaterThan(-1);
    expect(lines[at - 1]).toStartWith("- crypto-price(");
    expect(lines[at + 1]).toStartWith("- web-search(");
    expect(lines.length).toBe(at + 2);
    expect([...discovered].sort()).toEqual(["crypto-price", "web-search"]);
  });

  it("drops names outside the permitted catalog", async () => {
    const { out, discovered } = await runTask("crypto prices", ["not-permitted", "web-search"]);
    expect(out).not.toContain("not-permitted");
    expect(out).toContain("- web-search(");
    expect(discovered.has("not-permitted")).toBe(false);
  });

  it("does not repeat a tool the query already matched", async () => {
    const { out } = await runTask("crypto prices", ["crypto-price"]);
    expect(out).not.toContain(HEADER);
    expect(out.split("- crypto-price(").length - 1).toBe(1);
  });

  it("caps the appendix at 4, keeping kernel order", async () => {
    const { out, discovered } = await runTask("crypto prices", [
      "json-parse",
      "web-search",
      "calc",
      "http-get",
      "file-write",
    ]);
    const lines = out.split("\n");
    const appended = lines.slice(lines.indexOf(HEADER) + 1).map((l) => l.split("(")[0]);
    expect(appended).toEqual(["- json-parse", "- web-search", "- calc", "- http-get"]);
    expect(discovered.has("file-write")).toBe(false);
  });

  it("absent accessor: output is byte-identical to the query-only answer", async () => {
    const { out, discovered } = await runTask("crypto prices", undefined);
    expect(out).toBe(
      [
        'Top 1 TOOLS matching "crypto prices" (callable functions — invoke by name with arguments):',
        "(Tools only. Skills are not listed here.)",
        "- crypto-price(symbol: string) — Get current crypto prices for a coin symbol.",
      ].join("\n"),
    );
    expect([...discovered]).toEqual(["crypto-price"]);
  });

  it("exhaustion and no-query paths are unchanged (no appendix)", async () => {
    const ranking = ["web-search", "calc"];
    const exhausted = await runTask("zzz unknown capability", ranking);
    const exhaustedBase = await runTask("zzz unknown capability", undefined);
    expect(exhausted.out).toBe(exhaustedBase.out);
    expect(exhausted.out).not.toContain(HEADER);
    const all = await runTask(undefined, ranking);
    const allBase = await runTask(undefined, undefined);
    expect(all.out).toBe(allBase.out);
    expect(all.out).not.toContain(HEADER);
  });
});

describe("discover-tools handler — empty permitted catalog", () => {
  async function runEmpty(unlisted?: number): Promise<string> {
    const handler = makeDiscoverToolsHandler({
      getAllToolDefinitions: () => [],
      discoveredRef: await Effect.runPromise(Ref.make(new Set<string>())),
      ...(unlisted === undefined ? {} : { getUnlistedToolCount: () => unlisted }),
    });
    return String(await Effect.runPromise(handler({ query: "read file" })));
  }

  it("never claims nothing is registered when it cannot see the registry", async () => {
    const out = await runEmpty();
    expect(out).not.toContain("No tools registered");
    expect(out).toContain("No tools are available to you in this run");
    // States the limit of its view: tools not enabled for the run are not listed.
    expect(out).toContain("not enabled for this run are not listed");
  });

  it("registered-but-not-permitted: names the count of unlisted tools", async () => {
    const out = await runEmpty(12);
    expect(out).not.toContain("No tools registered");
    expect(out).toContain("No tools are available to you in this run");
    expect(out).toContain("12 registered tools are not enabled for this run");
  });

  it("truly empty registry (unlisted count known to be 0): says so", async () => {
    const out = await runEmpty(0);
    expect(out).toBe("No tools are registered.");
  });
});
