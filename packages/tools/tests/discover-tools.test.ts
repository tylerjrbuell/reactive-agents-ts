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
