import { describe, it, expect } from "bun:test";
import { Option } from "effect";
import { ModelDiscoveryError, priceFor } from "@reactive-agents/llm-provider";
import { buildCapabilityResponse, createModelsRouter, modelPriceOf, type ModelsDeps } from "../api/models.js";

const noFetch: typeof fetch = Object.assign(
  async () => {
    throw new Error("no network in tests");
  },
  { preconnect: () => undefined },
);

const live = (id: string) => ({
  id,
  label: id,
  source: "live" as const,
  supportsThinking: null,
  capabilitySource: "static-table" as const,
});

const appWith = (resolve: ModelsDeps["resolve"]) => createModelsRouter({ resolve, fetch: noFetch });

type PricedBody = { models: { name: string; price?: { input: number; output: number; source: string; asOf?: string } }[] };

describe("model prices on /api/models", () => {
  it("each row carries the framework PriceBook rate; an unpriced model has no price", async () => {
    const app = appWith(async () => ({ models: [live("gpt-4o"), live("no-such-model-xyz")], live: true }));
    const res = await app.handle(new Request("http://localhost/api/models/openai"));
    const body = (await res.json()) as PricedBody;
    const book = Option.getOrThrow(priceFor("openai", "gpt-4o"));
    const priced = body.models.find((m) => m.name === "gpt-4o");
    expect(priced?.price?.input).toBe(book.input);
    expect(priced?.price?.output).toBe(book.output);
    expect(priced?.price?.source).toBe(book.source);
    expect(body.models.find((m) => m.name === "no-such-model-xyz")?.price).toBeUndefined();
  });

  it("passes each row's listedBy and the quota reason through when the live list failed", async () => {
    const app = appWith(async () => ({
      models: [
        { ...live("grok-4"), source: "preset" as const, listedBy: "static" as const },
        { ...live("grok-3-mini"), source: "preset" as const, listedBy: "price-book" as const },
        live("no-origin-row"),
      ],
      live: false,
      error: new ModelDiscoveryError({ provider: "xai", reason: "quota", message: "xai 403: out of credits", status: 403 }),
    }));
    const res = await app.handle(new Request("http://localhost/api/models/xai"));
    const body = (await res.json()) as {
      live: boolean;
      error?: { reason: string; message: string };
      models: { name: string; listedBy?: string }[];
    };
    expect(body.live).toBe(false);
    expect(body.error).toEqual({ reason: "quota", message: "xai 403: out of credits" });
    expect(body.models.map((m) => [m.name, m.listedBy])).toEqual([
      ["grok-4", "static"],
      ["grok-3-mini", "price-book"],
      ["no-origin-row", undefined],
    ]);
    expect("listedBy" in (body.models[2] ?? {})).toBe(false);
  });

  it("Ollama models are local and free", async () => {
    expect(modelPriceOf("ollama", "qwen3:4b")).toEqual({ input: 0, output: 0, source: "local" });
  });

  it("the deterministic test provider has no price", () => {
    expect(modelPriceOf("test", "anything")).toBeUndefined();
  });

  it("the capability response carries the same price", () => {
    const cap = buildCapabilityResponse("anthropic", "claude-sonnet-4-5", {});
    const book = Option.getOrUndefined(priceFor("anthropic", "claude-sonnet-4-5"));
    expect(book).toBeDefined();
    expect(cap.price?.input).toBe(book?.input);
    expect(cap.price?.output).toBe(book?.output);
  });
});
