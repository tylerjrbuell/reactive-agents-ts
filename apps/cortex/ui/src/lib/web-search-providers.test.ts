import { describe, expect, test } from "bun:test";
import {
  WEB_SEARCH_CHOICES,
  toggleWebSearchProvider,
  webSearchOrder,
  webSearchPatch,
  webSearchSummary,
} from "./web-search-providers.js";

describe("web-search provider order", () => {
  test("offers the framework's five providers in default order", () => {
    expect(WEB_SEARCH_CHOICES.map((c) => c.id)).toEqual(["tavily", "brave", "serper", "keenable", "duckduckgo"]);
    expect(WEB_SEARCH_CHOICES.filter((c) => !c.keyed).map((c) => c.id)).toEqual(["duckduckgo"]);
  });

  test("reads the order from rawConfig.tools.webSearch.providers; unset means the default chain", () => {
    expect(webSearchOrder({})).toBeUndefined();
    expect(webSearchOrder({ rawConfig: { tools: { webSearch: { providers: ["brave", "duckduckgo"] } } } })).toEqual(["brave", "duckduckgo"]);
    expect(webSearchOrder({ rawConfig: { tools: { webSearch: { providers: ["bing", "tavily", "tavily"] } } } })).toEqual(["tavily"]);
    expect(webSearchOrder({ rawConfig: { tools: { webSearch: { providers: [] } } } })).toBeUndefined();
  });

  test("picking appends, picking again removes", () => {
    expect(toggleWebSearchProvider(undefined, "serper")).toEqual(["serper"]);
    expect(toggleWebSearchProvider(["serper"], "tavily")).toEqual(["serper", "tavily"]);
    expect(toggleWebSearchProvider(["serper", "tavily"], "serper")).toEqual(["tavily"]);
  });

  test("the patch writes tools.webSearch.providers and keeps the other raw keys", () => {
    const cfg = { rawConfig: { profile: "lean", tools: { disclosure: "lazy", maxCallsPerTool: { a: 1 } } } };
    const next = webSearchPatch(cfg, ["tavily", "duckduckgo"]).rawConfig;
    expect(next).toEqual({
      profile: "lean",
      tools: { disclosure: "lazy", maxCallsPerTool: { a: 1 }, webSearch: { providers: ["tavily", "duckduckgo"] } },
    });
    expect(cfg.rawConfig.tools).not.toHaveProperty("webSearch");
  });

  test("an empty order removes the key and an emptied tools block", () => {
    const set = webSearchPatch({}, ["brave"]);
    expect(webSearchPatch(set, undefined).rawConfig).toEqual({});
    expect(webSearchPatch(set, []).rawConfig).toEqual({});
  });

  test("the summary states the order, or the default", () => {
    expect(webSearchSummary(["brave", "duckduckgo"])).toBe("Tried in this order: Brave Search, then DuckDuckGo (no key). Providers left out are never used.");
    expect(webSearchSummary(undefined)).toContain("Default");
  });
});
