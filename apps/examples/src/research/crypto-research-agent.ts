/**
 * Example: Crypto Research Agent
 *
 * A research agent that pulls live cryptocurrency prices via the built-in
 * `crypto-price` tool (CoinGecko's free public API — no API key required),
 * synthesizes a short markdown briefing, and writes it to disk with the
 * built-in `file-write` tool.
 *
 * Built-in tools used (no custom fetch code needed):
 *   - crypto-price : batch price lookup for BTC/ETH/SOL/... from CoinGecko
 *   - file-write   : persist the markdown report
 *
 * Pattern (mirrors apps/docs/skills/recipe-research-agent): reactive loop,
 * tool-restricted via allowedTools, deterministic witness.
 *
 * Test vs Live:
 *   - Test  (provider === "test"): the real built-in `crypto-price` handler
 *     hits the network, so test mode SHADOWS it with a canned mock tool of the
 *     same name (custom tools register after built-ins → last-writer-wins in
 *     the registry). Fully offline + deterministic.
 *   - Live  (anthropic/openai/ollama/...): the real built-in is used and hits
 *     CoinGecko for live prices.
 *
 * Usage (live):
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/research/crypto-research-agent.ts
 *
 * Usage (test, offline):
 *   bun run apps/examples/src/research/crypto-research-agent.ts
 */

import { ReactiveAgents } from "reactive-agents";
import { Effect } from "effect";
import { existsSync, unlinkSync, readFileSync } from "node:fs";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

const REPORT_FILE = "./crypto-research-report.md";
const COINS = ["BTC", "ETH", "SOL"];

// Canned CoinGecko-shaped payload. The test provider doesn't dispatch tools
// today, but injecting a same-named mock SHADOWS the real built-in (custom
// tools register after built-ins → last-writer-wins) so the example stays
// offline even if the harness ever wires test-mode tool dispatch.
const MOCK_PRICES = {
  prices: [
    { symbol: "BTC", name: "Bitcoin", price: 67_000, currency: "usd" },
    { symbol: "ETH", name: "Ethereum", price: 3_200, currency: "usd" },
    { symbol: "SOL", name: "Solana", price: 145, currency: "usd" },
  ],
  currency: "usd",
  source: "coingecko" as const,
};

// Mock tool: same NAME as the built-in (`crypto-price`) → shadows it in the
// registry. `source: "function"` marks it as a user tool.
const mockCryptoPriceTool = {
  definition: {
    name: "crypto-price",
    description:
      "Get current cryptocurrency prices (test-mode mock — no network).",
    parameters: [
      {
        name: "coins",
        type: "array" as const,
        items: { type: "string" },
        description: 'Coin symbols, e.g. ["BTC","ETH"].',
        required: true,
      },
      {
        name: "currency",
        type: "string" as const,
        description: 'Quote currency, default "usd".',
        required: false,
        default: "usd",
      },
    ],
    riskLevel: "low" as const,
    timeoutMs: 10_000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: (_args: Record<string, unknown>) => Effect.succeed(MOCK_PRICES),
};

const REPORT_MD = `# Crypto Research Briefing

| Symbol | Name | Price (USD) |
| --- | --- | --- |
| BTC | Bitcoin | $67,000 |
| ETH | Ethereum | $3,200 |
| SOL | Solana | $145 |

## Notes
Prices pulled from CoinGecko via the crypto-price tool.

ReportRun: ok
`;

const systemPrompt = `You are a cryptocurrency research agent.

For the requested coins:
1. Call the crypto-price tool ONCE with ALL requested coin symbols batched into
   the "coins" array (do not call it once per coin).
2. Write a concise Markdown briefing with:
   - Title "# Crypto Research Briefing"
   - A table of Symbol | Name | Price (USD)
   - A short "## Notes" paragraph on data source.
   - A final line: ReportRun: ok | partial | failed
3. Save it with file-write to the given path (overwrite is fine).
4. End your reply with: FINAL ANSWER: wrote <path>`;

export async function run(opts?: {
  provider?: string;
  model?: string;
}): Promise<ExampleResult> {
  const start = Date.now();

  type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";
  const provider = (opts?.provider ??
    (process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")) as PN;
  const isTest = provider === "test";

  // Clean any prior run
  try {
    if (existsSync(REPORT_FILE)) unlinkSync(REPORT_FILE);
  } catch {}

  console.log("\n=== Crypto Research Agent ===");
  console.log(`Mode: ${isTest ? "TEST (mock prices, offline)" : `LIVE (${provider}, real CoinGecko)`}\n`);

  let b = ReactiveAgents.create()
    .withName("crypto-researcher")
    .withProvider(provider)
    .withSystemPrompt(systemPrompt)
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(8);
  if (opts?.model) b = b.withModel(opts.model);

  // Live: real built-in `crypto-price` (CoinGecko). Test: inject the mock of
  // the same name to shadow the real (network-hitting) handler.
  b = b.withTools({
    allowedTools: ["crypto-price", "file-write"],
    ...(isTest ? { tools: [mockCryptoPriceTool] } : {}),
  });

  if (isTest) {
    // NOTE: under the deterministic test provider, built-in tools are NOT
    // dispatched (neither native `toolCall` nor `ACTION:` text reaches the act
    // phase in this harness — see tools/healing-malformed-tool-call.ts). So the
    // test scenario returns the finished briefing directly as the FINAL ANSWER
    // and the witness asserts on the OUTPUT. Real tool execution (CoinGecko
    // fetch + file-write) happens in LIVE mode against a real provider.
    b = b.withTestScenario([
      { text: `${REPORT_MD}\nFINAL ANSWER: wrote ${REPORT_FILE}` },
    ]);
  }

  const agent = await b.build();

  const result = await agent.run(
    `Research the current prices of ${COINS.join(", ")} and save a briefing to ${REPORT_FILE}.`
  );

  console.log(`Output: ${result.output}`);
  console.log(`Steps: ${result.metadata.stepsCount}`);

  // Witness. Test mode: tools aren't dispatched, so assert the briefing came
  // back on the OUTPUT (success + a coin name present). Live mode: the real
  // file-write tool ran — if the report exists, verify its contents too.
  const outputMentionsCoin = /bitcoin|ethereum|solana/i.test(result.output);
  const fileWritten = existsSync(REPORT_FILE);
  let fileMentionsCoin = false;
  if (fileWritten) {
    try {
      const body = readFileSync(REPORT_FILE, "utf8");
      fileMentionsCoin = /bitcoin|ethereum|solana/i.test(body);
      console.log(`Report written (${body.length} bytes)`);
    } catch {}
  }

  // Cleanup any report residue (test or live).
  try {
    if (fileWritten) unlinkSync(REPORT_FILE);
  } catch {}

  // Live witness is stricter: if a file was produced it must contain a coin.
  const passed =
    result.success &&
    (outputMentionsCoin || fileMentionsCoin) &&
    (!fileWritten || fileMentionsCoin);
  await agent.dispose();

  return {
    passed,
    output: result.output,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
