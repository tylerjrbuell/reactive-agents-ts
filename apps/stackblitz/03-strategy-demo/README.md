# Strategy Demo -- Reactive Agents playground

Runs the same task through three reasoning strategies -- `reactive`,
`plan-execute-reflect`, and `adaptive` -- side by side, each capped with
a token budget, and tabulates steps, tokens, evidence verdict, and the
strategy actually selected (for `adaptive`, the router's pick).

## Run it

1. Open the **`.env`** tab.
2. Paste a key (any one works, Gemini is free-tier): `GOOGLE_API_KEY=...`
   from <https://ai.google.dev>. The demo auto-detects the provider.
3. Click the **restart** (arrow) button in the terminal.

No key? It prints setup instructions and exits cleanly -- nothing breaks.

## What you're watching

- **adaptive routing** -- you ask for `adaptive` and never pick a strategy;
  the framework analyzes the task and routes it, and `strategyUsed` in the
  results table reports the sub-strategy it actually selected
- **budget enforcement** -- every run declares `.withBudget({ tokenLimit })`,
  enforced at RUN level: once cumulative spend crosses the cap the run stops
  launching new step waves and passes, and ships an honest partial
- **evidence verdicts** -- each run's receipt grades the answer's evidence
  trail, shown per strategy in the comparison table

## Files

- **`src/agent.ts`** -- runs all strategies and tabulates the results.
- **`src/env-setup.ts`** -- provider auto-detection + run summary helper.
- **`.env`** -- API key + optional `STRATEGIES` / `BUDGET_TOKENS` / `TASK` / `MODEL`.

## Try next

- Set `STRATEGIES=reactive,tree-of-thought` in `.env` for a different face-off.
- Lower `BUDGET_TOKENS` (try `3500`) and watch a long strategy cross its cap
  mid-run, halt further work, and ship an honest partial instead.
- Set `TASK=...` to compare strategies on your own prompt.
