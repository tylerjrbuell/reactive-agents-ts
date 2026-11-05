// Run: bun test packages/runtime/tests/document-store-per-agent-e2e.test.ts --timeout 20000
//
// Each built agent owns its document store (2026-11-05 owner decision):
// `.withDocuments()` and `agent.ingest()` write into the agent's store, and
// the `find` tool searches only that store. Sharing is opt-in: pass ONE
// `createDocumentStore()` to several builders via `.withDocuments(docs, { store })`.
//
// The `find` result lands in the run's observation steps, so each cell reads
// what the tool actually returned rather than the scripted final text.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { createDocumentStore } from "@reactive-agents/tools";
import { ReactiveAgents } from "../src/index.js";
import type { ReactiveAgent, ReactiveAgentBuilder } from "../src/index.js";

type Step = { readonly type: string; readonly content?: string };

/** Build an agent whose single scripted turn calls `find` over its documents. */
const buildFinder = (
  query: string,
  configure: (b: ReactiveAgentBuilder) => ReactiveAgentBuilder,
): Promise<ReactiveAgent> =>
  configure(
    ReactiveAgents.create().withTestScenario([
      { toolCall: { name: "find", args: { query, scope: "documents" } } },
      { text: "Done." },
    ]),
  )
    .withMetaTools({ find: true })
    .withMaxIterations(3)
    .build();

/** Run once and return every observation step's content, joined. */
const observe = async (agent: ReactiveAgent, task: string): Promise<string> => {
  const r = await agent.run(task);
  const steps = (r.metadata as { reasoningSteps?: readonly Step[] }).reasoningSteps ?? [];
  return steps
    .filter((s) => s.type === "observation")
    .map((s) => s.content ?? "")
    .join("\n");
};

describe("document store is per agent by default", () => {
  it("two agents with different documents never see each other's documents", async () => {
    const alpha = "ALPHA-DOC-MARKER-91c2 zebra telescope";
    const beta = "BETA-DOC-MARKER-4d7e zebra telescope";
    const a = await buildFinder("zebra telescope", (b) =>
      b.withDocuments([{ content: alpha, source: "alpha.md" }]),
    );
    const b = await buildFinder("zebra telescope", (bb) =>
      bb.withDocuments([{ content: beta, source: "beta.md" }]),
    );
    try {
      // Concurrent runs: the binding must hold per fiber, not per process.
      const [oa, ob] = await Promise.all([observe(a, "Find zebra telescope."), observe(b, "Find zebra telescope.")]);
      expect(oa).toContain("ALPHA-DOC-MARKER-91c2");
      expect(oa).not.toContain("BETA-DOC-MARKER-4d7e");
      expect(ob).toContain("BETA-DOC-MARKER-4d7e");
      expect(ob).not.toContain("ALPHA-DOC-MARKER-91c2");
    } finally {
      await a.dispose();
      await b.dispose();
    }
  }, 20000);

  it("agents given the same store both find a document ingested by either", async () => {
    const store = createDocumentStore();
    const a = await buildFinder("walrus lantern", (b) =>
      b.withDocuments([{ content: "SHARED-A-MARKER-0b3f walrus lantern", source: "a.md" }], { store }),
    );
    const b = await buildFinder("walrus lantern", (bb) => bb.withDocuments([], { store }));
    const outsider = await buildFinder("walrus lantern", (bb) =>
      bb.withDocuments([{ content: "OUTSIDER-MARKER walrus lantern", source: "o.md" }]),
    );
    try {
      // Runtime ingestion by B lands in the shared store too.
      await b.ingest("SHARED-B-MARKER-6a1c walrus lantern", { source: "b.md" });
      const oa = await observe(a, "Find walrus lantern.");
      const ob = await observe(b, "Find walrus lantern.");
      for (const o of [oa, ob]) {
        expect(o).toContain("SHARED-A-MARKER-0b3f");
        expect(o).toContain("SHARED-B-MARKER-6a1c");
        expect(o).not.toContain("OUTSIDER-MARKER");
      }
      const oo = await observe(outsider, "Find walrus lantern.");
      expect(oo).toContain("OUTSIDER-MARKER");
      expect(oo).not.toContain("SHARED-A-MARKER-0b3f");
      expect(oo).not.toContain("SHARED-B-MARKER-6a1c");
    } finally {
      await a.dispose();
      await b.dispose();
      await outsider.dispose();
    }
  }, 20000);

  it("runEffect() run on the caller's own runtime still searches the agent's store", async () => {
    const a = await buildFinder("heron basalt", (b) =>
      b.withDocuments([{ content: "EFFECT-ENTRY-MARKER-5c19 heron basalt", source: "e.md" }]),
    );
    const leak = await buildFinder("heron basalt", (b) =>
      b.withDocuments([{ content: "LEAK-MARKER-a07d heron basalt", source: "l.md" }]),
    );
    try {
      const r = await Effect.runPromise(a.runEffect("Find heron basalt."));
      const steps = (r.metadata as { reasoningSteps?: readonly Step[] }).reasoningSteps ?? [];
      const o = steps.filter((s) => s.type === "observation").map((s) => s.content ?? "").join("\n");
      expect(o).toContain("EFFECT-ENTRY-MARKER-5c19");
      expect(o).not.toContain("LEAK-MARKER-a07d");
    } finally {
      await a.dispose();
      await leak.dispose();
    }
  }, 20000);

  it("agent.ingest() at runtime is visible to that agent's next run only", async () => {
    const mk = (configure: (b: ReactiveAgentBuilder) => ReactiveAgentBuilder) =>
      configure(
        ReactiveAgents.create().withTestScenario([
          { toolCall: { name: "find", args: { query: "quokka harbor", scope: "documents" } } },
          { text: "Done." },
          { toolCall: { name: "find", args: { query: "quokka harbor", scope: "documents" } } },
          { text: "Done." },
        ]),
      )
        .withMaxIterations(3)
        .build();
    // No .withDocuments(): ingest() alone must enable find for this agent.
    const agent = await mk((b) => b.withTools());
    const other = await buildFinder("quokka harbor", (b) =>
      b.withDocuments([{ content: "unrelated filler text", source: "f.md" }]),
    );
    try {
      await agent.ingest("INGEST-MARKER-2e88 quokka harbor", { source: "late.md" });
      const o = await observe(agent, "Find quokka harbor.");
      expect(o).toContain("INGEST-MARKER-2e88");
      const oo = await observe(other, "Find quokka harbor.");
      expect(oo).not.toContain("INGEST-MARKER-2e88");
    } finally {
      await agent.dispose();
      await other.dispose();
    }
  }, 20000);
});
