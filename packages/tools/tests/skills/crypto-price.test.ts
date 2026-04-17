import { describe, it, expect, afterEach } from "bun:test";
import { Effect } from "effect";
import { cryptoPriceHandler, clearPriceCache } from "../../src/skills/crypto-price.js";
import { ToolExecutionError } from "../../src/errors.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearPriceCache();
});

function mockCoinGecko(prices: Record<string, Record<string, number>>, status = 200) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!href.includes("api.coingecko.com")) throw new Error(`unexpected fetch: ${href}`);
    return new Response(JSON.stringify(prices), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

describe("cryptoPriceHandler", () => {
  it("returns prices for known symbols", async () => {
    mockCoinGecko({ bitcoin: { usd: 77000 }, ethereum: { usd: 2300 } });

    const result = await Effect.runPromise(
      cryptoPriceHandler({ coins: ["BTC", "ETH"], currency: "usd" }),
    );

    expect(result.source).toBe("coingecko");
    expect(result.currency).toBe("usd");
    expect(result.prices).toHaveLength(2);
    expect(result.prices.find((p) => p.symbol === "BTC")?.price).toBe(77000);
    expect(result.prices.find((p) => p.symbol === "ETH")?.price).toBe(2300);
  });

  it("accepts full coin names (case-insensitive)", async () => {
    mockCoinGecko({ ripple: { usd: 1.5 }, stellar: { usd: 0.1 } });

    const result = await Effect.runPromise(
      cryptoPriceHandler({ coins: ["XRP", "XLM"] }),
    );

    expect(result.prices.find((p) => p.symbol === "XRP")?.price).toBe(1.5);
    expect(result.prices.find((p) => p.symbol === "XLM")?.price).toBe(0.1);
  });

  it("defaults currency to usd when omitted", async () => {
    mockCoinGecko({ bitcoin: { usd: 77000 } });

    const result = await Effect.runPromise(cryptoPriceHandler({ coins: ["BTC"] }));

    expect(result.currency).toBe("usd");
  });

  it("includes coin name in each price row", async () => {
    mockCoinGecko({ bitcoin: { usd: 77000 } });

    const result = await Effect.runPromise(cryptoPriceHandler({ coins: ["BTC"] }));

    expect(result.prices[0]?.name).toBe("Bitcoin");
    expect(result.prices[0]?.symbol).toBe("BTC");
  });

  it("marks unknown coins as not_found rather than throwing", async () => {
    mockCoinGecko({ bitcoin: { usd: 77000 } });

    const result = await Effect.runPromise(
      cryptoPriceHandler({ coins: ["BTC", "FAKECOIN"] }),
    );

    const fake = result.prices.find((p) => p.symbol === "FAKECOIN");
    expect(fake?.price).toBeNull();
    expect(fake?.notFound).toBe(true);
  });

  it("makes only one CoinGecko request even when called 4 times separately", async () => {
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount++;
      return new Response(
        JSON.stringify({ bitcoin: { usd: 77000 }, ripple: { usd: 1.5 }, ethereum: { usd: 2300 }, stellar: { usd: 0.1 } }),
        { status: 200 },
      );
    }) as typeof fetch;

    await Effect.runPromise(cryptoPriceHandler({ coins: ["BTC"] }));
    await Effect.runPromise(cryptoPriceHandler({ coins: ["XRP"] }));
    await Effect.runPromise(cryptoPriceHandler({ coins: ["ETH"] }));
    await Effect.runPromise(cryptoPriceHandler({ coins: ["XLM"] }));

    expect(fetchCount).toBe(1);
  });

  it("retries on 429 and succeeds on second attempt", async () => {
    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts++;
      if (attempts < 2) return new Response("{}", { status: 429 });
      return new Response(JSON.stringify({ bitcoin: { usd: 77000 } }), { status: 200 });
    }) as typeof fetch;

    const result = await Effect.runPromise(cryptoPriceHandler({ coins: ["BTC"] }));
    expect(result.prices[0]?.price).toBe(77000);
    expect(attempts).toBe(2);
  });

  it("returns ToolExecutionError on network failure", async () => {
    globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;

    const err = await Effect.runPromise(
      cryptoPriceHandler({ coins: ["BTC"] }).pipe(Effect.flip),
    );
    expect(err).toBeInstanceOf(ToolExecutionError);
  });

  it("returns ToolExecutionError on non-200 response", async () => {
    mockCoinGecko({}, 500);

    const err = await Effect.runPromise(
      cryptoPriceHandler({ coins: ["BTC"] }).pipe(Effect.flip),
    );
    expect(err).toBeInstanceOf(ToolExecutionError);
  });
});
