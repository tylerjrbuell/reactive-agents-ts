---
type: research
status: draft
created: 2026-11-18
tags: [positioning, marketing, launch, competitors]
---

# Agent harness market landscape and hero tagline (2026-11-18)

Input to the Show HN + Reddit launch ([[../Planning/Implementation-Plans/2026-11-17-docs-adoption-readiness]] Phase 2/6)
and to the tagline decision D4 in [[../Architecture/Design-Specs/2026-11-12-harness-positioning-and-portability]].
Nothing here is applied. No other file was edited.

**Method.** Competitor heroes read from primary pages on 2026-11-18 (WebFetch). HN threads and comments read
through news.ycombinator.com and the HN Algolia API (points, dates and object IDs below are from the API).
Reddit could not be read directly (the fetch tool is blocked on reddit.com, and site-restricted searches
returned no thread pages), so **Reddit sentiment here is secondhand and marked as such**; verify on Reddit
before quoting it in launch copy. Every Reactive Agents (RA) claim was checked against code on `dev` the
same day (section 4).

## 1. Summary

1. **"Harness" is now a category word, not a differentiator.** LangChain ("Deep Agents is the agent harness"),
   Pydantic ("Pydantic AI Harness"), Anthropic ("a hosted agent harness") and 20+ 2026 Show HNs use it. Keep it
   as the category noun in the subline. Do not make it the hook.
2. **The strongest HN signal for RA's story is Forge** (Python): "Guardrails take an 8B model from 53% to 99%
   on agentic tasks", 687 points, 252 comments, 2026-05-19. Demand for "a harness makes small local models
   usable" is proven. Forge won with a number; its loudest pushback was "I feel like you're hiding something or
   overinflating". RA has no with/without number yet, so it cannot copy that hook. It must lead with something
   a reader can check without a benchmark.
3. **Durable execution and "observability" are table stakes.** Vercel eve (June 2026), Pydantic AI, Mastra,
   VoltAgent and LangGraph all claim resume/HITL; Mastra, VoltAgent, OpenAI Agents SDK and Pydantic (Logfire)
   all claim tracing. RA's real gap is one step past tracing: **a deterministic, zero-token answer to "why did
   this run fail, and was it the harness or the model?"** (`rax-diagnose cause` / `attribute`). No competitor
   page read here offers that.
4. **Recommended hero:** "Agents that show their work." Subline names the 4B-to-frontier portability, the
   per-run receipt and the failure diagnosis. Show HN title:
   `Show HN: Reactive Agents – TypeScript agents that show their work on a 4B model` (79 chars).
5. **Fix before launch:** the draft line in the readiness plan says "a **signed** receipt for every run".
   Signing is off by default (`receipt-signing.ts`, opt-in via `.withReceiptSigning()` / `RA_RECEIPT_KEY`).
   Say "a receipt for every run" or "a signable receipt".

## 2. How competitors position themselves (primary sources, read 2026-11-18)

