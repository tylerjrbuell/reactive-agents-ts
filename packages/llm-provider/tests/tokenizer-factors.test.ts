// packages/llm-provider/tests/tokenizer-factors.test.ts
// Run: bun test packages/llm-provider/tests/tokenizer-factors.test.ts --timeout 15000
//
// W2c (plan 2.3) — tokenizer-aware estimation. Pins:
//   - the per-family DENSE-regime correction factor on JSON-classified text
//   - zero behavior change for prose/mixed branches (measured: naive already
//     OVER-counts prose by 11-23% — shrinking it would be the unsafe direction)
//   - unknown family / no arg => exactly the legacy estimate
//   - the shipped calibrations/tokenizer-factors.json stays schema-valid and
//     in lockstep with the in-code fallback (mirror guard, W2a pattern)
//
// TRUE token counts below are MEASURED, not folklore — provenance in
// .superpowers/sdd/.../w2c-report.md (Method: /api/chat prompt_eval_count,
// stream:false, num_predict:1, localhost:11434, 2026-10-13; the fixture texts
// are the exact strings measured). Tolerance bands are asymmetric and stated.

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import { estimateTokenCount } from "../src/token-counter.js";
import {
  FALLBACK_TOKENIZER_FACTORS,
  loadTokenizerFactors,
} from "../src/tokenizer-factors.js";
import type { LLMMessage } from "../src/types.js";

// ─── Measured fixtures (commit numbers = live prompt_eval_count) ─────────────

// Pure structural JSON (12 records: ids/floats/quotes/braces) — 2140 chars,
// classified DENSE (cpt=3) by the estimator. Measured prompt_eval_count:
//   llama3.1:741  llama3.2:756  qwen3:4b:831  qwen3.5:831 (gemma4:810)
const STRUCTURAL_FIXTURE = JSON.stringify(
  Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    region: ["EMEA", "APAC", "NA", "LATAM", "MEA", "SEA", "EAS", "WAF", "EEU", "SA", "CA", "OCE"][i],
    revenue: 10000 + i * 7777.43,
    quarter: "Q3",
    currency: "USD",
    active: i % 2 === 0,
    tags: ["a" + i, "b" + i, "c" + i],
    meta: { truncated: false, lines: i * 3, bytes: i * 91, recall: null },
  })),
);
const STRUCTURAL_NAIVE = 718; // ceil(2140/3)+4
const STRUCTURAL_TRUE_LLAMA31 = 741;
const STRUCTURAL_TRUE_QWEN3 = 831;

// Meeting-minutes prose — 462 chars, classified PROSE (cpt=4). Measured:
//   llama3.1:92  qwen3:92  gemma4:97  llama3.2:107 — naive OVER-counts.
const PROSE_FIXTURE =
  "The committee reviewed the quarterly report line by line. Several members raised concerns about the timing of the " +
  "deliverables, while others focused on the budget variance between regions. The chair asked for a revised schedule by " +
  "Friday, noting that the client expected the summary ahead of the board meeting. Minutes were taken, action items were " +
  "assigned, and the next session was scheduled for the following week, pending availability of the conference room.";
const PROSE_NAIVE = 120;
const PROSE_TRUE_LLAMA31 = 92;

