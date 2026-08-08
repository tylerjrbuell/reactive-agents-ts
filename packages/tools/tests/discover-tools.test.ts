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
    expect(out).toContain("## Skills section");
    expect(out).toContain("file-write");
    expect(out).toContain("web-search");
  });

  it("DOES return a confident match when the query clearly relates", async () => {
    const out = await run("search the web");
    expect(out).toContain("matching");
    expect(out).toContain("Skills are separate");
    expect(out).toContain("web-search");
    expect(out).not.toContain("file-write");
  });

  it("lists everything when no query is given", async () => {
    const out = await run(undefined);
    expect(out).toContain("2 TOOLS available");
    expect(out).toContain("Skills are separate");
    expect(out).toContain("file-write");
    expect(out).toContain("web-search");
  });

  it("reports empty registry honestly", async () => {
    const out = await run("anything", []);
    expect(out).toBe("No tools registered.");
  });
});
