# Hello Agent -- Reactive Agents playground

The smallest full circle: the agent streams its answer token-by-token,
announces every reasoning iteration, and ends with an evidence receipt
that grades *how* the answer was produced.

## Run it

1. Open the **`.env`** tab.
2. Paste a key (any one works, Gemini is free-tier): `GOOGLE_API_KEY=...`
   from <https://ai.google.dev>. The demo auto-detects the provider.
3. Click the **restart** (arrow) button in the terminal.

No key? It prints setup instructions and exits cleanly -- nothing breaks.

## What you're watching

- **streamed output** -- tokens arrive as the model generates them
- **per-iteration progress** -- the harness reports each reasoning step
- **evidence receipt** -- the terminal run reports a verdict grading the
  evidence trail behind the answer (not a truth certificate)

## Files

- **`src/agent.ts`** -- the agent code. Edit it, restart the terminal to rerun.
- **`src/env-setup.ts`** -- provider auto-detection + run summary helper.
- **`.env`** -- your API key + optional `PROVIDER` / `QUESTION` / `MODEL`.

## Try next

- Set `QUESTION=...` in `.env` to ask anything.
- Swap in `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GROQ_API_KEY` instead of Gemini.
- Point at local Ollama (see commented block in `.env`, Chrome only).
