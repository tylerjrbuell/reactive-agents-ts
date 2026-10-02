# Tool Integration -- Reactive Agents playground

A live-data pipeline assembled from tool calls: the agent fetches real
crypto prices (`crypto-price`, CoinGecko public API, no key), does the
portfolio math in a sandbox (`code-execute`), and saves a working note
(`recall`) -- all with zero extra API keys beyond your LLM provider.

## Run it

1. Open the **`.env`** tab.
2. Paste a key (any one works, Gemini is free-tier): `GOOGLE_API_KEY=...`
   from <https://ai.google.dev>. The demo auto-detects the provider.
3. Click the **restart** (arrow) button in the terminal.

No key? It prints setup instructions and exits cleanly -- nothing breaks.

## What you're watching

- **explicit tool opt-in** -- built-ins only reach the model's schema when
  you name them: `.withTools({ builtins: ["crypto-price", "code-execute"] })`
- **live tool events** -- every `ToolCallStarted` / `ToolCallCompleted`
  streams to the terminal as the harness dispatches work
- **per-tool summary** -- call counts and average latency, straight from
  the event bus

## Files

- **`src/agent.ts`** -- agent code: a ReAct loop over a curated tool surface.
- **`src/env-setup.ts`** -- provider auto-detection + run summary helper.
- **`.env`** -- your API key + optional `PROVIDER` / `TASK` / `MODEL`.

## Try next

- Set `TASK=...` in `.env` to give the agent a different challenge.
- Try `TASK=Get the price of DOGE and compare it to SHIBA INU...`.
- Ask for a tool you did NOT opt in to -- the deny behavior is the lesson.
