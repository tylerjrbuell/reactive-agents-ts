# Ready-to-Post Launch Copy (research-grounded) — Reactive Agents

**Date:** 2026-06-26 · Research basis: `2026-06-26` landscape/positioning pass. Post from your **personal/founder** account. ~16 stars, v0.12.0, MIT, early access.

## The spine (use everywhere)
**Tone: confident conviction, not me-too deferral.** State the pillars as fact (they're true). Mention "early" ONCE, as confidence ("the core is real and testable today"), never as repeated apology. Don't point at LangChain/Mastra as the grown-ups in every paragraph. The honesty that earns credibility is "no production-ready claims / no fabricated benchmarks" — NOT self-deprecation.

**The positioning — three pillars (lead with these everywhere):** Reactive Agents is a TypeScript agent harness built around the three things production agents actually need, and most frameworks skip:

1. **🛡️ Reliable on every model tier.** The hard part of agents isn't the prompt — it's getting the loop to *finish* without mangling a tool call, hallucinating, or looping forever. Reactive Agents ships the harness engineering that fixes that: tool-call healing, output verification, durable crash-resume, and a single-owner termination oracle. The proof: the *same code* completes the agent loop on a 4B local Ollama model **and** on Claude/GPT/Gemini. No model lock-in, no "GPT-4-only."
2. **🔍 Transparent.** A deterministic 12-phase execution engine with `before`/`after`/`on-error` hooks on every phase. Every prompt, tool call, and decision is a typed event you can inspect, steer, and replay — locally, with no SaaS dashboard or vendor tether. Built on Effect-TS, so failures are typed values in an explicit channel, not 2am thrown surprises (and you write plain async — no Effect required).
3. **🧩 Composable.** Opt-in layers via a typed builder. Start with a model; add reasoning, memory, guardrails, cost routing, durability **one `.with()` call at a time** — enable exactly what you need, nothing you don't. MIT, one install.

**Lead with reliability** (the thing production buyers want), **prove it with the cross-tier demo** (contrarian + testable in 5 min), and let transparency + composability close. The integrated whole — reliability harness + typed/observable runtime + compose-what-you-need + local-to-frontier, MIT — is the differentiator. No one else ships all of it.

**Per-audience lead** (don't use one hook everywhere):
- **Show HN / senior devs** → transparency + reliability ("typed runtime, agents that actually finish, no black box").
- **r/LocalLLaMA** → the cross-tier reliability proof (4B finishes the loop) — its home turf.
- **"Ship to production" / LinkedIn** → durability + reliability (resume-on-crash, verification, HITL).

**Honesty guardrails (keep, as confidence):** NO "production-ready / battle-tested / beats X". Word the cross-tier claim as *same code finishes the loop*, not *same quality*. ONE line on stage: "early — v0.12, MIT, fewer integrations than LangChain today; the architecture is the bet and it's real now." Evidence (the demo) over adjectives.

**Centerpiece demo** (the reproducible artifact every channel links to):
```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("ollama").withModel("qwen3:4b")              // runs on your laptop
  // .withProvider("anthropic").withModel("claude-sonnet-4-6") // frontier — same code, one line
  .withReasoning()
  .withTools({ tools: [getServiceHealth, getRecentDeploys] })
  .build();

// Same code finishes on a 4B local model and on Claude:
const result = await agent.run(
  "The payments-api is alerting. Investigate with the tools, then tell me the cause and the fix."
);
console.log(result.output);
```

---

## 1. Hacker News — Show HN (your single highest-leverage shot; one-time)

**Title** (plain, concrete, no hype):
`Show HN: Reactive Agents – TypeScript agents that finish the loop, local 4B to frontier`

**Body:**
```
Hi HN — I built Reactive Agents, a TypeScript agent framework built around three
things I kept fighting in other frameworks: reliability, transparency, and
composability.

1. Reliability — getting the loop to actually finish.

The hard part of agents isn't the prompt, it's the loop: a mangled tool call, a
hallucinated step, or an agent that never terminates. Reactive Agents ships the
harness for that — tool-call healing (normalizes malformed tool names/params/paths
before execution), output verification, durable crash-resume, and a single-owner
termination oracle.

The proof I like best: the SAME agent code finishes the loop on a 4B local Ollama
model and on Claude. The common wisdom is "don't put a small model in an agent
loop"; the healing + context adaptation are what make it complete. A 4B model
isn't as smart as Claude, but the same code finishes — so you develop and test
locally/privately, then swap one line to a frontier model:

  const agent = await ReactiveAgents.create()
    .withProvider("ollama").withModel("qwen3:4b")   // ← or .withProvider("anthropic")
    .withReasoning().withTools({ tools }).build();

2. Transparency — no black box.

Every run is a deterministic 12-phase lifecycle (bootstrap → guardrail →
think/act/observe → verify → … → complete) with before/after/error hooks on every
phase. You inspect and steer each step locally — no graph to wire by hand, no
hosted dashboard to subscribe to. It's built on Effect-TS, so an LLM or tool
failure is a typed value in an explicit error channel, not a 2am thrown surprise —
and the builder/hooks are plain async, so you don't write Effect to get that.

3. Composability — enable exactly what you need.

Opt-in layers via a typed builder. Start with a model; add reasoning, memory,
guardrails, cost routing, durability one .with() call at a time. MCP-native tools,
A2A multi-agent, HITL, 6 reasoning strategies — MIT, one install.

It's early — v0.12.0, ~6,500 tests, fewer integrations than LangChain today. The
architecture is the bet, and it's real and testable now. Docs have honest
side-by-side comparisons with LangGraph/Mastra/Vercel AI SDK.

Repo: https://github.com/tylerjrbuell/reactive-agents-ts
Docs: https://docs.reactiveagents.dev

Feedback very welcome — especially on the reliability harness and the typed-runtime
ergonomics.
```
**Posting rules:** Tue–Thu ~8–10am ET. First 30 min velocity decides it. NO deleting/resubmitting if it stalls (= spam flag; wait months). Be in the comments all day, humble; answer "why not LangGraph/Mastra" by conceding maturity and pointing at the one testable difference. Author tone > the post itself.

---

## 2. X / Twitter — build-in-public thread

**Hook (post 1):**
```
The hard part of AI agents isn't the prompt — it's getting the loop to *finish*:
a mangled tool call, a hallucinated step, an agent that never stops.

I built a TypeScript agent framework focused on exactly that. Proof: the same
code finishes the same agentic task on a 4B local model AND on Claude 👇
```
**2** (the demo — attach the GIF):
```
Watch it work an incident: call two tools, correlate a recent deploy with the
degradation, recommend a rollback — and finish on gemma 4B and on Claude.

The only line that changes is the model. [GIF]
```
**3** (pillar 1 — reliability):
```
What makes the loop finish (even on a 4B): tool-call healing (fixes malformed
tool calls before they run), output verification, durable crash-resume, and a
single-owner termination oracle.

It's the harness doing the work, not the model.
```
**4** (reliability, part 2 — durability; attach the durable-resume GIF):
```
Reliability isn't just small models finishing — it's surviving a crash.

Kill the process mid-run and a fresh one resumes from the last on-disk
checkpoint and finishes the job. The tools that already ran don't run again. [GIF]
```
**5** (pillar 2 — transparency):
```
And you can see all of it. A deterministic 12-phase engine with hooks on every
phase — inspect and steer each step locally, no SaaS dashboard.

Built on Effect-TS: failures are typed values, not 2am surprises. (You still
write plain async.)
```
**6** (pillar 3 — composability):
```
Composable by design: start with a model, then add reasoning / memory /
guardrails / cost control / durability one .with() at a time. Enable what you
need, nothing else.

MCP-native tools, A2A multi-agent, HITL. MIT, one install.
```
**7** (confident close + CTA):
```
Reliable on every tier · transparent · composable. No other TS framework ships
that combination.

Early (v0.12), but real and testable today:
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
