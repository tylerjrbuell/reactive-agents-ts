---
type: reference
status: draft
created: 2026-11-18
updated: 2026-11-18
tags: [distribution, launch, show-hn, hacker-news, positioning]
---

# Show HN launch kit (draft, 2026-11-18)

Replaces the 2026-06 draft. Part of Phase 6 of [[../../Planning/Implementation-Plans/2026-11-17-docs-adoption-readiness]].
Positioning follows [[../../Research/2026-11-18-agent-harness-market-landscape]] (hero "Agents that show their
work.", section 8). Numbers come only from `apps/docs/src/data/metrics.json` (generated 2026-11-18): 8 providers,
8 strategies, 12 phases, 33 public packages, 20,700 tests (cached figure). Keep test and package counts out of
the title and the first paragraph: HN reads them as vanity, and a 33-package count invites "over-engineered".

> [!warning] Read this first: HN bans generated text
> The HN guidelines say "Please don't put generated text in HN posts" and, for comments, "Don't post generated
> text or AI-edited text. HN is for conversation between humans." (https://news.ycombinator.com/newsguidelines.html,
> read 2026-11-18). dang: accounts that look like they break this "are often banned when they are new"
> (https://news.ycombinator.com/item?id=47340079, about 2026-03).
> **Everything below is a fact sheet and an outline, not text to paste.** Write the post body, the first comment
> and every reply yourself, in your own words, on launch day. The beats and facts here are checked against the
> repo; the wording is yours to supply.

## 1. Compliance checklist (with sources, all read 2026-11-18)

| # | Rule | Source | How this plan complies |
|---|---|---|---|
| 1 | Show HN is for "something you've made that other people can play with"; "things people can run on their computers" | https://news.ycombinator.com/showhn.html | Link the repo; `npm install reactive-agents` or `bun add` plus a keyless Ollama path |
| 2 | "make it easy for users to try your thing out, ideally without barriers such as signups or emails" | showhn.html | Point at the keyless path first (Ollama `qwen3:4b`, `SKIP_FRONTIER=1` on the demo). No newsletter link in the post |
| 3 | "The project must be something you've worked on personally and which you're around to discuss" | showhn.html | Author posts and stays in the thread for 6-8 hours |
| 4 | "Don't post quickly-generated one-offs"; "The project should be non-trivial" | showhn.html | Fine on substance, but expect the "was this vibe-coded?" question (section 6, Q9) |
| 5 | "Please don't ask friends to upvote or comment." Off topic: "sign-up pages, newsletters" | showhn.html | No asks anywhere: not Discord, not X, not email, not coworkers. Do not post the HN link in the Discord either |
| 6 | "Don't solicit upvotes, comments, or submissions." | newsguidelines.html | Same as 5. Sharing the *repo* elsewhere is fine; sharing the *HN thread* with a "go vote" is not |
| 7 | FAQ: asking for upvotes is not allowed; "We penalize or ban submissions, accounts, and sites that break this rule." Some votes are dropped by anti-abuse software | https://news.ycombinator.com/newsfaq.html | Votes from a cluster of new accounts or one network get dropped and can sink the post. Zero coordination |
| 8 | Titles: no uppercase or "!" for emphasis; crop "a gratuitous number or number + adjective"; "don't editorialize" | newsguidelines.html | Titles in section 2 use no superlatives. "4B" is a model size, not a gratuitous number |
| 9 | "Please don't put generated text in HN posts"; comments: no "generated text or AI-edited text" | newsguidelines.html; item 47340079 | See the warning above. Author writes every word |
| 10 | Show HN restricted for new accounts since about 2026-03; dang: "Just new ones for now", criteria deliberately unpublished; asks for "a bit of community participation" first | https://news.ycombinator.com/item?id=47300772 | **Check before launch:** post from an account with real comment history. No account under the GitHub handle exists on HN (API returned null on 2026-11-18); if the owner has none, start commenting genuinely now, weeks before launch. Do not create an account to post |
| 11 | "please don't create accounts routinely"; "a small number of reposts is ok"; don't "delete and repost the same story" | newsguidelines.html; newsfaq.html | One account, one submission. If it sinks, do not delete it. A later repost is allowed only for a substantially new thing (for example the with/without benchmark) |
| 12 | "please don't automate posting" | newsguidelines.html | Submit by hand |

Prior submissions: the HN Algolia API shows no story for `github.com/tylerjrbuell/*` or `reactiveagents.dev`
(checked 2026-11-18), so this is a first submission, not a repost.

## 2. Title options (<= 80 chars, checked with `len()`)

| # | Title | Chars | Notes |
|---|---|---|---|
| **A (recommended)** | `Show HN: Reactive Agents – TypeScript agents that show their work on a 4B model` | 79 | Matches the landscape doc's hero and title (section 7). Carries the small-model hook (Forge, 687 points) without a number RA cannot back |
| B | `Show HN: Reactive Agents – TypeScript agent harness that says why a run failed` | 78 | Sharpest pain (silent failures, `rax-diagnose cause`). Needs the bundled failing-trace sample (blocker 2 in section 8) or the first reply is "show me" |
| C | `Show HN: Reactive Agents – same TypeScript agent code, 4B local model or Claude` | 79 | Most concrete. Invites "on what pass rate?" with no number to answer. Use it the day the with/without benchmark ships with error bars |

**Risk on A:** "show their work" is an idiom, and a skimmer may not decode it (the Forge thread's "I have zero
clue what this does" failure). The first line of the post text must say in plain words what it is.
**Name collision:** HN already has "Reactive Agents" (Paul Kinlan, 2024) and Mozaik "reactive agents" (2026-05),
and "PINE: A Reactive Harness for Agents" was posted 2026-11-17. Expect one "name clash" comment (Nous got
two, https://news.ycombinator.com/item?id=41202064). Do not argue it; acknowledge and move on.

## 3. URL choice and post shape

**Submit the GitHub repo URL**, `https://github.com/tylerjrbuell/reactive-agents-ts`, with a short text.

- Every strong comparable linked GitHub: Mastra (442 points, https://news.ycombinator.com/item?id=43103073),
  Forge (687, item 48192383), peerd (75, item 48646165). VoltAgent linked its marketing site and got 22 points
  and 2 comments (item 45346636). Small sample, not proof, but HN readers want code first.
- The README now opens with the pitch, a "What's different" list, the local-vs-frontier GIF and a 60-second
  quickstart. The 2026-11-17 audit found the docs' calls to action buried; the README avoids that.
- The docs site has a newsletter form on every page (fine as a destination, but it must not be the submitted URL).
- No UTM parameters on the submitted URL. GitHub ignores them, they look like marketing, and HN's referrer
  already shows in GitHub traffic and Umami. This changes Phase 6's "UTM-tagged links" step: rely on referrers
  plus an Umami annotation at the post time.
- Submit the URL and a text body together (Mastra did: item 43103073 has both). Keep the text short; put the
  longer technical notes in the first comment.

## 4. Post text and first comment: beats and facts (write in your own words)

### Post text (5-8 sentences)

1. What it is, plainly: an open-source (MIT) TypeScript agent harness. The same agent code runs on a 4B Ollama
   model or on Claude, GPT or Gemini; only the model line changes.
2. What "show their work" means, concretely:
   - every run returns a receipt that ties the answer's claims to the tool evidence, with a verdict
     (`tool-grounded`, `partially-grounded`, `ungrounded`, `abstained`, `failed`; `packages/core/src/types/receipt.ts`);
   - every run writes a local trace (on by default, `~/.reactive-agents/traces`, off with `REACTIVE_AGENTS_TRACE=off`);
   - `rax-diagnose cause <runId>` names why a run failed, from trace events only, with zero model calls.
3. How to try it with no key: `ollama pull qwen3:4b`, then the README's tool-agent snippet, or the demo
   `apps/examples/src/demos/local-vs-frontier.ts` with `SKIP_FRONTIER=1`.
4. One honest line: pre-1.0, and no published with/without-harness pass rate yet (details in the first comment).
5. Links: repo (the URL), docs `https://docs.reactiveagents.dev`. Nothing else.

### First comment (post within 2 minutes of submitting)

Shape that worked for Forge and Mastra: who, why, what is different, how it works, limits, what you want.

1. **Who:** solo author (state your real background in one line). No name-drops (Mastra's thread drew
   "shut up about Gatsby"; see landscape doc section 3).
2. **Why:** the problem you hit. Two facts you can state from the repo's history: agents on small local models
   failed in ways that were hard to explain from logs, and the same failure would not reproduce on the next
   run. Your own story here, not a marketing one.
3. **What is different** (pick three, each with the file a reader can open):
   - one builder for local and frontier models; per-model context profiles and tool-call healing
     (`packages/tools/src/healing/`: tool-name, parameter-name and JSON repair) do the adapting;
   - a receipt per run; Ed25519 signing is **opt-in** (`.withReceiptSigning()` or `RA_RECEIPT_KEY`). Never say "signed receipts" without "optional";
   - `rax-diagnose cause` and `attribute`: deterministic rules over the trace that say whether the harness, the model
     or the environment broke a run. They can answer `undetermined` / `unattributed` when the trace is too thin;
   - every capability is opt-in through a `.with*()` call; a 12-phase lifecycle with before/after/on-error hooks.
4. **Effect-TS, one sentence:** it is built on Effect-TS, but `agent.run()` needs no Effect knowledge; `effect` is a
   peer dependency used for tool schemas.
5. **Limits, said before anyone asks:**
   - no published benchmark of the same task with and without the harness. The GIF is one demo task on `qwen3:4b`,
     not a pass rate. Say what you plan to measure and that you will report error bars;
   - pre-1.0: minor releases can break APIs (changelog lists each break);
   - a receipt grades the evidence trail, not whether the answer is true;
   - `rax-diagnose` names a cause only when the trace supports one;
   - Bun recommended, Node 22.5+ supported; on Node, SQLite full-text search falls back to `LIKE`;
   - solo maintainer, small community (do not state a star count unless asked).
6. **Feedback wanted** (specific beats generic): which tool-calling failures you see on small local models; whether
   the receipt verdict is useful or noise; where the first 10 minutes broke; whether Effect-TS is a reason to try it or a reason to leave.

## 5. Facts to keep at hand (all verified 2026-11-18)

| Claim | Where to point |
|---|---|
| MIT license | `LICENSE` |
| Current release v0.18.0 | `VERSION`, git tag `v0.18.0` |
| 8 providers: Anthropic, OpenAI, Gemini, Groq, xAI, Ollama, LiteLLM, Test | `metrics.json`, README table |
| 8 strategies, Code-Action is experimental | README table, `reference/stability` |
| Telemetry is opt-in; `DO_NOT_TRACK` overrides even an explicit opt-in | `packages/runtime/src/engine/telemetry-gate.ts` (40 lines) |
| Default upload endpoint when opted in | `https://api.reactiveagents.dev/v1/reports` (`packages/reactive-intelligence/src/telemetry/telemetry-client.ts`) |
| Traces local by default | `defaultTracingConfig()` in `packages/runtime/src/builder/helpers.ts` |
| Durable runs opt-in | `.withDurableRuns()`, `apps/examples/src/demos/durable-resume.ts` |
| MCP: client yes, server no | `packages/tools/src/mcp/mcp-client.ts`; no `serveMCP` in source |
| Comparison pages exist, with "when to choose X" sections | `guides/reactive-agents-vs-{mastra,langgraph,vercel-ai-sdk,agent-sdks}` |
| Strategy switching off by default because it showed no lift | `features/local-model-performance.md` (qwen3:4b and cogito:8b, +28% billed tokens, 2026-11-05 ablation) |

Use the last row in answers. "We turned off our own feature because the ablation showed no lift" is the most
credible sentence available to this launch: it shows the measuring habit without claiming a number you lack.

## 6. Prepared answers (talking points; reply in your own words)

**Q1. Why another agent framework? How is this different from LangGraph, Mastra or the Vercel AI SDK?**
Own the question; do not dodge it. LangGraph: you draw the control flow as a graph; RA gives you a loop you
configure, not a graph you wire. Mastra: batteries-included DX, a hosted cloud, a large community; the RA docs
already say Mastra "is a strong default" for the fastest path to a working app (`reactive-agents-vs-mastra.mdx`, line 21).
Vercel AI SDK: a model-call and streaming toolkit; RA sits above that layer (loop, termination, evidence, traces).
RA's bet is narrower: the same code on small local and frontier models, plus evidence and a failure cause per run.
Link the comparison pages. Never call a competitor bad.

**Q2. Why Effect-TS? Isn't it a big learning curve?**
Yes, the curve is real; say so. Users do not need it: `createAgent()` and `agent.run()` are plain promises. Inside,
Effect gives typed errors and per-run scoped state (no module-level state shared across runs), which is what
makes runs replayable. If Effect is a reason someone leaves, that is useful feedback. Avoid "no `any`" or "fully
type-safe" absolutes: the repo runs a shrink-only ratchet on remaining casts and string throws.

**Q3. Does it really work on small models? Numbers?**
Show the demo and the mechanisms (healing, per-model context profiles, verification, one termination check in
`packages/reasoning/src/kernel/loop/terminate.ts`). Then say plainly: no published with/without pass rate yet.
Bench cells are pass/fail per run, so a credible number needs many runs and error bars, and you would rather
publish nothing than a number with no method (cite FrontierHarness Eval's "There really should be error bars"
thread, item 49538490, to show you know the bar). Offer: "tell me a task that fails for you on a small model and
I'll run it". Do not quote any internal ablation figure that is not on a public page.

**Q4. Bun or Node?**
Both. Bun recommended (native SQLite with full-text search); Node 22.5+ supported through
`@reactive-agents/runtime-shim`. Same code. On Node, memory search falls back to `LIKE` because Node's built-in
SQLite has no FTS5.

**Q5. Does it phone home?**
No, unless you opt in. Point at the 40-line `telemetry-gate.ts`. `DO_NOT_TRACK` wins even over an explicit
opt-in. The entropy sensor (Reactive Intelligence) runs on by default and sends nothing anywhere. Traces stay on disk.

**Q6. What is a "receipt"? Is it just an LLM grading itself?**
It is a record that ties claims in the answer to the tool calls that produced evidence, with a verdict. It grades
the evidence trail, not truth: a tool-grounded answer can still be wrong if the tool returned wrong data.
Signing is optional (Ed25519) for people who need tamper evidence.

**Q7. How can `rax-diagnose` know whether the harness or the model failed?**
Ordered, first-match rules over trace events, never over model text, so zero tokens and the same answer every
time. Each verdict carries a confidence (`decisive`, `probable`, `insufficient-trace`) and the events it read.
It returns `undetermined` or `unattributed` rather than guess. Rules are documented in `reference/cli/diagnose.md`.

**Q8. 33 packages and 20,700 tests sounds over-engineered.**
One install: `reactive-agents` is the facade. The packages are separate so you can take only what you need, and
everything past the core loop is opt-in through a `.with*()` call. Concede the point if it is about docs
size: the docs are large, and you want to hear where a reader got lost.

**Q9. Was this written by AI? Is this a "vibe-coded" framework?**
Answer honestly. The repo openly uses AI coding agents (`AGENTS.md`, warden agents in `.claude/`). Say how you use
them and what you check: tests, typecheck and gates in CI, every change reviewed by you. Do not deny or minimize
it; a later discovery would cost more than the admission. This question is likely: peerd (item 48646165) drew
"Why has AI writing become so insufferable?" over a verbose feature list.

**Q10. Who uses it in production?**
Do not claim users you cannot name. Say: pre-1.0, you run it yourself, and you would like to hear from anyone who tries it.

**Q11. MCP?** Client yes (stdio and remote servers, Docker-managed containers). Exposing an agent as an MCP server is not built.

## 7. Timing

- **Day:** Tuesday to Thursday. **Avoid** the week of 2026-11-23 (US Thanksgiving is Thursday 2026-11-26) and
  2026-12-21 to 2027-01-01.
- **Hour:** 12:00-13:00 UTC (07:00-08:00 US Eastern in winter). Myriade's analysis of 157k+ Show HN posts found
  weekday 11-13 UTC most consistent (https://www.myriade.ai/blogs/when-is-it-the-best-time-to-post-on-show-hn, via
  search 2026-11-18). Hour-of-week effects are weak in other analyses; being present for the next 6-8 hours matters more.
- **Launch gate:** the readiness plan says launch only after Phases 0-2 and 5.1 (benchmark). 5.1 is deferred, and
  the plan allows "an equivalent honest proof". This kit's position: the keyless demo plus a shipped failing-trace
  sample (section 8, blocker 2) is that proof. Launching with neither is the Pure Effect pattern (58 points, top
  comment: "yet I have no seen any evidence" [sic], item 48620848).

## 8. Launch-day checklist

**In the 24 hours before:**
- [ ] Clean install on a fresh directory: `npm install reactive-agents` on Node 22.5+ (Linux and macOS) and
      `bun add reactive-agents`; run the README's two snippets as written. Fix any failure or postpone.
- [ ] Keyless path: `ollama pull qwen3:4b`; run the local tool-agent snippet and `local-vs-frontier.ts` with `SKIP_FRONTIER=1`.
- [ ] `rax-diagnose` from a clean install, on the run just made: confirm the install instruction in
      `reference/cli/diagnose.md` works as written (`@reactive-agents/diagnose`, bin `rax-diagnose`).
- [ ] README links all resolve (docs, comparison pages, demo files, Discord `Mp99vQam3Q`).
- [ ] GitHub About text matches the hero; repo topics fine.
- [ ] Issues and Discussions open; one pinned "Feedback from HN" discussion is fine (no asks for votes).
- [ ] HN account has genuine participation (rule 10). Check the account can submit a Show HN.

**Posting:**
- [ ] Submit by hand: title A, repo URL, short text you wrote.
- [ ] Post the first comment within 2 minutes.
- [ ] Add an Umami annotation with the time and the HN item ID.
- [ ] Do not share the HN link with anyone and ask for votes. No "we're on HN!" posts until it has run its course.

**During (6-8 hours):**
- [ ] Reply to every substantive comment, kindly, in your own words. Concede valid points (Forge's author did; it
      read as credible). No defensiveness about competitors.
- [ ] Log every bug or doc gap raised as a GitHub issue during the thread, and link the issue in your reply.
- [ ] Do not edit the post text to add claims mid-thread.

**After (7 days):** retro per readiness plan Phase 6: stars, subscribers, quickstart clicks, install copies,
issues opened, against the Phase 1 baseline. Record which questions came up that this kit missed.

## 9. Patterns from comparable Show HNs (HN Algolia API and item pages, read 2026-11-18)

| Post | Points / comments | What worked or hurt |
|---|---|---|
| Forge, "Guardrails take an 8B model from 53% to 99%" (item 48192383, 2026-05-19) | 687 / 252 | A number with method (paper, 50 runs per cell, McNemar's test) and stated limits. Pushback: "hiding something or overinflating"; author conceded and shipped doc fixes during the thread |
| Mastra (item 43103073, 2025-02-19) | 442 / 154 | Personal intro, origin problem, one-command start (`npm create mastra`), demo video. Benefited from the team's track record, which RA lacks |
| Mastra 1.0 (item 46693959, 2026-01-20) | 213 / 70 | "Why should I use this over Strands or Spring AI?"; "locked in to a platform" |
| Nous (item 41202064, 2024-08-09) | 155 / 37 | Trace UI praised; "I'm not entirely sure what this does"; name collision raised in two top-level comments |
| agent-harness-kit (item 48047826, 2026-05-07) | 82 / 23 | "is it really provider agnostic?"; "It took me awhile to figure out what this even does" |
| peerd (item 48646165, 2026-06-23) | 75 / 23 | Author's technical first comment helped; "Slop overload" aimed at a long FEATURES.md |
| Pure Effect (item 48620848, 2026-06-21) | 58 / 14 | "no ... evidence"; "Why not just use Effect?" |
| VoltAgent (item 45346636, 2025-09-23) | 22 / 5 | Linked a marketing site; generic "observability" pitch |
| Better Agent, Rebuno, AXAR, Pocket Flow and most 2025-2026 TS agent-framework Show HNs | 1-4 / 0 | Generic "composable/production agent framework" titles. The base rate for this category is a flop |

Takeaway: the base rate for "TypeScript agent framework" Show HNs is near zero. The ones that land state one
concrete problem in the title, give a way to try it in a minute, back their main claim with something checkable,
admit limits, and keep the author in the thread.
