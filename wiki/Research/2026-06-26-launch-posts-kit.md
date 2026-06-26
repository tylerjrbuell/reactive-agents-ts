# Launch Posts Kit — Reactive Agents

**Date:** 2026-06-26 · Drafts for distribution. Post from your accounts. **Honesty first** — HN/Reddit punish marketing; lead with the real technical novelty and be candid about the early-access stage (~16 stars, v0.12.0). Engage in comments fast; never astroturf or use alt accounts.

The three genuine hooks, in priority:
1. **Effect-TS end-to-end type safety** — typed tool I/O, tagged errors, schema-validated boundaries.
2. **Local-to-frontier parity** — the same agent code runs on a 4B Ollama model and on Claude/GPT/Gemini.
3. **Observable 12-phase execution engine** — see/steer every decision (think→act→observe→verify…).

---

## 1. Show HN

**Title** (pick one, ≤80 chars, no hype):
- `Show HN: Reactive Agents – Type-safe TS agents that run on local 4B or frontier LLMs`
- `Show HN: A TypeScript AI agent framework on Effect-TS, local Ollama to frontier`

**Body:**
```
Hi HN — I've been building Reactive Agents, a TypeScript framework for building
AI agents, and wanted to share it for feedback.

The two things I cared about most:

1. Type safety, end to end. It's built on Effect-TS, so tool inputs/outputs,
   hook contexts, and model responses are typed, and errors are tagged values
   in an explicit error channel rather than thrown exceptions. Structured
   output is validated against a schema before it reaches you.

2. Local-to-frontier parity. The same agent code runs on a 4B-parameter local
   Ollama model and on Claude/GPT/Gemini — you swap one line. Model-adaptive
   context profiles and a tool-call "healing" pass are what make small local
   models actually usable in an agent loop, not just frontier APIs.

Under the hood it's a 12-phase execution engine (bootstrap → guardrail →
cost-route → think/act/observe loop → verify → … → complete) with before/
after/error hooks on every phase, so you can observe and steer each decision.
Six reasoning strategies (ReAct, Reflexion, Plan-Execute, Tree-of-Thought,
Adaptive, Code-Action), MCP-native tools, A2A multi-agent, memory, guardrails,
and cost budgets are all opt-in layers — you add what you need.

  bun add reactive-agents

  const agent = await ReactiveAgents.create()
    .withProvider("ollama").withModel("qwen3:4b")
    .withReasoning().withTools().build();
  const result = await agent.run("...");

It's early access (v0.12.0), MIT, ~6,500 tests. It's honestly not as battle-
tested or as large an ecosystem as LangGraph or the Vercel AI SDK yet — there
are comparison pages in the docs that try to be fair about where each wins.

Repo: https://github.com/tylerjrbuell/reactive-agents-ts
Docs: https://docs.reactiveagents.dev

Would love feedback — especially on the local-model angle and the API.
```
**Timing:** weekday ~8–10am ET. Reply to every comment for the first few hours.

---

## 2. Reddit — r/LocalLLaMA (strongest fit; lead with the local angle)

**Title:** `I built a TypeScript agent framework where the same code runs on a 4B local model or a frontier API`

**Body:**
```
I kept hitting the same wall: agent frameworks assume GPT-4-class models and
fall apart on small local ones. So I built Reactive Agents around local-first
parity — the same builder code runs on a 4B Ollama model or a frontier API,
one line different.

The parts that actually matter for small local models:
- Model-adaptive context profiles (lean prompts, aggressive compaction for the
  "local" tier).
- A healing pipeline that normalizes malformed tool names/params/paths before
  execution — small models mangle tool calls a lot, and this recovers most of
  them.
- Adaptive tool calling: probes whether the model does native function calling
  vs needs text-parsed tool calls (XML/JSON/pseudo-code).

  const agent = await ReactiveAgents.create()
    .withProvider("ollama").withModel({ model: "qwen3:4b", numCtx: 32768 })
    .withReasoning().withTools().build();

It's TypeScript, built on Effect-TS (fully typed), MIT, early access. Curious
what models you'd want me to test against — and whether the healing approach
matches what you've seen with small-model tool calling.

Repo: https://github.com/tylerjrbuell/reactive-agents-ts
Local models guide: https://docs.reactiveagents.dev/cookbook/local-agent-ollama/
```
**Note:** r/LocalLLaMA is anti-marketing — keep it a build story + a genuine question. Flair as appropriate (Resources/Tutorial).

---

## 3. Reddit — r/typescript (lead with the type-safety angle)

**Title:** `Reactive Agents — a type-safe AI agent framework built on Effect-TS`

**Body:**
```
Sharing a project I've been building: an AI agent framework that's TypeScript-
first and built on Effect-TS, so the whole pipeline is typed — tool inputs/
outputs, lifecycle hooks, and model responses — and errors are tagged values
in an explicit error channel instead of thrown exceptions. Structured output
is schema-validated before you get it.

Beyond types it has a 12-phase execution engine with per-phase hooks, six
reasoning strategies, MCP-native tools, and it runs the same code on local
Ollama models and frontier APIs.

  const agent = await ReactiveAgents.create()
    .withProvider("anthropic").withModel("claude-sonnet-4-6")
    .withReasoning().withTools().build();

Early access, MIT, ~6,500 tests. Interested in feedback from people who've
used Effect — particularly on the builder API and whether the error-channel
ergonomics feel right.

Repo: https://github.com/tylerjrbuell/reactive-agents-ts
Docs: https://docs.reactiveagents.dev
```
Also consider r/LLMDevs and r/EffectTS (if active) with the same angle.

---

## 4. Dev.to / Hashnode article (evergreen SEO; set canonical → docs pillar)

**Title:** `How to Build a Type-Safe AI Agent in TypeScript (that runs locally or on frontier models)`

**Canonical URL:** `https://docs.reactiveagents.dev/guides/build-ai-agents-typescript/` (set canonical so the docs page gets SEO credit, not Dev.to).

**Tags:** `typescript`, `ai`, `llm`, `webdev`

**Outline:**
1. The problem — agent frameworks are dynamically typed, opaque, and assume frontier models.
2. What "type-safe agent" means here — Effect-TS, typed tools, tagged errors, schema-validated output.
3. Build a minimal agent (code).
4. Add tools (ToolBuilder + MCP) (code).
5. Run it locally on Ollama, then swap to a frontier model — one line (the parity payoff).
6. Observe it — the 12-phase engine + hooks.
7. When to use this vs LangGraph / Vercel AI SDK (link the comparison pages — fair framing).
8. CTA → docs quickstart.

Reuse code from the pillar + cookbook tutorials verbatim (already source-verified). Keep it a genuine tutorial, not an ad.

---

## After posting
- Add real testimonials/quotes to the README "Used By" block as they come in.
- A strong HN/Reddit day that pushes stars past a few hundred unlocks the held lists (kyrolabs, steven2358) and Product Hunt.
- Cross-link: the Dev.to article and any blog coverage are backlinks — track them.
