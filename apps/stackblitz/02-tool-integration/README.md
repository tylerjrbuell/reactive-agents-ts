# Tool Integration — Reactive Agents playground

An agent that uses built-in tools (`code-execute`, `scratchpad-write`)
inside the WebContainer sandbox. No extra API keys beyond the LLM provider.

## Run it

1. Open the **`.env`** tab.
2. Paste a free Gemini key after `GOOGLE_API_KEY=` — get one at
   <https://ai.google.dev> (no credit card).
3. Click the **restart** (↺) button in the terminal.

No key? It prints setup instructions and exits cleanly — nothing breaks.

## Files

- **`src/agent.ts`** — agent code: a ReAct loop with tools enabled.
- **`.env`** — your API key + optional `TASK` / `MODEL` overrides.

## Try next

- Set `TASK=...` in `.env` to give the agent a different challenge.
- Watch the terminal: each tool call is printed as it happens.
