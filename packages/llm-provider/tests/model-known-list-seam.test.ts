// Seam pin: model-known-list.ts (the fallback "known models" list when a live
// model listing fails) and its xAI out-of-credits path through resolveProviderModels.
import { beforeEach, describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { pricedModelIds } from "../src/price-book/price-book.js";
import { isVariantModelId, priceBookFallbackIds } from "../src/model-known-list.js";
import { clearModelDiscoveryCache, listProviderModels, resolveProviderModels } from "../src/model-discovery.js";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** xAI's real 403 body when the team has no credits (account ids redacted). */
const XAI_NO_CREDITS = {
  code: "The caller does not have permission to execute the specified operation",
  error:
    "Your team team-REDACTED has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit.",
};

const fetchReturning = (res: () => Response): typeof fetch =>
  (async (_input: string | URL | Request, _init?: RequestInit) => res()) as typeof fetch;

beforeEach(() => clearModelDiscoveryCache());

describe("isVariantModelId", () => {
  it("general ids are not variants", () => {
    for (const id of ["grok-4.7", "grok-4.20", "grok-4.20-reasoning", "grok-code-fast", "claude-opus-4-5", "gemini-2.5-pro"])
      expect(isVariantModelId(id)).toBe(false);
  });
  it("dated snapshots and beta/experimental/preview/latest channels are variants", () => {
    for (const id of [
      "grok-4.20-0309",
      "grok-4.20-beta",
      "grok-4.20-experimental-beta-0304",
      "grok-4.5-latest",
      "claude-haiku-4-5-20251001",
      "gpt-4o-2024-05-13",
      "gemini-3.1-pro-preview",
      "deep-research-preview-04-2026",
      "gemini-exp-1206",
    ])
      expect(isVariantModelId(id)).toBe(true);
  });
});

describe("priceBookFallbackIds", () => {
  it("returns PriceBook ids unchanged: none invented, listed ids skipped, general before variants", () => {
    const book = new Set(pricedModelIds("xai"));
    const out = priceBookFallbackIds("xai", new Set(["grok-4.7"]), () => true);
    expect(out.length).toBe(book.size - 1);
    expect(out.every((id) => book.has(id))).toBe(true);
    expect(out).not.toContain("grok-4.7");
    const firstVariant = out.findIndex(isVariantModelId);
    expect(firstVariant).toBeGreaterThan(0);
    expect(out.slice(firstVariant).every(isVariantModelId)).toBe(true);
    // numeric-aware within a group: 4.3 before 4.20
    expect(out.indexOf("grok-4.3")).toBeLessThan(out.indexOf("grok-4.20"));
  });
  it("applies the keep filter", () => {
    expect(priceBookFallbackIds("gemini", new Set(), (id) => !id.includes("embedding")).some((id) => id.includes("embedding"))).toBe(false);
  });
});

describe("xai live list refused for credits (403)", () => {
  it("listProviderModels: reason quota, status 403, body not echoed", async () => {
    const r = await Effect.runPromise(
      Effect.either(listProviderModels("xai", { apiKey: "xai-key", fetch: fetchReturning(() => json(XAI_NO_CREDITS, 403)) })),
    );
    if (r._tag !== "Left") throw new Error("expected Left");
    expect(r.left.reason).toBe("quota");
    expect(r.left.status).toBe(403);
    expect(r.left.message).not.toContain("team-REDACTED");
    expect(r.left.message).not.toContain("xai-key");
  });

  it("a plain 403 (no credits wording) stays http", async () => {
    const r = await Effect.runPromise(
      Effect.either(listProviderModels("xai", { apiKey: "k", fetch: fetchReturning(() => json({ error: "forbidden" }, 403)) })),
    );
    if (r._tag !== "Left") throw new Error("expected Left");
    expect(r.left.reason).toBe("http");
  });

  /** Reason a refused listing gets for a given body + status ("ok" if it unexpectedly succeeded). */
  const reasonFor = async (body: unknown, status: number): Promise<string> => {
    const r = await Effect.runPromise(
      Effect.either(listProviderModels("xai", { apiKey: "k", fetch: fetchReturning(() => json(body, status)) })),
    );
    return r._tag === "Left" ? r.left.reason : "ok";
  };

  it("a 403 that only links a billing page stays http", async () => {
    expect(await reasonFor({ error: "Forbidden. Manage billing at https://x.ai/billing or see https://x.ai/billing/docs" }, 403)).toBe("http");
  });

  it("a 403 that mentions a credit card stays http", async () => {
    expect(await reasonFor({ error: "This key's team has no credit card on file for this region; access denied." }, 403)).toBe("http");
  });

  it("OpenAI insufficient_quota 429 is quota", async () => {
    const body = {
      error: {
        message: "You exceeded your current quota, please check your plan and billing details.",
        type: "insufficient_quota",
        code: "insufficient_quota",
      },
    };
    expect(await reasonFor(body, 429)).toBe("quota");
  });

  it("exhausted-balance phrasings are quota", async () => {
    for (const error of [
      "Your credit balance is too low to access the API.",
      "Insufficient credits.",
      "insufficient balance",
      "billing_hard_limit_reached",
      "Payment Required",
    ])
      expect(await reasonFor({ error }, 403)).toBe("quota");
  });

  it("a plain 429 rate limit stays http", async () => {
    expect(await reasonFor({ error: "Rate limit exceeded, retry later" }, 429)).toBe("http");
  });

  it("402 is quota", async () => {
    const r = await Effect.runPromise(
      Effect.either(listProviderModels("openai", { apiKey: "k", fetch: fetchReturning(() => json({}, 402)) })),
    );
    if (r._tag !== "Left") throw new Error("expected Left");
    expect(r.left.reason).toBe("quota");
  });

  it("resolveProviderModels lists the known xai models with origin and the quota reason", async () => {
    const r = await Effect.runPromise(
      resolveProviderModels("xai", { apiKey: "xai-key", fetch: fetchReturning(() => json(XAI_NO_CREDITS, 403)) }),
    );
    expect(r.live).toBe(false);
    expect(r.error?.reason).toBe("quota");
    const ids = r.models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    // static preset first (framework default), then PriceBook ids
    expect(r.models[0]!.id).toBe("grok-4.7");
    expect(r.models[0]!.listedBy).toBe("static");
    const priced = r.models.filter((m) => m.listedBy === "price-book");
    expect(priced.length).toBeGreaterThan(10);
    expect(priced.every((m) => m.source === "preset")).toBe(true);
    for (const id of ["grok-4.6", "grok-4.5", "grok-4.3", "grok-code-fast"]) expect(ids).toContain(id);
    // every listed id is a preset or a PriceBook id: nothing invented
    const book = new Set(pricedModelIds("xai"));
    expect(r.models.every((m) => m.listedBy === "static" || book.has(m.id))).toBe(true);
  });

  it("live success is unchanged: live rows win and no PriceBook rows are added", async () => {
    const r = await Effect.runPromise(
      resolveProviderModels("xai", { apiKey: "k", fetch: fetchReturning(() => json({ data: [{ id: "grok-new" }] })) }),
    );
    expect(r.live).toBe(true);
    expect(r.models[0]).toMatchObject({ id: "grok-new", source: "live", listedBy: "live" });
    expect(r.models.some((m) => m.listedBy === "price-book")).toBe(false);
  });
});
