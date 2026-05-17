# Hello Agent — Reactive Agents playground

Simplest possible agent: one question in, one answer out.

## Run it

1. Open the **`.env`** tab.
2. Paste a free Gemini key after `GOOGLE_API_KEY=` — get one at
   <https://ai.google.dev> (no credit card).
3. Click the **restart** (↺) button in the terminal.

No key? It prints setup instructions and exits cleanly — nothing breaks.

## Files

- **`src/agent.ts`** — the agent code. Edit it, restart the terminal to rerun.
- **`.env`** — your API key + optional `QUESTION` / `MODEL` overrides.

## Try next

- Set `QUESTION=...` in `.env` to ask anything.
- Swap `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` instead of Gemini.
- Point at local Ollama (see commented block in `.env`, Chrome only).