// Mixed shell (schema-description head + structural tail) — 1515 chars,
// classified MIXED (cpt=3.5). Measured llama3.1:399, qwen3.5:416.
const JSON_HEAVY_FIXTURE = `[{"name":"web-search","description":"Search the web and return a list of relevant results. Provider chain: Tavily (if TAVILY_API_KEY is set) → Brave Search (if BRAVE_SEARCH_API_KEY or BRAVE_API_KEY is set) → Serper/Google (if SERPER_API_KEY is set) → DuckDuckGo instant answers (no key). If a provider has no key, or its request fails or returns no usable rows, the next provider runs automatically until one succeeds or all are exhausted. Use for current information, facts, prices, news, documentation, or anything requiring up-to-date knowledge. Returns an array of results, each with { title, url, content } fields. Read the 'content' field of results to extract the information you need.","inputSchema":{"type":"object","properties":{"query":{"type":"string","description":"The search query. Be specific for better results. Examples: 'Bitcoin price today USD', 'TypeScript async await tutorial 2024', 'Node.js fs.readFile docs'."},"maxResults":{"type":"number","description":"Maximum number of results to return (1–10). Default: 5. Use 3 for quick single-fact lookups, 5 for general research, up to 10 for broad topics."}},"required":["query"]}},{"name":"crypto-price","description":"Get current\nTOOL_RESULT: {"stdout":[{"id":1,"region":"EMEA","revenue":48210.55,"quarter":"Q3","currency":"EUR"},{"id":2,"region":"APAC","revenue":91130.1,"quarter":"Q3","currency":"JPY"},{"id":3,"region":"NA","revenue":120445.99,"quarter":"Q3","currency":"USD"}],"meta":{"truncated":false,"lines":3,"bytes":214,"recall":null}}`;
const JSON_HEAVY_NAIVE = 437; // classified mixed (3.5)
const JSON_HEAVY_TRUE_LLAMA31 = 399;

const msgs = (text: string): readonly LLMMessage[] => [
  { role: "user", content: text },
];

const run = <A>(e: Effect.Effect<A, never>) => Effect.runSync(e);

describe("estimateTokenCount — tokenizer-family dense correction (W2c 2.3)", () => {
  it("baseline: no family arg == legacy naive numbers (no behavior change)", () => {
    expect(run(estimateTokenCount(msgs(STRUCTURAL_FIXTURE)))).toBe(STRUCTURAL_NAIVE);
    expect(run(estimateTokenCount(msgs(PROSE_FIXTURE)))).toBe(PROSE_NAIVE);
    expect(run(estimateTokenCount(msgs(JSON_HEAVY_FIXTURE)))).toBe(JSON_HEAVY_NAIVE);
  }, 15_000);

  it("unknown / unmeasured family => factor 1.0, identical to legacy", () => {
    expect(
      run(estimateTokenCount(msgs(STRUCTURAL_FIXTURE), "unknown")),
    ).toBe(STRUCTURAL_NAIVE);
    expect(
      run(estimateTokenCount(msgs(STRUCTURAL_FIXTURE), "claude")),
    ).toBe(STRUCTURAL_NAIVE);
  }, 15_000);

  it("llama family DENSE fixture: corrected >= naive (ruling 4) and inside asymmetric band of true", () => {
    const corrected = run(estimateTokenCount(msgs(STRUCTURAL_FIXTURE), "llama"));
    expect(corrected).toBeGreaterThanOrEqual(STRUCTURAL_NAIVE);
    // Band: corrected within [0.9x, 1.3x] of the measured llama-family true
    // counts (741 llama3.1 … 831 qwen3 — one registry family spans both
    // vocabularies; the band absorbs that scatter and is the tolerance the
    // mission asks to pin, disclosed in the report arithmetic).
    for (const trueTok of [STRUCTURAL_TRUE_LLAMA31, STRUCTURAL_TRUE_QWEN3]) {
      expect(corrected).toBeGreaterThanOrEqual(trueTok * 0.9);
      expect(corrected).toBeLessThanOrEqual(trueTok * 1.3);
    }
    // Exact arithmetic pin: dense branch divisor 3 / 1.25 = 2.4 →
    // ceil(2140/2.4)+4 = 896.
    expect(corrected).toBe(Math.ceil(STRUCTURAL_FIXTURE.length / (3 / 1.25)) + 4);
  }, 15_000);

  it("llama family PROSE fixture: untouched (naive already over-counts prose — shrinking is the unsafe direction)", () => {
    const corrected = run(estimateTokenCount(msgs(PROSE_FIXTURE), "llama"));
    expect(corrected).toBe(PROSE_NAIVE);
    // conservative-direction sanity: the untouched naive is still within the
    // disclosed over-count band of the measured true count (naive ≥ true).
    expect(PROSE_NAIVE).toBeGreaterThanOrEqual(PROSE_TRUE_LLAMA31);
    expect(corrected).toBeLessThanOrEqual(PROSE_TRUE_LLAMA31 * 1.4);
  }, 15_000);

  it("llama family MIXED (json-heavy) fixture: corrected >= naive, within 15% of true", () => {
    const corrected = run(estimateTokenCount(msgs(JSON_HEAVY_FIXTURE), "llama"));
    expect(corrected).toBeGreaterThanOrEqual(JSON_HEAVY_NAIVE);
    expect(corrected).toBeLessThanOrEqual(JSON_HEAVY_TRUE_LLAMA31 * 1.15);
  }, 15_000);

  it("tool_use block JSON gets the dense correction too", () => {
    const withBlock: readonly LLMMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "http-get",
            input: { url: "https://example.com/api/v1/ledger.json", headers: { "x-id": "42" } },
          },
        ],
      },
    ];
    const naive = run(estimateTokenCount(withBlock));
    const corrected = run(estimateTokenCount(withBlock, "llama"));
    expect(corrected).toBeGreaterThanOrEqual(naive);
  }, 15_000);
});