| Product | Hero / tagline (verbatim) | Claimed differentiator (verbatim where quoted) | URL |
|---|---|---|---|
| Mastra | "TypeScript AI Framework for Agents and Apps" / "Ship AI agents that reason, remember, and act in TypeScript." | "memory, tools, MCP, and observability to go from prototype to production"; "90+ providers through one standard interface"; evals + datasets; HITL workflows that pause and resume | https://mastra.ai |
| LangGraph | "Balance agent control with agency" / "Design agents that reliably handle complex tasks with LangGraph, an agent runtime and low-level orchestration framework." | HITL control, customizable workflows, persistent memory, first-class streaming | https://www.langchain.com/langgraph |
| LangChain Deep Agents | "Deep Agents is the agent harness for complex, multi-step work." | planning, virtual filesystem, subagents, memory; managed or SDK | https://docs.langchain.com/oss/javascript/deepagents/overview |
| Vercel AI SDK | "The TypeScript toolkit for building AI applications and agents." | toolkit breadth; "Build agents and chat interfaces" | https://ai-sdk.dev |
| Vercel eve (June 2026, beta) | open-source TypeScript agent framework, each agent a directory | every conversation a durable, checkpointed workflow; sandbox; HITL; evals; "the framework Vercel builds and runs its own agents on" | https://vercel.com/blog/introducing-eve |
| OpenAI Agents SDK (JS) | "Build text, sandbox, and voice agents with a small set of primitives." | "very few abstractions"; built-in tracing; parallel guardrails; "production-ready successor to Swarm" | https://openai.github.io/openai-agents-js/ |
| Claude Agent SDK | "Build production AI agents with Claude Code as a library" | "the same tools, agent loop, and context management that power Claude Code"; Managed Agents = "A hosted agent harness" | https://code.claude.com/docs/en/agent-sdk/overview |
| VoltAgent | "The end-to-end AI Agent Engineering Platform" / "Build enterprise multi-agent systems — development, observability, and deployment in one platform." | VoltOps real-time observability; Zod-typed workflows; pause/resume; supervisor agents | https://voltagent.dev |
| Inngest AgentKit | "AgentKit is a framework to build AI Agents, from single model inference calls to multi-agent systems that use tools." | composable blocks; MCP as tools; local live traces with the Inngest Dev Server | https://agentkit.inngest.com |
| Pydantic AI (Python reference) | "How Python does AI" | "Any model, one Python API."; "Typed end to end."; "Measured, not vibes."; "Durable execution."; Harness = memory, guardrails, sub-agents, planning, persistence | https://pydantic.dev/docs/ai/overview/ |
| CrewAI | "The Enterprise Agent Build & Runtime for the work your business runs on" | governance for platform teams; "65% of the Fortune 500" | https://www.crewai.com |
| Forge (Python, closest story match) | "A reliability layer for self-hosted LLM tool-calling." | tool-call validation, rescue parsing, retry with error tracking, workflow constraints; proxy / runner / middleware | https://github.com/antoinezambelli/forge |

**2026 "harness" Show HNs (HN Algolia, `show_hn`, query "harness", since 2026-01-01; top by points):**
Browser Harness 134, Zot "Yet another coding agent harness" 107, AI CAD Harness 101, Pu.sh "a full
coding-agent harness in 400 lines of shell" 92, Gambit "an open-source agent harness for building reliable AI
agents" 91 (2026-01-16), FrontierHarness Eval 82, agent-harness-kit 82, peerd 75, Raven "The harness of
harnesses" 55, plus Haumea (2026-11-11), AgentRun (~2026-11-12) and Pulsar (2026-11-17). Most are coding
harnesses. None is a general TypeScript library pitched on small local models.

**Reading.** Every TS competitor sells breadth (memory, tools, MCP, workflows, providers) or a platform.
Model-agnosticism is saturated ("90+ providers", "Any model, one API"). Nobody in TS leads with *small local
models*, *per-run evidence*, or *failure attribution*.

## 3. What builders complain about and ask for (2026)

Primary HN sources unless marked.

**Small-model tool calling is the live pain, and it is shifting.**
- Forge Show HN, 687 pts, 2026-05-19, https://news.ycombinator.com/item?id=48192383. Escapade5160: "given a
  proper harness, small local models can perform incredibly well." Pushback: 1dom, "I feel like you're hiding
  something or overinflating the actual real world improvements here"; esperent, "I have _zero_ clue what this
  does"; Imanari, "Couldn't this be solved by designing better tool responses instead of adding another layer
  in between?"
- "Running local models is good now", 1,596 pts, 608 comments, 2026-06-16,
  https://news.ycombinator.com/item?id=48555993. Local models are mainstream on HN.
- The ceiling is still contested. zhangxd6 (2026-06-03, item 48383893): "The 7B local model is borderline for
  reliable tool calling; 14B+ is more consistent." dnaranjo (2026-04-25, item 47898384): "most local models below
  70B struggle with multi-turn tool use". Counter: 1dom (2026-05-20, item 48204556): "accuracy around function/tool
  calling hasn't been a problem for me now for about 6 - 12 months." c0rruptbytes (2026-06-16, item 48557467):
  "quantization makes tool calling weaker".
  **Implication:** "works on a 4B model" is still a strong claim; "works on local models" alone is weakening.
- GitHub primary: OpenAI Agents SDK issue reporting a local Llama that "keeps calling the tool over and over
  again without producing an output", https://github.com/openai/openai-agents-python/issues/1544.
