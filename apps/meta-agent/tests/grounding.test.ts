// apps/meta-agent/tests/grounding.test.ts
// Run: bun test ./apps/meta-agent/tests/grounding.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { extractUrls } from "../src/grounding/links.js";
import { astroturfIssues } from "../src/grounding/astroturf.js";
import { gradeDraft } from "../src/grounding/grade.js";

describe("extractUrls", () => {
  it("pulls http(s) urls from markdown", () => {
    const urls = extractUrls("see [x](https://a.com/p) and https://b.org/q done");
    expect(urls).toContain("https://a.com/p");
    expect(urls).toContain("https://b.org/q");
  });
});

describe("astroturfIssues", () => {
  it("flags banned promo phrases", () => {
    const issues = astroturfIssues("You should use reactive-agents, it's a game-changer!");
    expect(issues.length).toBeGreaterThan(0);
  });
  it("passes a value-first reply with one contextual mention", () => {
    const text = "Your loop never terminates because the arbitrator isn't the only exit path. " +
      "Add a single termination owner. (reactive-agents handles this with a terminate helper, fwiw.)";
    expect(astroturfIssues(text)).toHaveLength(0);
  });
});

describe("gradeDraft", () => {
  it("fails on a dead link", async () => {
    const fetchImpl = (() => Promise.resolve(new Response("", { status: 404 }))) as typeof fetch;
    const grade = await Effect.runPromise(
      gradeDraft("Helpful context here. See https://dead.example/x for more.", { fetchImpl }),
    );
    expect(grade.pass).toBe(false);
    expect(grade.deadLinks).toContain("https://dead.example/x");
  });

  it("passes a grounded, value-first draft with a live link", async () => {
    const fetchImpl = (() => Promise.resolve(new Response("", { status: 200 }))) as typeof fetch;
    const text = "The issue is your tool calls aren't deduped across heartbeats. Persist seen ids. " +
      "Background: https://example.com/post explains the pattern well.";
    const grade = await Effect.runPromise(gradeDraft(text, { fetchImpl }));
    expect(grade.pass).toBe(true);
    expect(grade.issues).toHaveLength(0);
  });
});
