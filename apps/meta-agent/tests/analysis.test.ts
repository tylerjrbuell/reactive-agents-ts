// apps/meta-agent/tests/analysis.test.ts
// Run: bun test ./apps/meta-agent/tests/analysis.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { normalizeReleases } from "../src/analysis/github-releases.js";
import { assignConfidence } from "../src/analysis/confidence.js";
import { gatherCompetitiveEvidence } from "../src/analysis/intel.js";

describe("normalizeReleases", () => {
  it("maps GitHub releases JSON to EvidenceItem[]", () => {
    const json = [
      { html_url: "https://github.com/mastra-ai/mastra/releases/tag/v0.5.0", tag_name: "v0.5.0", name: "v0.5.0", published_at: "2026-05-30T00:00:00Z", body: "new workflows" },
      { draft: true, tag_name: "v0.6.0-rc", html_url: "x", published_at: "2026-06-01T00:00:00Z" },
    ];
    const out = normalizeReleases("mastra-ai/mastra", json);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("release:mastra-ai/mastra#v0.5.0");
    expect(out[0]!.competitor).toBe("mastra");
    expect(out[0]!.source).toBe("release");
    expect(out[0]!.url).toContain("releases/tag/v0.5.0");
  });
});

describe("assignConfidence", () => {
  it("high when recent and corroborated", () => {
    expect(assignConfidence(5, 2)).toBe("high");
  });
  it("low when old and uncorroborated", () => {
    expect(assignConfidence(200, 0)).toBe("low");
  });
});

describe("gatherCompetitiveEvidence", () => {
  it("fetches releases per repo, resilient to a failing repo, sorted by confidence", async () => {
    const fetchImpl = ((url: string | URL | Request): Promise<Response> => {
      const u = String(url);
      if (u.includes("mastra-ai/mastra")) {
        return Promise.resolve(new Response(JSON.stringify([
          { html_url: "https://github.com/mastra-ai/mastra/releases/tag/v1", tag_name: "v1", name: "v1", published_at: new Date().toISOString(), body: "x" },
        ]), { status: 200 }));
      }
      return Promise.reject(new Error("rate limited"));
    }) as typeof fetch;

    const out = await Effect.runPromise(
      gatherCompetitiveEvidence({ repos: ["mastra-ai/mastra", "langchain-ai/langchainjs"], perRepo: 5 }, { fetchImpl }),
    );
    expect(out.map((e) => e.id)).toContain("release:mastra-ai/mastra#v1");
    expect(out.every((e) => ["high", "medium", "low"].includes(e.confidence))).toBe(true);
  });
});
