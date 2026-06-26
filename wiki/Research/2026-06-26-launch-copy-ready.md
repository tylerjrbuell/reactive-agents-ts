# Ready-to-Post Launch Copy (research-grounded) — Reactive Agents

**Date:** 2026-06-26 · Research basis: `2026-06-26` landscape/positioning pass. Post from your **personal/founder** account. ~16 stars, v0.12.0, MIT, early access.

## The spine (use everywhere)
**Tone: confident conviction, not me-too deferral.** State the differentiators as fact (they're true). Mention "early" ONCE, as confidence ("the core is real and testable today"), never as repeated apology. Do NOT point at LangChain/Mastra as the grown-ups in every paragraph. The honesty that earns credibility is "no production-ready claims / no fabricated benchmarks" — NOT self-deprecation.

**The positioning, stated plainly:** Most TS agent frameworks are either dynamically-typed wrappers (LangChain) or thin SDK helpers (Vercel AI SDK). Reactive Agents made three different architectural bets — and they're the lead:

1. **The runtime IS a typed effect system (Effect-TS).** Not "we added types" (Mastra validates Zod at boundaries — table stakes). The *execution model itself* is typed end to end: errors are values in an explicit channel, concurrency is structured, every reasoning step is a composable, deterministic, inspectable phase. Different architecture, not a feature checkbox.
2. **One codebase, local to frontier.** The same agent runs on a 4B Ollama model on your laptop and on Claude — one line changes. The ecosystem's stated position is "don't put a <7B model in an agent loop." We built the context-adaptation + tool-call healing that makes small models actually complete it. Nobody else claims this.
3. **Observable by construction, no SaaS tether.** A 12-phase deterministic lifecycle with hooks on every phase, inspectable locally — not a graph you wire yourself, not a LangSmith subscription.

**Lead with #2's demo** (contrarian + testable in 5 min), back it with #1 (the architectural moat) and #3. The integrated whole — typed effect runtime + local-frontier parity + deterministic observable engine + MCP-native + durable + HITL, MIT, one package — is the differentiator. No one else has all of it.

**Honesty guardrails (keep, but as confidence):** NO "production-ready / battle-tested / beats X". Word parity as *same code completes the loop*, not *same quality*. ONE line on stage: "early — v0.12, MIT, fewer integrations than LangChain today; the architecture is the bet and it's real now." Evidence (the demo) over adjectives.

**Centerpiece demo** (the reproducible artifact every channel links to):
```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("ollama").withModel("qwen3:4b")              // runs on your laptop
  // .withProvider("anthropic").withModel("claude-sonnet-4-6") // frontier — same code, one line
  .withReasoning()
  .withTools()
  .build();

const result = await agent.run("Find the 3 largest files in ./src and summarize each.");
console.log(result.output);
```

---

## 1. Hacker News — Show HN (your single highest-leverage shot; one-time)

**Title** (plain, no adjectives/version/hype):
`Show HN: Reactive Agents – TypeScript AI agents that run on local or frontier models`

**Body:**
```
Hi HN — I built Reactive Agents, a TypeScript framework for AI agents, around
three bets the popular frameworks didn't make.

1. The same agent code runs on a 4B local model and on Claude — one line changes.

The common wisdom is "don't put a small model in an agent loop" — it mangles
tool calls and the loop dies, so most frameworks quietly assume a frontier model.
I didn't accept that. Model-adaptive context profiles + a tool-call "healing" pass
(it normalizes malformed tool names/params/paths before execution) make the small-
model path actually complete. A 4B model isn't as smart as Claude — but the same
code finishes the task, so you develop and test locally and privately, then swap
to a frontier model for the hard runs with no rewrite:

  const agent = await ReactiveAgents.create()
    .withProvider("ollama").withModel("qwen3:4b")   // ← or .withProvider("anthropic")
    .withReasoning().withTools().build();
  const result = await agent.run("Find the 3 largest files in ./src and summarize each.");

2. The runtime is a typed effect system, not a dynamically-typed wrapper.

It's built on Effect-TS, so this isn't "we added some types at the edges" — the
execution model itself is typed end to end. An LLM or tool failure is a value in
an explicit error channel, not a thrown surprise; concurrency is structured;
retries and fallbacks compose. The builder and hooks are plain async, so you get
those guarantees without writing Effect yourself.

3. Observable by construction, with no SaaS tether.

Every run is a deterministic 12-phase lifecycle (bootstrap → guardrail →
think/act/observe → verify → … → complete) with before/after/error hooks on every
phase. You inspect and steer each step locally — no graph to wire by hand, no
hosted dashboard to subscribe to.

On top: MCP-native tools, A2A multi-agent, durable crash-resume, human-in-the-loop,
6 reasoning strategies — MIT, one install.

It's early — v0.12.0, ~6,500 tests, fewer integrations than LangChain today. The
architecture is the bet, and it's real and testable now. Docs have honest
side-by-side comparisons with LangGraph/Mastra/Vercel AI SDK.

Repo: https://github.com/tylerjrbuell/reactive-agents-ts
Docs: https://docs.reactiveagents.dev
Local-model walkthrough: https://docs.reactiveagents.dev/cookbook/local-agent-ollama/

Feedback very welcome — especially on the local-model path and the typed-runtime
ergonomics.
```
**Posting rules:** Tue–Thu ~8–10am ET. First 30 min velocity decides it. NO deleting/resubmitting if it stalls (= spam flag; wait months). Be in the comments all day, humble; answer "why not LangGraph/Mastra" by conceding maturity and pointing at the one testable difference. Author tone > the post itself.

---

## 2. X / Twitter — build-in-public thread

**Hook (post 1):**
```
Common wisdom: "don't put a 4B model in an agent loop — it mangles tool calls."

So I built a TypeScript agent framework where the same code runs on a 4B local
model *and* on Claude. One line changes.

Here's the same script, two models, both finishing a tool task 👇
```
**2** (the demo — attach a screen-recording/GIF of both runs):
```
Same builder. The only diff is the provider/model line:

  .withProvider("ollama").withModel("qwen3:4b")
  // .withProvider("anthropic").withModel("claude-sonnet-4-6")

Develop locally + privately on a 4B model, swap to frontier for the hard runs.
No rewrite.
```
**3** (why it works — credibility):
```
Two things make the small-model path actually complete:
• model-adaptive context profiles (lean prompts, aggressive compaction)
• a "healing" pass that fixes malformed tool names/params/paths before they run

Small models break on tool-call formatting; this recovers most of it.
```
**4** (the backbone):
```
Underneath: a deterministic 12-phase execution engine with before/after/error
hooks on every phase. You can inspect and steer each step — locally, no SaaS
dashboard required. Less "magic box," more "typed state machine."
```
**5** (the architectural moat):
```
This isn't a dynamically-typed wrapper with types bolted on. The runtime IS a
typed effect system (Effect-TS): LLM/tool failures are values in an explicit
error channel, concurrency is structured, retries + fallbacks compose.

You get the guarantees. You write plain async.
```
**6** (confident close + CTA):
```
Typed effect runtime + local↔frontier portability + deterministic observable
engine + MCP-native + durable + HITL. MIT, one install. No other TS framework
ships that combination.

Early (v0.12), but the core is real and testable today:
https://github.com/tylerjrbuell/reactive-agents-ts
```
**Notes:** the GIF in post 2 carries the thread. Build-in-public tone (early, MIT) converts better than polished-launch tone at 16 stars. Soft-launch this BEFORE Show HN to get a few engaged eyes.

---

## 3. Dev newsletter pitch — Cooper Press (JavaScript Weekly / Node Weekly)

Email the editor (or reply to a recent issue) — they curate by *interesting technical angle*, not "we launched". Keep it 3 sentences:
```
Subject: Running AI agents on 4B local models (TS, Effect-TS)

Hi — I built Reactive Agents, a TypeScript agent framework with a twist most
frameworks avoid: the same agent code runs on a 4B local Ollama model or on a
frontier API (Claude/GPT/Gemini) by changing one line, using model-adaptive
context profiles + a tool-call "healing" pass to keep small models from breaking
the loop. It's built on Effect-TS (errors are typed values, no try/catch), MIT,
early access. Might suit the JS/Node audience — repo and a local-model walkthrough:
https://github.com/tylerjrbuell/reactive-agents-ts ·
https://docs.reactiveagents.dev/cookbook/local-agent-ollama/

Thanks for considering — happy to share a reproducible demo.
```
Best after a strong HN/blog post (they prefer already-validated links). Same template fits Bytes.dev (make it a touch wittier) and TLDR.

---

## 4. Dev.to / Hashnode — the long-form substrate (link everything here)

**Title:** `Running an AI agent on a 4B local model (and the same code on Claude)`
**Canonical:** set to `https://docs.reactiveagents.dev/guides/build-ai-agents-typescript/` so the docs page gets the SEO credit.
**Tags:** `typescript`, `ai`, `llm`, `webdev`

**Outline (build/decision narrative — what wins with skeptics):**
1. The wall: agent frameworks assume frontier models; 4B models mangle tool calls and the loop dies.
2. What I tried + why it failed (honest).
3. The two mechanisms that fixed it: model-adaptive context profiles + tool-call healing (show before/after of a malformed call).
4. The same-code-two-models demo (run both, show both complete; show the local one's limits honestly).
5. The execution engine that makes it inspectable (typed phases + hooks, no SaaS).
6. Tradeoffs + when NOT to use this (ecosystem maturity, when to just use the vendor SDK or LangGraph). Link the comparison pages.
7. CTA → quickstart.

Lead with the demo, include limits + specific behavior, not just wins. "Lived engineering experience" is what AI-generated content can't fake and what builds authority.

---

## 5. Lobste.rs — ONLY if you build history first

High-quality audience, strict etiquette. Self-promo must be a minority of activity; the site tracks a public self-promo score. Tag your submission **`authored`** (+ `ai`, `javascript`). A drive-by product post from a no-history account gets killed. Participate genuinely for a few weeks before submitting, or skip it.
**Title (if/when):** `Reactive Agents: TypeScript agents that run the same code on local or frontier models`

---

## Sequencing (do in this order)
1. Record the same-code-two-models demo (GIF + a repo example file). Everything links to this.
2. Publish the Dev.to deep-dive.
3. Soft-launch the X thread (build-in-public).
4. Show HN, Tue–Thu 8–10am ET — be present in comments all day.
5. If HN lands, forward the link to Cooper Press / Bytes / TLDR.
6. Lobste.rs later, only with history.

Star/download bumps from this unlock the held awesome-lists (kyrolabs, steven2358) + Product Hunt for v0.13.