describe("tokenizer factor table — provenance & mirror guards", () => {
  it("shipped calibrations/tokenizer-factors.json matches the in-code fallback", () => {
    const file = path.join(import.meta.dir, "../src/calibrations/tokenizer-factors.json");
    expect(fs.existsSync(file)).toBe(true);
    const fromFile = loadTokenizerFactors(file);
    expect(fromFile).toEqual(FALLBACK_TOKENIZER_FACTORS);
  }, 15_000);

  it("llama dense factor is MEASURED-range, not folklore (guards against a 1.35-style re-seed)", () => {
    const llama = FALLBACK_TOKENIZER_FACTORS.families.llama?.dense;
    expect(llama).toBeDefined();
    // Measured range on this box: live dense 1.032-1.157, committed FC-residual
    // 1.245. The shipped value must sit in [1.0, 1.30] and specifically NOT be
    // the plan's unmeasured seed 1.35.
    expect(llama!).toBeGreaterThanOrEqual(1.0);
    expect(llama!).toBeLessThanOrEqual(1.3);
    expect(llama!).not.toBe(1.35);
  }, 15_000);

  it("a corrupt/unreadable factor file falls back to the in-code table (never throws)", () => {
    const bogus = loadTokenizerFactors(path.join(import.meta.dir, "../src/calibrations/__no_such__.json"));
    expect(bogus).toEqual(FALLBACK_TOKENIZER_FACTORS);
  }, 15_000);
});

describe("probe tokenizerFamily registry — qwen models land in the llama bucket (W2c)", () => {
  it("maps GGUF family 'qwen3' (and qwen*) to Capability tokenizerFamily 'llama'", async () => {
    // The dense-correction factors are keyed on the Capability enum; the
    // registry convention (STATIC_CAPABILITIES qwen entries) already buckets
    // qwen tokenizers as "llama". Before this, the probe returned "unknown"
    // for every qwen model, leaving measured factors unreachable for exactly
    // the local models that overflow.
    const { probeOllamaCapability, _resetProbeCacheForTesting } = await import(
      "../src/providers/local-probe.js"
    );
    const { setCapabilityStoreDirForTesting } = await import("../src/capability-store.js");
    const storeDir = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "ra-tokfam-"));
    setCapabilityStoreDirForTesting(storeDir);
    _resetProbeCacheForTesting();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          capabilities: ["completion"],
          details: { family: "qwen3", parameter_size: "4.0B" },
          model_info: { "qwen3.context_length": 40_960 },
        }),
        { status: 200 },
      )) as typeof globalThis.fetch;
    try {
      const cap = await probeOllamaCapability("qwen-probe:v1", "http://localhost:11434");
      expect(cap!.tokenizerFamily).toBe("llama");
    } finally {
      globalThis.fetch = originalFetch;
      setCapabilityStoreDirForTesting(null);
      _resetProbeCacheForTesting();
      fs.rmSync(storeDir, { recursive: true, force: true });
    }
  }, 15_000);
});
