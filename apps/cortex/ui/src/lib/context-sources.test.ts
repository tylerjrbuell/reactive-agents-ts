import { describe, expect, test } from "bun:test";
import { contextSourcesOf, RECALL_NOT_REPORTED, writtenMemories } from "./context-sources.js";
import type { MemoryListing } from "./memory-studio.js";

const listing: MemoryListing = {
  agentId: "a",
  available: true,
  dbPath: "/x",
  semantic: [{ id: "s1", content: "full content", summary: "Prefers tabs", importance: 0.8, verified: true, tags: [], createdAt: "", updatedAt: "", accessCount: 0, lastAccessedAt: "" }],
  procedural: [{ id: "p1", name: "Release flow", description: "", pattern: "", successRate: 0.75, useCount: 2, tags: [], createdAt: "", updatedAt: "" }],
  episodic: [{ id: "e1", date: "", content: "Ran the build", eventType: "task-completed" }],
};

describe("writtenMemories", () => {
  test("facts, workflows and log entries, each worded for a list", () => {
    expect(writtenMemories(listing)).toEqual([
      { id: "s1", kind: "fact", title: "Prefers tabs", detail: "importance 0.80" },
      { id: "p1", kind: "workflow", title: "Release flow", detail: "75% success" },
      { id: "e1", kind: "log", title: "Ran the build", detail: "task-completed" },
    ]);
  });

  test("no listing or an agent without a database yields nothing", () => {
    expect(writtenMemories(null)).toEqual([]);
    expect(writtenMemories({ ...listing, available: false })).toEqual([]);
  });

  test("a long entry is clipped", () => {
    const long = { ...listing, semantic: [{ ...listing.semantic[0]!, summary: "", content: "x".repeat(300) }] };
    expect(writtenMemories(long)[0]!.title).toHaveLength(141);
  });
});

describe("contextSourcesOf", () => {
  const skills = { activations: [{ name: "review", via: "agent" as const, iteration: 3 }], pinned: [], available: 4, roots: [] };

  test("skills with why, memories written, and a one-line summary", () => {
    const v = contextSourcesOf(skills, listing);
    expect(v.skills).toEqual([{ name: "review", why: "loaded by the agent", via: "agent", tooltip: "review: loaded by the agent · at step 3" }]);
    expect(v.skillsMore).toBe("3 more available");
    expect(v.memories).toHaveLength(3);
    expect(v.summary).toBe("1 skill used · 3 memories written");
  });

  test("nothing yet reads as zero, not as an error", () => {
    expect(contextSourcesOf(undefined, null).summary).toBe("0 skills used · 0 memories written");
  });

  test("the recall caveat names what the framework does not report", () => {
    expect(RECALL_NOT_REPORTED).toContain("not reported by the framework");
  });
});
