# Strategy Demo — Reactive Agents playground

Runs the same task with two reasoning strategies and prints a side-by-side
comparison of steps, tokens, and duration.

## Run it

1. Open the **`.env`** tab.
2. Paste a free Gemini key after `GOOGLE_API_KEY=` — get one at
   <https://ai.google.dev> (no credit card).
3. Click the **restart** (↺) button in the terminal.

No key? It prints setup instructions and exits cleanly — nothing breaks.

## Files

- **`src/agent.ts`** — runs both strategies and tabulates the result.
- **`.env`** — API key + optional `STRATEGY_B` / `TASK` / `MODEL`.

## Try next

- Set `STRATEGY_B` in `.env` to `tree-of-thought`, `reflexion`, or
  `adaptive` and compare against the default `reactive`.
- Set `TASK=...` to compare strategies on your own prompt.
