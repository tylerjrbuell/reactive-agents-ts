import { Effect } from "effect";
import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

const COINGECKO_RETRY_ATTEMPTS = 3;
const COINGECKO_RETRY_BASE_MS = 2_000;
const CACHE_TTL_MS = 60_000;

let retryBaseMs = COINGECKO_RETRY_BASE_MS;

// Module-level price cache — keyed by currency. One bulk fetch populates all coins.
const priceCache = new Map<string, { data: Record<string, number>; fetchedAt: number }>();

/** Exported for tests only — clears the price cache between test cases. */
export function clearPriceCache(): void { priceCache.clear(); }
/** Exported for tests only — override the retry base delay (use 0 to skip waits). */
export function setRetryBaseMs(ms: number): void { retryBaseMs = ms; }

async function geckoFetchWithRetry(url: string): Promise<Response> {
  let last: Response | undefined;
  for (let attempt = 0; attempt < COINGECKO_RETRY_ATTEMPTS; attempt++) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (response.status !== 429) return response;
    last = response;
    if (attempt < COINGECKO_RETRY_ATTEMPTS - 1) {
      await new Promise<void>((r) => setTimeout(r, retryBaseMs * Math.pow(2, attempt)));
    }
  }
  return last!;
}

/**
 * Fetch prices for ALL known coins in one CoinGecko call and cache them.
 * Subsequent calls within CACHE_TTL_MS return immediately from cache.
 */
async function getPricesFromCache(currency: string): Promise<Record<string, number>> {
  const cached = priceCache.get(currency);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const allIds = [...new Set(Object.values(COIN_MAP).map((c) => c.id))].join(",");
  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", allIds);
  url.searchParams.set("vs_currencies", currency);

  const response = await geckoFetchWithRetry(url.toString());
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`CoinGecko returned HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const raw = (await response.json()) as Record<string, Record<string, number>>;
  const flat: Record<string, number> = {};
  for (const [id, vals] of Object.entries(raw)) {
    if (typeof vals[currency] === "number") flat[id] = vals[currency];
  }

  priceCache.set(currency, { data: flat, fetchedAt: Date.now() });
  return flat;
}

// CoinGecko IDs for common coins — symbol → { id, name }
const COIN_MAP: Record<string, { id: string; name: string }> = {
  BTC: { id: "bitcoin", name: "Bitcoin" },
  ETH: { id: "ethereum", name: "Ethereum" },
  XRP: { id: "ripple", name: "XRP" },
  XLM: { id: "stellar", name: "Stellar" },
  SOL: { id: "solana", name: "Solana" },
  ADA: { id: "cardano", name: "Cardano" },
  DOGE: { id: "dogecoin", name: "Dogecoin" },
  DOT: { id: "polkadot", name: "Polkadot" },
  AVAX: { id: "avalanche-2", name: "Avalanche" },
  MATIC: { id: "matic-network", name: "Polygon" },
  POL: { id: "matic-network", name: "Polygon" },
  LINK: { id: "chainlink", name: "Chainlink" },
  LTC: { id: "litecoin", name: "Litecoin" },
  BCH: { id: "bitcoin-cash", name: "Bitcoin Cash" },
  UNI: { id: "uniswap", name: "Uniswap" },
  ATOM: { id: "cosmos", name: "Cosmos" },
  NEAR: { id: "near", name: "NEAR Protocol" },
  ARB: { id: "arbitrum", name: "Arbitrum" },
  OP: { id: "optimism", name: "Optimism" },
  SUI: { id: "sui", name: "Sui" },
  APT: { id: "aptos", name: "Aptos" },
  TRX: { id: "tron", name: "TRON" },
  TON: { id: "the-open-network", name: "Toncoin" },
  SHIB: { id: "shiba-inu", name: "Shiba Inu" },
  PEPE: { id: "pepe", name: "Pepe" },
  FIL: { id: "filecoin", name: "Filecoin" },
  ICP: { id: "internet-computer", name: "Internet Computer" },
  VET: { id: "vechain", name: "VeChain" },
  ALGO: { id: "algorand", name: "Algorand" },
  HBAR: { id: "hedera-hashgraph", name: "Hedera" },
};

export type CryptoPriceRow = {
  readonly symbol: string;
  readonly name: string;
  readonly price: number | null;
  readonly currency: string;
  readonly notFound?: true;
};

export type CryptoPriceResult = {
  readonly prices: ReadonlyArray<CryptoPriceRow>;
  readonly currency: string;
  readonly source: "coingecko";
};

export const cryptoPriceTool: ToolDefinition = {
  name: "crypto-price",
  description:
    "Get current cryptocurrency prices from CoinGecko's free public API. No API key required. " +
    "IMPORTANT: Pass ALL coins you need in ONE call — do not call this tool multiple times for different coins. " +
    "Supported symbols: BTC, ETH, XRP, XLM, SOL, ADA, DOGE, DOT, AVAX, MATIC, LINK, LTC, " +
    "BCH, UNI, ATOM, NEAR, ARB, OP, SUI, APT, TRX, TON, SHIB, FIL, ICP, VET, ALGO, HBAR. " +
    "Use this instead of web-search when you need crypto prices.",
  parameters: [
    {
      name: "coins",
      type: "array",
      items: { type: "string" },
      description:
        "Array of coin symbols to fetch in one request, e.g. [\"BTC\", \"ETH\", \"XRP\", \"XLM\"]. " +
        "Always batch multiple coins into a single call. Case-insensitive.",
      required: true,
    },
    {
      name: "currency",
      type: "string",
      description: "Quote currency. Default: \"usd\". Also supports: eur, gbp, jpy, btc, eth.",
      required: false,
      default: "usd",
    },
  ],
  returnType:
    "{ prices: Array<{ symbol: string, name: string, price: number | null }> }",
  category: "data",
  riskLevel: "low",
  timeoutMs: 10_000,
  requiresApproval: false,
  source: "builtin",
};

export const cryptoPriceHandler = (
  args: Record<string, unknown>,
): Effect.Effect<CryptoPriceResult, ToolExecutionError> =>
  Effect.tryPromise({
    try: async () => {
      const rawCoins = args.coins as string[];
      const currency = ((args.currency as string | undefined) ?? "usd").toLowerCase();

      const requested = rawCoins.map((c) => c.toUpperCase().trim());
      const known = requested.filter((sym) => sym in COIN_MAP);
      const unknown = requested.filter((sym) => !(sym in COIN_MAP));

      const geckoData = known.length > 0 ? await getPricesFromCache(currency) : {};

      const prices: CryptoPriceRow[] = [
        ...requested
          .filter((sym) => sym in COIN_MAP)
          .map((sym) => {
            const info = COIN_MAP[sym]!;
            const price = geckoData[info.id] ?? null;
            return { symbol: sym, name: info.name, price, currency };
          }),
        ...unknown.map((sym) => ({
          symbol: sym,
          name: sym,
          price: null as null,
          currency,
          notFound: true as const,
        })),
      ];

      return { prices, currency, source: "coingecko" as const };
    },
    catch: (e) =>
      new ToolExecutionError({
        message: `Crypto price lookup failed: ${e}`,
        toolName: "crypto-price",
        cause: e,
      }),
  });
