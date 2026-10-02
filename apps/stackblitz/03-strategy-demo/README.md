# Strategy Demo -- Reactive Agents playground

Runs the same task through three reasoning strategies -- `reactive`,
`plan-execute-reflect`, and `adaptive` -- side by side, each capped with
a token budget, and tabulates steps, tokens, evidence verdict, and the
strategy metadata the framework reports for each run.

## Run it

1. Open the **`.env`** tab.
2. Paste a key (any one works, Gemini is free-tier): `GOOGLE_API_KEY=...`
   from <https://ai.google.dev>. The demo auto-detects the provider.
3. Click the **restart** (arrow) button in the terminal.

No key? It prints setup instructions and exits cleanly -- nothing breaks.

## What you're watching

- **adaptive routing** -- you ask for `adaptive` and never pick a strategy;
  the framework analyzes the task and routes it, and every run carries its
  strategy metadata (`strategyUsed`) in the results table
- **budget guards** -- every run declares `.withBudget({ tokenLimit })`;
  the reactive kernel's arbitrator checks spend before each intent, and
  the table reports every run's usage against its cap
- **evidence verdicts** -- each run's receipt grades the answer's evidence
  trail, shown per strategy in the comparison table

## Files

- **`src/agent.ts`** -- runs all strategies and tabulates the results.
- **`src/env-setup.ts`** -- provider auto-detection + run summary helper.
- **`.env`** -- API key + optional `STRATEGIES` / `BUDGET_TOKENS` / `TASK` / `MODEL`.

## Try next

- Set `STRATEGIES=reactive,tree-of-thought` in `.env` for a different face-off.
- Lower `BUDGET_TOKENS` and watch the reactive/adaptive runs wind down
  against the cap (multi-pass strategies report usage against it too).
- Set `TASK=...` to compare strategies on your own prompt.
