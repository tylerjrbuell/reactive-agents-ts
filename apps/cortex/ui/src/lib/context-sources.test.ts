import { describe, expect, test } from "bun:test";
import { contextSourcesOf, NO_RECALL, RECALL_NOT_REPORTED, recalledRows, runRecallFromLive, writtenMemories } from "./context-sources.js";
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

  test("a run that reported no MemoryRecalled keeps the note and no recalled list", () => {
    const v = contextSourcesOf(skills, listing);
    expect(v.recallReported).toBe(false);
    expect(v.recalled).toEqual([]);
    expect(RECALL_NOT_REPORTED).toContain("reported no recalled memories");
  });
});

describe("recalled memories (MemoryRecalled)", () => {
  const live = [
    { type: "AgentStarted", payload: {} },
    {
      type: "MemoryRecalled",
      payload: { _tag: "MemoryRecalled", taskId: "t", tier: "semantic", items: [{ id: "s1", tier: "semantic", summary: "Prefers tabs", score: 0.91, importance: 0.8 }] },
    },
    {
      type: "MemoryRecalled",
      payload: { _tag: "MemoryRecalled", taskId: "t", tier: "working", query: "tabs", items: [{ id: "w1", tier: "working", summary: "scratch" }] },
    },
  ];

  test("runRecallFromLive folds the run's events; none is not-reported", () => {
    const r = runRecallFromLive(live);
    expect(r.reported).toBe(true);
    expect(r.items.map((i) => i.id)).toEqual(["s1", "w1"]);
    expect(runRecallFromLive([{ type: "AgentStarted", payload: {} }])).toEqual(NO_RECALL);
  });

  test("rows carry tier, summary, relevance and importance, and link a studio tier to the Memory item", () => {
    const rows = recalledRows(runRecallFromLive(live), "agent-1");
    expect(rows[0]).toEqual({
      id: "s1",
      tier: "semantic",
      title: "Prefers tabs",
      detail: "relevance 0.91 · importance 0.80",
      href: "/lab?agent=agent-1&item=s1#memory",
    });
    // The working tier has no studio layer: no link. The query that surfaced it is kept.
    expect(rows[1]).toEqual({ id: "w1", tier: "working", title: "scratch", detail: "", query: "tabs" });
    expect(recalledRows(runRecallFromLive(live), undefined)[0]!.href).toBeUndefined();
  });

  test("with events the note goes away and the summary counts them", () => {
    const v = contextSourcesOf(undefined, listing, runRecallFromLive(live), "agent-1");
    expect(v.recallReported).toBe(true);
    expect(v.recalled).toHaveLength(2);
    expect(v.summary).toBe("0 skills used · 2 memories recalled · 3 memories written");
  });
});
