// apps/advocate/tests/draft-writer.test.ts
// Run: bun test apps/advocate/tests/draft-writer.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { normalizeDraftArgs } from "../src/tools/draft-writer.js";
import { gradeDraft } from "../src/grounding/grade.js";

function ok(r: ReturnType<typeof normalizeDraftArgs>) {
  if (!r.ok) throw new Error(`expected ok, got: ${r.message}`);
  return r.draft;
}

describe("normalizeDraftArgs — tolerant recovery", () => {
  it("defaults missing type to 'response' (the call that botched in prod)", () => {
    const d = ok(normalizeDraftArgs({ title: "Hi", content: "Hello world" }));
    expect(d.type).toBe("response");
  });

  it("derives a title from the first heading when omitted", () => {
    const d = ok(normalizeDraftArgs({ content: "# Managing agent state\n\nbody text" }));
    expect(d.title).toBe("Managing agent state");
  });

  it("derives a title from the first non-empty line when there is no heading", () => {
    const d = ok(normalizeDraftArgs({ content: "\n\nFirst real line here\nsecond" }));
    expect(d.title).toBe("First real line here");
  });

  it("recovers content from common aliases (body/text/draft/markdown)", () => {
    expect(ok(normalizeDraftArgs({ body: "x" })).content).toBe("x");
    expect(ok(normalizeDraftArgs({ text: "y" })).content).toBe("y");
    expect(ok(normalizeDraftArgs({ markdown: "z" })).content).toBe("z");
  });

  it("coerces free-form type into the enum", () => {
    expect(ok(normalizeDraftArgs({ content: "c", type: "Blog Post" })).type).toBe("blog-post");
    expect(ok(normalizeDraftArgs({ content: "c", type: "twitter" })).type).toBe("tweet");
    expect(ok(normalizeDraftArgs({ content: "c", type: "Reddit" })).type).toBe("reddit-post");
    expect(ok(normalizeDraftArgs({ content: "c", type: "nonsense" })).type).toBe("response");
  });

  it("recovers platform / threadUrl / context from aliases", () => {
    const d = ok(
      normalizeDraftArgs({ content: "c", target: "hackernews", url: "https://x.y", reason: "spotted a fit" }),
    );
    expect(d.platform).toBe("hackernews");
    expect(d.threadUrl).toBe("https://x.y");
    expect(d.context).toBe("spotted a fit");
  });

  it("passes through a fully-specified call unchanged", () => {
    const d = ok(
      normalizeDraftArgs({ type: "blog-post", title: "T", content: "C", platform: "dev.to" }),
    );
    expect(d).toMatchObject({ type: "blog-post", title: "T", content: "C", platform: "dev.to" });
  });

  it("fails ONLY when there is no draft text anywhere — with an actionable message", () => {
    const r = normalizeDraftArgs({ type: "response", title: "just a title" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("content");
      expect(r.message.toLowerCase()).toContain("again");
    }
  });

  it("treats whitespace-only content as absent", () => {
    expect(normalizeDraftArgs({ content: "   \n  " }).ok).toBe(false);
  });

  it("keeps a real http(s) threadUrl but drops literal placeholders", () => {
    expect(ok(normalizeDraftArgs({ content: "c", threadUrl: "https://news.ycombinator.com/item?id=1" })).threadUrl).toBe(
      "https://news.ycombinator.com/item?id=1",
    );
    expect(ok(normalizeDraftArgs({ content: "c", threadUrl: "URL_OF_FIRST_THREAD_FROM_S1" })).threadUrl).toBeUndefined();
  });
});

describe("gradeDraft — placeholder rejection", () => {
  const fetchOk = (async () => new Response("", { status: 200 })) as unknown as typeof fetch;
  const realDraft =
    "Maintaining state across async tool calls is the core pain point. A practical pattern is to " +
    "thread an immutable context object through each step so every tool sees the same snapshot, which " +
    "makes runs reproducible and debuggable. For multi-step flows, serialize the snapshot before each " +
    "tool call and merge the result back — you get explicit, type-safe control over the agent lifecycle.";

  it("rejects unsubstituted template tokens", async () => {
    const g = await Effect.runPromise(gradeDraft(realDraft + " See URL_OF_FIRST_THREAD for details.", { fetchImpl: fetchOk }));
    expect(g.pass).toBe(false);
    expect(g.issues.some((i) => i.includes("placeholder"))).toBe(true);
  });

  it("rejects HTML-comment scaffolding and the word placeholder", async () => {
    const g = await Effect.runPromise(gradeDraft("<!-- Placeholder content based on Thread 1 -->\n" + realDraft, { fetchImpl: fetchOk }));
    expect(g.pass).toBe(false);
  });

  it("passes a real, substantive, grounded draft", async () => {
    const g = await Effect.runPromise(gradeDraft(realDraft, { fetchImpl: fetchOk }));
    expect(g.pass).toBe(true);
    expect(g.issues).toHaveLength(0);
  });
});