- Secondhand (Agent Times write-up of an April 2026 r/LocalLLaMA thread): Qwen3.5 4B posts high tool-call
  benchmark scores yet users report practical failures, blamed on runtime inconsistency.
  https://theagenttimes.com/articles/local-tool-calling-divides-our-community-breakthrough-or-col-a0eff21e

**Silent failures and "why did it fail".**
- Debugging is moving to recorded traces because bad runs do not reproduce (field note, 2026-06-30,
  https://agentnativeengineering.com/field-notes/2026-06-30-production-agents-fail-silently-debug-by-trace/).
  Microsoft-affiliated AgentRx localizes "the critical failure step" in a trajectory (https://www.arxiv.org/pdf/2602.02475).
  An HN builder made "agent-triage", a CLI that flags which turn broke (Ask HN March 2026,
  https://news.ycombinator.com/item?id=47303111). Demand for *attribution*, not only traces, is real.
- Mastra 1.0 thread: kxbnb asked how to debug what is sent to external APIs when local and production
  failures differ; the answer was "export traces". https://news.ycombinator.com/item?id=46693959

**Harness choice matters, and HN wants error bars.**
- FrontierHarness Eval, 82 pts, 2026-09-02, https://news.ycombinator.com/item?id=49538490: same model, cost per
  pass varied ~17x across nine harnesses. yorwba: "There really should be error bars on those measurements."
  joshheitzman: "I was excited until I saw cost was only provided as the median."

**Durability is asked for, but already sold by others.** mwfussell (2026-11-05, item 50385107): "What retries
don't give you is position. The retry has to work out what already happened." Vercel eve, Pydantic, Mastra,
VoltAgent all sell it.

**Framework fatigue and lock-in.**
- icyfox (2026-11-07, item 50400223): "Agent frameworks are fundamentally just harnesses around the underlying model."
- verdverm (2026-10-11, item 50044505): "which looks like thousands of other agent team frameworks generated with ai".
- shaolinspirit (2026-11-13, item 50485067): "just one more agent orchestration framework and I'm sure it would..."
- Mastra thread: mrcwinn, "You're not locked into a model, but you likely are locked in to a platform";
  scirob, "Mastra is by design batteries included and opinionated".
- Secondhand (search snippets of arXiv papers, not read in full): a 500+ developer survey cited in
  https://arxiv.org/pdf/2603.15473 says LangChain changes can require "traversing seven layers of code"; a
  306-practitioner survey reportedly found 68% cap agents at <=10 autonomous steps, reliability being the main
  barrier. Verify both against the papers before quoting.

**What HN punished in prior agent Show HNs.**

| Pattern | Example |
|---|---|
| Absolute words ("guarantee") | Gambit: yencabulator, "That does not sound like a 'guarantee', at all." (https://news.ycombinator.com/item?id=46641362) |
| Probabilistic security sold as enforcement | Gambit: niyikiza, "even at Layer 6, enforcement is probabilistic" |
| Unclear pitch / dense docs | Forge: "I have _zero_ clue what this does"; Gambit: "descriptive language" is "a bit dense" |
| Numbers without method | Forge "overinflating"; FrontierHarness "error bars", "only the median" |
| Credential/brand name-drops, astroturf smell | Mastra: "shut up about about Gatsby"; "This post is totally not astroturfed." |
| Platform lock-in, vendor dependence | Mastra: "locked in to a platform"; "If it uses Vercel, I'm out." |
| "Yet another framework" | rewarded only when owned in the title (Zot "Yet another coding agent harness", 107 pts) or when the thing is tiny (Pu.sh, 400 lines of shell) |

Show HN rules (https://news.ycombinator.com/showhn.html): title begins "Show HN"; "something you've made that
other people can play with"; "make it easy for users to try your thing out, ideally without barriers such as
signups or emails"; "Please don't ask friends to upvote or comment." **Keyless try-it matters**: the Ollama
path and the `test` provider are RA's no-signup route.

## 4. Word saturation

| Saturated (every competitor uses it; adds nothing) | Contested (use only with proof) | Differentiating for RA today |
|---|---|---|
| reliable / reliably (LangGraph, Gambit) | harness (category noun now) | 4B (a specific, checkable tier) |
| production-ready / to production (Mastra, OpenAI, Claude SDK) | local-first | receipt (claim-to-evidence record) |
| observability / tracing (Mastra, VoltAgent, OpenAI, Pydantic) | control (LangGraph owns "agent control") | "why it failed" / "harness or model" |
| end-to-end, platform, enterprise (VoltAgent, CrewAI) | type-safe / typed (Pydantic "Typed end to end") | "show their work" (idiom not used by any page read) |
| durable / resume (eve, Pydantic, Mastra, VoltAgent) | audit (reads as compliance/governance; CrewAI's turf) | "same code" + named tiers |
| any model / model-agnostic (Mastra, Pydantic) | | no hosted dashboard / on your machine |

## 5. White-space: where RA is different and verifiable (checked 2026-11-18)

| Claim | Verified in code | Skeptic check (<1 min) | Caveat to keep in copy |
|---|---|---|---|
| Same code on a 4B Ollama model and a frontier API | `apps/examples/src/demos/local-vs-frontier.ts` (one builder, only the model line changes; `qwen3:4b` vs Claude); README GIF | Watch the GIF; run the demo with `SKIP_FRONTIER=1` (no key) | One demo task, not a pass rate. No with/without-harness number exists yet |
| A receipt on every run | `TrustReceipt` (`packages/core/src/types/receipt.ts`, `verdict: "tool-grounded" \| "partially-grounded" \| "ungrounded" \| "abstained" \| "failed"`); attached in `packages/runtime/src/agent/run-task-effect.ts` | `console.log(result.receipt.verdict)` | Grades the evidence trail, not truth. Signing is **opt-in** (`receipt-signing.ts`). Never say "signed" without "optional" |
| Failed runs get a named cause, and harness-vs-model attribution | `packages/diagnose/src/cli.ts` (`cause`, `attribute`); docs `reference/cli/diagnose.md`: deterministic, from trace events only, zero tokens; confidence `decisive` / `probable` / `insufficient-trace` | `rax-diagnose cause <runId>` on the run just made | Can return `undetermined` / `unattributed`. Say "names a cause when the trace supports one", never "always" |
| A trace for every run, local | `defaultTracingConfig()` in `packages/runtime/src/builder/helpers.ts`: tracing on by default to `~/.reactive-agents/traces` (`REACTIVE_AGENTS_TRACE=off` disables) | `ls ~/.reactive-agents/traces` | Local JSONL files, not a hosted service |
| Durable resume | `.withDurableRuns()`, `apps/examples/src/demos/durable-resume.ts` | run the demo, kill process A, B resumes | Opt-in. Table stakes; secondary pillar only |
| Quiet and private | `packages/runtime/src/engine/telemetry-gate.ts`: telemetry opt-in; `DO_NOT_TRACK` always wins | read the 40-line file | The entropy sensor is on by default but sends nothing |
| Local studio | Cortex (`apps/cortex`, npm `@reactive-agents/cortex`) | `rax cortex` | No auth by default; say "on your machine" |
| Typed Effect-TS throughout | 33 public packages (`metrics.json`) | n/a | Effect is a filter: attracts Effect users, may repel others. Do not put it in the headline |

**The combined white space no competitor page occupies:** a TypeScript harness pitched on (a) the small local
tier, with (b) evidence attached to each run and (c) a zero-token "why did it fail, harness or model" answer.
Forge owns (a) for Python with a number. Mastra/VoltAgent/OpenAI own tracing. Nobody owns (c).

**Numbers we may use (from `apps/docs/src/data/metrics.json`, generated 2026-11-18):** 8 providers, 8
strategies, 12 phases, 33 public packages, 20,700 tests (cached figure, `testsCached: true`). Do not put test
counts in the hero: HN reads them as vanity.

## 6. Candidate hero lines (ranked)

Format: headline (<=8 words) / subline (one sentence). Proof = what a skeptic can check in under a minute.

### 1. "Agents that show their work." (recommended)
Subline: *An open-source TypeScript agent harness: the same code runs on a 4B Ollama model or a frontier API,
every run returns a receipt that ties claims to evidence, and `rax-diagnose` names why a failed run failed.*
- Pain: silent failures, "why did it do that", trust in small-model output.
- Proof: run the keyless local demo, print `result.receipt.verdict`, run `rax-diagnose cause <runId>`.
- Saturation risk: **low**. Idiom not used on any competitor page read; maps to the receipt (evidence) and the trace.
- HN risk: **low**. Modest, falsifiable, no number to attack. Weakness: does not say "small models" in the
  headline, so the subline and the Show HN title must carry it.

### 2. "Know why your agent failed."
Subline: *Every run writes a local trace; `rax-diagnose` tells you, without spending a token, whether the harness
or the model broke it, on a 4B Ollama model or a frontier API.*
- Pain: debugging non-reproducible failures (the strongest unmet ask in section 3).
- Proof: `rax-diagnose cause` and `attribute` on a fresh run.
- Saturation: **low** (attribution is unclaimed).
- HN risk: **medium**. Invites "show me it on a real failure". Needs a shipped sample failing trace in the repo
  so the check works without a model. Also leads with failure, which some readers find a negative frame.

### 3. "Same agent code, 4B model or frontier."
Subline: *An open-source TypeScript harness that heals malformed tool calls and checks the answer, so the run
you write against Claude also finishes on a laptop model, with a receipt and a trace for each.*
- Pain: small-model tool calling, cost, privacy.
- Proof: README GIF + `local-vs-frontier.ts`.
- Saturation: **medium** ("any model" is saturated; "4B" is not).
- HN risk: **medium-high** without numbers. Forge's thread shows HN will ask "on what pass rate?"; "finishes"
  must be read as "this demo finished", which the subline cannot fully guard. Becomes rank 1 once the
  with/without benchmark (readiness plan 5.1) exists with error bars.

### 4. "Harness or model? Your trace knows."
Subline: *Reactive Agents is an open-source TypeScript agent harness that records every run and attributes each
failure to the harness, the model or the environment, deterministically and at zero token cost.*
- Pain: blame assignment when switching models / tuning prompts.
- Proof: `rax-diagnose attribute <runId>`.
- Saturation: **very low**.
- HN risk: **medium**. Sharp for practitioners, cryptic for newcomers (Forge's "zero clue" failure mode).
  Best as a docs section header or Reddit r/LocalLLaMA post title, not the hero.

### 5. "TypeScript agents you can check."
Subline: *Each run comes back with a receipt grading its evidence and a trace that explains its outcome, on a
4B local model or a frontier API, with nothing sent to a hosted dashboard.*
- Pain: trust, privacy, lock-in.
- Proof: receipt + `ls ~/.reactive-agents/traces` + telemetry gate.
- Saturation: low. HN risk: low. Stickiness: weak; "check" is flat.

### 6. "Agents you can audit." (spec D4 default)
Subline as #1.
- Saturation: **medium** ("audit" reads as compliance; CrewAI and governance vendors own that frame).
- HN risk: low. Stickiness: low; does not tell a developer what they get.

### 7. "Agents you can control, audit and improve." (current README)
- Three generic verbs; "control" is LangGraph's hero word. "Improve" implies self-improvement claims RA must not
  make beyond the ledger. Saturation **high**, stickiness low. Retire.

### 8. Readiness-plan draft: "TypeScript agents that finish the job on a 4B local model or a frontier API, with a signed receipt for every run and a trace that explains every failure."
- Good as a meta description after edits, too long for a hero (26 words).
- Two truth problems: "signed" (opt-in) and "explains every failure" (`cause` can return `undetermined`).
  Fixed form: "...with a receipt for every run and a trace that explains why it failed."

**Ranking rationale.** #1 is the only line that is sticky, true without qualification, unattackable without a
benchmark, and covers all three white-space claims through its subline. #2 hits the sharpest pain but needs a
bundled failing-trace sample before launch. #3 is the strongest hook on HN *after* the benchmark lands; until
then it invites the Forge "overinflating" reply with nothing to answer it.

## 6b. Exhaustive framing sweep (owner request, 2026-11-18)

The owner asked to exhaust other framings before adopting #1. Each angle below is a distinct *reason to care*,
not a rewording. Scored 1-5 on: **True** (holds today without caveats), **Own** (no competitor page uses it,
section 4), **Pain** (maps to a section 3 complaint), **Stick** (short, concrete, repeatable), **HN** (low risk of
the section 3 punishments). Total /25.

| # | Angle | Headline | True | Own | Pain | Stick | HN | Total | Note |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Evidence | Agents that show their work. | 5 | 5 | 3 | 4 | 5 | **22** | Section 6 #1. Soft on pain; subline carries it |
| A2 | Evidence | Agents with receipts. | 5 | 5 | 3 | 5 | 4 | **22** | "Receipts" = proof (idiom) and names the real artifact (`TrustReceipt`). Risk: reads as payments for a second |
| A3 | Evidence | Every answer comes with its evidence. | 4 | 4 | 3 | 2 | 4 | 17 | Receipt grades the trail, not truth; "every" invites nitpicks |
| B1 | Failure | Know why your agent failed. | 4 | 5 | 5 | 4 | 4 | **22** | `cause` can say undetermined; needs bundled sample trace |
| B2 | Failure | When your agent fails, it tells you why. | 3 | 5 | 5 | 3 | 3 | 19 | Implies always; overclaim risk |
| B3 | Failure | Agent failures, explained. | 4 | 4 | 5 | 4 | 4 | 21 | Clean; slightly passive |
| C1 | Debuggability | Debug agents like you debug code. | 5 | 3 | 5 | 5 | 4 | **22** | Covers trace + replay (tool results fixed) + `rax-diagnose` + deterministic `@reactive-agents/testing` scenarios. "Debug" overlaps LangSmith's verb, but not as a dev-mental-model promise |
| C2 | Debuggability | Agents you can step through. | 3 | 5 | 4 | 4 | 3 | 19 | Implies a step debugger; replay is close but not interactive |
| D1 | Attribution | Was it the model, or the harness? | 5 | 5 | 4 | 4 | 4 | 22 | Question hooks the live HN debate (icyfox "frameworks are just harnesses"). Better as a post title / Reddit hook than a permanent hero |
| D2 | Attribution | Harness or model? Your trace knows. | 4 | 5 | 4 | 3 | 4 | 20 | Section 6 #4 |
| E1 | Small model | Make a 4B model finish the job. | 2 | 4 | 5 | 5 | 2 | 18 | Strongest hook, unbacked until the benchmark (Forge "overinflating") |
| E2 | Small model | Same agent code, 4B model or frontier. | 4 | 4 | 4 | 3 | 3 | 18 | Section 6 #3; one demo, not a pass rate |
| E3 | Small model | Built for the model on your laptop. | 4 | 4 | 4 | 4 | 3 | 19 | Implies frontier is second-class; it is not |
| F1 | No black box | The agent loop, out in the open. | 5 | 4 | 3 | 3 | 4 | 19 | True (12 hookable phases, every step an event) but abstract |
| F2 | No black box | No magic. Every step is yours. | 4 | 3 | 3 | 4 | 3 | 17 | "No magic" is a common dev-tool claim |
| G1 | Honesty | Agents that say "I don't know." | 3 | 5 | 4 | 5 | 2 | 19 | `abstained` verdict + honest-decline path exist, but a single counterexample in the thread sinks it |
| H1 | Local/private | Your models, your machine, your traces. | 5 | 3 | 3 | 4 | 4 | 19 | True; "local-first" is contested ground |
| I1 | Composite | Small models. Real work. Full receipts. | 3 | 5 | 4 | 4 | 3 | 19 | "Real work" needs the benchmark to defend |
| J1 | Typed | Type-safe agents, end to end. | 4 | 1 | 2 | 3 | 4 | 14 | Pydantic owns "Typed end to end"; Effect is a filter |

**Shortlist (22/25):** A1 "Agents that show their work.", A2 "Agents with receipts.", B1 "Know why your agent
failed.", C1 "Debug agents like you debug code.", and D1 "Was it the model, or the harness?" (as a post hook).

**What separates them.** A1/A2 sell a *property* (transparency) and are safest. B1/C1 sell a *job the reader
already has* (debugging a bad run), which section 3 shows is the sharpest unmet pain and is where no competitor
leads; they convert better if the proof is one keyless command. D1 is the best *conversation starter* and belongs
in the Show HN first comment or Reddit title, not the hero.

**Pairing that uses more than one angle:** headline C1 or B1, subline carrying A1 and the small-model hook, e.g.
"Debug agents like you debug code." / "An open-source TypeScript agent harness: every run leaves a local trace and a
receipt that ties claims to evidence, `rax-diagnose` names why a failed run failed, and the same code runs on a 4B
Ollama model or a frontier API."

**How to pick without guessing.** Real traffic is too low for an A/B on the site (about 400-700 humans a month).
Cheaper signals, in order: (1) ask 5-10 target developers (Discord, peers) "what does this do and would you try it?"
after 5 seconds on each shortlisted hero, and count correct paraphrases; (2) post the D1 question as a
discussion (not a launch) and see which phrasing commenters repeat back; (3) the day the benchmark lands, re-score E1.

## 7. Show HN title (<=80 chars)

Recommended (79 chars):
`Show HN: Reactive Agents – TypeScript agents that show their work on a 4B model`

Carries the small-model hook (proven demand: Forge 687, local models 1,596) and the differentiator, no
superlatives, no "reliable", no "framework". Alternative if the benchmark ships first (check length):
`Show HN: Reactive Agents – TS agent harness, 4B model from X% to Y% (with error bars)`.

Post-body rules learned from section 3: first line says what it is in plain words; link a keyless try-it
(Ollama or `test` provider); state limits up front (no pass-rate number yet, signing optional, `cause` can say
undetermined); no credentials or name-drops; own the "another framework?" question with what it is *not*;
answer every methodology question in-thread.

## 8. Recommendation

Adopt **"Agents that show their work."** as the hero, with the #1 subline, across README, docs `index.mdx`
hero, GitHub About and the npm README (owner: docs-warden; npm README applied via runtime-warden). Keep
"harness" in the subline and "framework" in meta descriptions for search (positioning spec 2.3). Before launch:
(1) fix "signed" in the readiness-plan sentence, (2) ship one sample failing trace so `rax-diagnose cause`
works keyless in under a minute, (3) re-rank toward #3 the day the with/without-harness benchmark has error bars.

**Counter-argument.** "Show their work" is softer than Forge's "53% to 99%", and HN rewards numbers. True; but
a number RA does not have is the one hook it cannot use, and an unbacked one is the pattern HN punished hardest
in section 3. The title carries "4B model", which is the concrete hook.

## 9. Sources

Competitors: https://mastra.ai · https://www.langchain.com/langgraph ·
https://docs.langchain.com/oss/javascript/deepagents/overview · https://ai-sdk.dev ·
https://vercel.com/blog/introducing-eve · https://openai.github.io/openai-agents-js/ ·
https://code.claude.com/docs/en/agent-sdk/overview · https://voltagent.dev · https://agentkit.inngest.com ·
https://pydantic.dev/docs/ai/overview/ · https://www.crewai.com · https://github.com/antoinezambelli/forge

HN: Forge https://news.ycombinator.com/item?id=48192383 · Mastra 1.0 https://news.ycombinator.com/item?id=46693959 ·
Gambit https://news.ycombinator.com/item?id=46641362 · OpenHarness https://news.ycombinator.com/item?id=47459997 ·
FrontierHarness Eval https://news.ycombinator.com/item?id=49538490 · Running local models
https://news.ycombinator.com/item?id=48555993 · Show HN rules https://news.ycombinator.com/showhn.html ·
comment IDs as cited (resolve as `https://news.ycombinator.com/item?id=<id>`).

Secondary (verify before quoting): https://theagenttimes.com/articles/local-tool-calling-divides-our-community-breakthrough-or-col-a0eff21e ·
https://agentnativeengineering.com/field-notes/2026-06-30-production-agents-fail-silently-debug-by-trace/ ·
https://www.arxiv.org/pdf/2602.02475 · https://arxiv.org/html/2602.16666v1 ·
https://github.com/openai/openai-agents-python/issues/1544

Repo evidence: `README.md:1-45`, `apps/docs/src/data/metrics.json`, `packages/runtime/src/receipt-signing.ts`,
`packages/core/src/types/receipt.ts`, `packages/runtime/src/agent/run-task-effect.ts:585-606`,
`packages/runtime/src/builder/helpers.ts` (`defaultTracingConfig`), `packages/runtime/src/engine/telemetry-gate.ts`,
`packages/diagnose/src/cli.ts`, `apps/docs/src/content/docs/reference/cli/diagnose.md`,
`apps/examples/src/demos/local-vs-frontier.ts`, `apps/examples/src/demos/durable-resume.ts`.
