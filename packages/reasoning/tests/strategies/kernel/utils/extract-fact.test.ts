import { describe, it, expect } from "bun:test";
import { extractFactDeterministic } from "../../../../src/strategies/kernel/utils/tool-execution.js";

describe("extractFactDeterministic", () => {
  it("should extract dollar amount with entity context", () => {
    const raw = "The current price of XRP is $1.327 according to CoinGecko. Market cap is $68.2B.";
    const fact = extractFactDeterministic("web-search", { query: "XRP price USD" }, raw);
    expect(fact).toBeDefined();
    expect(fact).toContain("$1.327");
  });

  it("should extract URL source attribution", () => {
    const raw = "Bitcoin price is $63,450 from https://binance.com/en/trade and other sources.";
    const fact = extractFactDeterministic("web-search", { query: "BTC price" }, raw);
    expect(fact).toBeDefined();
    expect(fact).toContain("binance.com");
  });

  it("should extract percentage values", () => {
    const raw = "XRP is up +0.91% in the last 24 hours with volume of $1.9B.";
    const fact = extractFactDeterministic("web-search", { query: "XRP 24h change" }, raw);
    expect(fact).toBeDefined();
    expect(fact).toContain("0.91%");
  });

  it("should return undefined when no structured data found", () => {
    const raw = "This page contains no numerical data whatsoever. Just plain text.";
    const fact = extractFactDeterministic("web-search", { query: "test" }, raw);
    expect(fact).toBeUndefined();
  });

  it("should handle multiple dollar amounts by picking the first", () => {
    const raw = "XRP costs $1.33 on Kraken and $1.327 on Revolut. Market cap is $68.2B.";
    const fact = extractFactDeterministic("web-search", { query: "XRP price USD" }, raw);
    expect(fact).toBeDefined();
    // Should contain at least the first one
    expect(fact).toContain("$1.33");
  });

  it("should use tool name and args in output", () => {
    const raw = "ETH is $1,581.20 today on CoinGecko.";
    const fact = extractFactDeterministic("web-search", { query: "ETH price" }, raw);
    expect(fact).toBeDefined();
    expect(fact).toContain("web-search");
    expect(fact?.toLowerCase()).toContain("eth price");
  });

  it("should handle empty or whitespace input", () => {
    expect(extractFactDeterministic("web-search", { query: "test" }, "")).toBeUndefined();
    expect(extractFactDeterministic("web-search", { query: "test" }, "   \n  ")).toBeUndefined();
  });
});
