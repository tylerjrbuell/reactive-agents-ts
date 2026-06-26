# Ready-to-Post Launch Copy (research-grounded) — Reactive Agents

**Date:** 2026-06-26 · Research basis: `2026-06-26` landscape/positioning pass. Post from your **personal/founder** account. ~16 stars, v0.12.0, MIT, early access.

## The spine (use everywhere)
- **Lead hook:** *the same agent code runs and completes a tool-using task on a 4B local Ollama model and on Claude — swap one line.* The ecosystem's stated position is the opposite ("don't use <7B models in agent loops"). This is contrarian + testable → lead with the **demo**, not the feature list.
- **Backbone:** a deterministic, inspectable typed execution engine (12 phases, per-phase hooks) — rides the "black box / need a state machine" complaint. Don't claim you invented observability (LangGraph owns that); differentiate on *typed phases + local + no SaaS tether*.
- **Third beat:** errors are typed values, not thrown — *built on Effect-TS, but you write plain async* (pre-empt "do I have to learn Effect?").
- **Honesty (non-negotiable):** NO "production-ready / battle-tested / beats X". Word "parity" as *same code completes the loop*, NOT *same quality*. Openly concede the ecosystem-maturity gap. Evidence over adjectives.

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
Hi HN — I've been building Reactive Agents, a TypeScript framework for AI agents.
Sharing it for feedback, warts and all.

The one thing I wanted that I couldn't find: the same agent code running on a
small local model and on a frontier API. The common wisdom is "don't put a 4B
model in an agent loop" — it mangles tool calls and the loop falls apart. So
most frameworks quietly assume GPT-4-class models.

Reactive Agents runs the same builder code on a 4B Ollama model or on Claude/
GPT/Gemini — you change one line. Two things make the small-model path actually
complete: model-adaptive context profiles (lean prompts + aggressive compaction
for the local tier), and a "healing" pass that normalizes malformed tool names/
params/paths before execution. It's not magic — a 4B model isn't as smart as
Claude — but the same code path runs and finishes the task, which lets you
develop and test locally/privately and swap to a frontier model for the hard runs.

  const agent = await ReactiveAgents.create()
    .withProvider("ollama").withModel("qwen3:4b")   // or .withProvider("anthropic")...
    .withReasoning().withTools().build();
  const result = await agent.run("Find the 3 largest files in ./src and summarize each.");

Under that: a deterministic 12-phase execution engine (bootstrap → guardrail →
think/act/observe loop → verify → … → complete) with before/after/error hooks
on every phase, so you can inspect and steer each step — locally, no SaaS tether.
It's built on Effect-TS, so errors are typed values in an explicit channel rather
than thrown exceptions — but the builder and hooks are plain async; you don't
have to write Effect to use it.

What it's NOT: it's early access (v0.12.0, MIT, ~6,500 tests). The ecosystem is
much younger and has far fewer integrations and tutorials than LangChain or
Mastra. I'm not claiming it's better than them — the docs have honest comparison
pages on where each wins.

Repo: https://github.com/tylerjrbuell/reactive-agents-ts
Docs: https://docs.reactiveagents.dev
Local-model walkthrough: https://docs.reactiveagents.dev/cookbook/local-agent-ollama/

Most interested in feedback on the local-model angle and the API. Happy to answer
anything.
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
**5** (Effect, pre-empting pushback):
```
Built on Effect-TS, so an LLM/tool failure is a typed value in an explicit error
channel, not a thrown surprise. But the builder + hooks are plain async — you
don't have to learn Effect to use it.
```
**6** (honest close + CTA):
```
It's early — v0.12, MIT, ~6,500 tests, way younger than LangChain/Mastra, fewer
integrations today. Not claiming it's better; claiming it's different where it
counts: local↔frontier portability.

Repo + docs (feedback very welcome):
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
