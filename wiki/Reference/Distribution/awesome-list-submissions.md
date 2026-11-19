---
type: reference
status: active
created: 2026-05-05
updated: 2026-11-18
tags: [distribution, launch, awesome-lists]
---

# Awesome list submissions

One PR per list, for long-tail discovery. Rewritten 2026-11-18 for the 0.19.0 launch. The old entries had stale
counts (5 strategies, 6 providers, 19 packages) and claims the docs no longer make.

**Before each PR:**

1. Open the list's CONTRIBUTING file and README. Copy the exact entry format and pick the section that exists today.
   Sections below are best guesses and have not been checked against each list's current layout.
2. Check numbers against `apps/docs/src/data/metrics.json` on the day you submit: 8 strategies, 8 providers,
   33 public packages as of 2026-11-18.
3. Some lists reject projects under a star or age threshold. Read the rules first. Don't open a PR that breaks them.
4. Write the PR text yourself. Keep it one line, factual, no superlatives.
5. Space the PRs out. Don't open them all on launch day.

**Wording rules** (from `wiki/Research/2026-11-18-agent-harness-market-landscape.md`):

- Don't say "signed receipts". Signing is opt-in.
- Don't say `rax-diagnose` explains "every failure". It can return `undetermined`.
- Don't say "production-grade" or "guarantee".
- Once the hero tagline is chosen, swap it into the entries below. Keep the factual clause.

---

## awesome-typescript

Repo: https://github.com/dzharii/awesome-typescript (verify section: AI / LLM, or Libraries)

> - [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) - Open-source TypeScript agent harness
>   on Effect-TS. Every run leaves a local trace and an evidence receipt, `rax-diagnose` names why a failed run
>   failed, and the same code runs on local Ollama models or frontier APIs.

PR title: `Add Reactive Agents (TypeScript agent harness)`

## awesome-ai-agents (e2b)

Repo: https://github.com/e2b-dev/awesome-ai-agents (verify: this list has used a form and its own entry
template; follow whatever the README says now)

> **[Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts)** - Open-source TypeScript agent
> harness. 8 reasoning strategies, 8 providers including Ollama, a trace and evidence receipt on every run, and a
> zero-token CLI (`rax-diagnose`) that names why a failed run failed. Optional local studio (Cortex).

## awesome-effect

Repo: https://github.com/mikearnaldi/awesome-effect (verify the repo is still maintained and has an apps or AI
section)

> - [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) - Agent harness built from Effect
>   services and Layers: typed errors, swappable providers, memory and tools as Layers, a structured trace per run.

## awesome-llm-apps

Repo: https://github.com/Shubhamsaboo/awesome-llm-apps (verify: this list mostly takes runnable apps, not
frameworks; submit an example app such as a `rax init` template only if it fits)

> - [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) - TypeScript agents that run on a local
>   Ollama model or a frontier API with the same code; each run leaves a trace and an evidence receipt.

## Candidates to check (not yet verified to exist or accept frameworks)

- Ollama community integrations list in the Ollama README (the most relevant audience for the local-model story)
- awesome-mcp lists, only if the MCP client is the thing being listed
- awesome-local-ai / awesome-local-llm style lists
