import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { openRouterPricingProvider, urlPricingProvider } from "../src/pricing.js";

describe("Dynamic Pricing Providers", () => {
  it("urlPricingProvider should fetch and map pricing correctly", async () => {
    // Create a mock server to test URL fetching
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/pricing") {
          return new Response(
            JSON.stringify({
              "mock-model-1": { input: 0.1, output: 0.2 },
              "mock-model-2": { input: 1.5, output: 3.0 },
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    const url = `http://localhost:${server.port}/pricing`;
    const provider = urlPricingProvider(url);
    
    const registry = await Effect.runPromise(provider.fetchPricing());
    
    expect(registry["mock-model-1"]).toBeDefined();
    expect(registry["mock-model-1"].input).toBe(0.1);
    expect(registry["mock-model-1"].output).toBe(0.2);
    
    expect(registry["mock-model-2"]).toBeDefined();
    expect(registry["mock-model-2"].input).toBe(1.5);
    expect(registry["mock-model-2"].output).toBe(3.0);

    server.stop();
  });

  it("should handle fetch failures gracefully", async () => {
    const provider = urlPricingProvider("http://localhost:12345/does-not-exist");
    
    const result = await Effect.runPromiseExit(provider.fetchPricing());
    expect(result._tag).toBe("Failure");
  });
});
