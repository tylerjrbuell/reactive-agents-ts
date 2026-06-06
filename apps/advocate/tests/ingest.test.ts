// apps/advocate/tests/ingest.test.ts
// Run: bun test apps/advocate/tests/ingest.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  normalizeHnHits,
  normalizeRedditListing,
  normalizeDevtoArticles,
} from "../src/ingest/normalize.js";
import { scoreThread } from "../src/ingest/score.js";
import { gatherThreads } from "../src/ingest/gather.js";
import type { CommunityThread } from "../src/ingest/types.js";

describe("normalize", () => {
  it("normalizes Algolia HN hits into CommunityThread[]", () => {
    const json = {
      hits: [
        {
          objectID: "123",
          title: "Best TypeScript agent framework?",
          url: "https://example.com/x",
          author: "alice",
          points: 42,
          num_comments: 7,
          created_at: "2026-06-01T10:00:00Z",
        },
      ],
    };
    const out = normalizeHnHits(json);
    expect(out).toHaveLength(1);
    const t = out[0]!;
    expect(t.id).toBe("hn:123");
    expect(t.source).toBe("hackernews");
    expect(t.title).toBe("Best TypeScript agent framework?");
    // Discussion URL points at the HN item, not the external link.
    expect(t.url).toBe("https://news.ycombinator.com/item?id=123");
    expect(t.points).toBe(42);
    expect(t.numComments).toBe(7);
    expect(t.author).toBe("alice");
  });

  it("skips malformed HN hits without an objectID", () => {
    const out = normalizeHnHits({ hits: [{ title: "no id" }, "garbage", null] });
    expect(out).toHaveLength(0);
  });

  it("normalizes a Reddit listing", () => {
    const json = {
      data: {
        children: [
          {
            data: {
              id: "abc",
              title: "LangChain alternative in TS?",
              permalink: "/r/typescript/comments/abc/x/",
              author: "bob",
              score: 12,
              num_comments: 3,
              created_utc: 1764585600, // 2025-12-01T08:00:00Z
              selftext: "Looking for a typed agent lib",
              subreddit: "typescript",
            },
          },
        ],
      },
    };
    const out = normalizeRedditListing(json);
    expect(out).toHaveLength(1);
    const t = out[0]!;
    expect(t.id).toBe("reddit:abc");
    expect(t.source).toBe("reddit");
    expect(t.url).toBe("https://www.reddit.com/r/typescript/comments/abc/x/");
    expect(t.numComments).toBe(3);
    expect(t.snippet).toContain("typed agent");
    expect(t.createdAt.startsWith("2025-12-01")).toBe(true);
  });

  it("normalizes dev.to articles", () => {
    const json = [
      {
        id: 456,
        title: "Why TypeScript for AI agents",
        url: "https://dev.to/x/why-ts",
        user: { username: "carol" },
        positive_reactions_count: 9,
        comments_count: 2,
        published_at: "2026-05-20T12:00:00Z",
        description: "A case for typed agents",
      },
    ];
    const out = normalizeDevtoArticles(json);
    expect(out).toHaveLength(1);
    const t = out[0]!;
    expect(t.id).toBe("devto:456");
    expect(t.source).toBe("devto");
    expect(t.author).toBe("carol");
  });
});

describe("scoreThread", () => {
  const base: CommunityThread = {
    id: "hn:1",
    source: "hackernews",
    title: "hello world",
    url: "u",
    createdAt: new Date().toISOString(),
  };

  it("ranks term matches in the title higher", () => {
    const match = scoreThread({ ...base, title: "TypeScript agent framework rocks" }, [
      "typescript",
      "agent",
    ]);
    const noMatch = scoreThread({ ...base, title: "hello world" }, ["typescript", "agent"]);
    expect(match).toBeGreaterThan(noMatch);
  });

  it("boosts more recent threads", () => {
    const fresh = scoreThread({ ...base, title: "agent", createdAt: new Date().toISOString() }, ["agent"]);
    const old = scoreThread(
      { ...base, title: "agent", createdAt: "2020-01-01T00:00:00Z" },
      ["agent"],
    );
    expect(fresh).toBeGreaterThan(old);
  });
});

describe("gatherThreads", () => {
  it("fetches, normalizes, dedups seen, scores, and returns top-N", async () => {
    const hn = {
      hits: [
        { objectID: "1", title: "TypeScript agent framework", points: 50, num_comments: 10, created_at: new Date().toISOString() },
        { objectID: "2", title: "unrelated cooking thread", points: 1, num_comments: 0, created_at: new Date().toISOString() },
      ],
    };
    const reddit = {
      data: {
        children: [
          { data: { id: "seen1", title: "TypeScript agent already seen", permalink: "/r/typescript/x/", num_comments: 5, created_utc: 1764585600, subreddit: "typescript" } },
        ],
      },
    };
    const devto: unknown[] = [];

    const fetchImpl = ((url: string | URL | Request): Promise<Response> => {
      const u = String(url);
      const body = u.includes("algolia") ? hn : u.includes("reddit") ? reddit : devto;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as typeof fetch;

    const seen = new Set<string>(["reddit:seen1"]);
    const marked: string[] = [];

    const out = await Effect.runPromise(
      gatherThreads(
        { searchTerms: ["typescript", "agent"], subreddits: ["typescript"], devtoTags: ["typescript"], sinceHours: 168, limit: 5 },
        { fetchImpl, isSeen: (id) => seen.has(id), markSeen: (ids) => { marked.push(...ids); } },
      ),
    );

    const ids = out.map((t) => t.id);
    // seen reddit thread filtered out
    expect(ids).not.toContain("reddit:seen1");
    // relevant HN thread present and ranked above the unrelated one
    expect(ids).toContain("hn:1");
    expect(ids.indexOf("hn:1")).toBeLessThan(ids.indexOf("hn:2"));
    // returned threads were marked seen for next run
    expect(marked).toContain("hn:1");
  });

  it("tolerates a failing source without aborting the whole gather", async () => {
    const fetchImpl = ((url: string | URL | Request): Promise<Response> => {
      const u = String(url);
      if (u.includes("algolia")) return Promise.reject(new Error("network down"));
      const body = u.includes("reddit")
        ? { data: { children: [{ data: { id: "r1", title: "agent", permalink: "/r/node/x/", created_utc: 1764585600, subreddit: "node" } }] } }
        : [];
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as typeof fetch;

    const out = await Effect.runPromise(
      gatherThreads(
        { searchTerms: ["agent"], subreddits: ["node"], devtoTags: [], sinceHours: 168, limit: 5 },
        { fetchImpl, isSeen: () => false, markSeen: () => {} },
      ),
    );
    // HN failed, but reddit result still came through
    expect(out.map((t) => t.id)).toContain("reddit:r1");
  });
});
