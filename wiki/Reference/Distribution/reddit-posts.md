---
type: reference
status: draft
created: 2026-11-18
updated: 2026-11-18
tags: [distribution, launch, reddit, positioning]
---

# Reddit launch kit (draft, 2026-11-18)

Replaces the 2026-06 drafts. Part of Phase 6 of [[../../Planning/Implementation-Plans/2026-11-17-docs-adoption-readiness]].
Positioning: [[../../Research/2026-11-18-agent-harness-market-landscape]] (hero "Agents that show their work.").
Show HN companion: [[show-hn-post]]. Numbers come only from `apps/docs/src/data/metrics.json`.

> [!warning] Source quality: subreddit rules here are secondhand
> Reddit blocked every direct read on 2026-11-18: `reddit.com/.../about/rules.json`, `old.reddit.com`, WebFetch and the
> Chrome extension (site blocked by permissions), plus two mirrors (403/404). The sitewide rules below are primary
> (redditinc.com). **Every per-subreddit row comes from third-party aggregators and is marked as such.** Before
> each post, open the subreddit's sidebar, rules page and pinned posts on reddit.com yourself and fix this table.
> Mods change rules without notice, and a rule you missed costs the post and the account's standing.

> [!warning] Write the posts yourself
> r/LocalLLaMA reportedly disallows "primarily LLM-generated content" unless use is transparent (aggregator,
> https://intoru.ai/subreddits/localllama); r/LLMDevs rule 7 reportedly asks that AI-generated content carry
> attribution. Readers also punish AI-sounding prose. The drafts below are titles plus **beats**: write the body
> in your own words.

## 1. Sitewide rules (primary, read 2026-11-18)

- Reddit Rule 2: "Participate authentically in communities where you have a personal interest, and do not spam or
  engage in disruptive behaviors (including content manipulation)". https://redditinc.com/policies/reddit-rules
- Reddit Rule 5: "Be authentic ... do not intentionally mislead others or impersonate an individual or entity".
  Same page. This rules out sockpuppets, alt accounts and undisclosed authorship.
- The old "9:1" ratio is no longer a sitewide rule in the current help pages (the help center returned 403 to a
  direct read; several 2026 guides agree the ratio now lives only in subreddit rules, for example
  https://redship.io/blog/reddit-self-promotion-rules). Several target subs restate it as "1 in 10" (below).
- Practical consequence: each sub where you post needs a visible history of non-promotional participation by
  you, roughly 9 genuine comments or posts per project post, built *before* launch, not on launch day.

## 2. Per-subreddit rules (secondhand; verify on the sidebar before posting)

| Sub | Project post allowed? | Flair / tag | Link in post? | Frequency / limits | Promo thread | Source (accessed 2026-11-18) |
|---|---|---|---|---|---|---|
| r/LocalLLaMA | Yes, limited. Rule 4 "Limit Self-Promotion": self-promotion "should not be more than 10% of your content"; no sensational titles; no affiliate links; links go directly to the source (GitHub) | "I Built A Thing" or "Resources"; never "News". Launches flaired "Discussion" are reportedly removed | Yes, direct GitHub link | 5 karma earned *inside the sub* or AutoModerator removes the post. Karma minimums were added in rule changes reported 2026-05-02 | None found | https://spacestationlabs.ai/subreddits/localllama (data 2026-10-04, rules text archived 2025-01); https://ai-radar.it/article/qualita-e-controllo-le-nuove-regole-di-r-localllama-migliorano-il-dibattito?lang=en (2026-05-02); https://intoru.ai/subreddits/localllama |
| r/LLMDevs | Ambiguous. Rule 5 "No self-promotion", yet open-source projects with code and measured results reportedly stay up. A 2025-01 mod post was titled "Community rule reminder: no unapproved promotions" | "Tools" or "Resource" | Yes | Account history helps: Reddit's own filters removed about 28% of sampled posts. Rule 3 accuracy; rule 7 cite sources | None found | https://spacestationlabs.ai/subreddits/llmdevs (data 2026-10-04); mod post title from search result `r/LLMDevs/comments/1hshvd2` (mirror, not readable) |
| r/AI_Agents | Only in the right place. Rule 3: "Put your links in the comments, not the posts"; project links go to the **weekly Project Display thread**. Rule 4: about "one out of ten posts/comments"; all-promo accounts are banned | "Discussion" (85% of sampled posts) | **No**: link in a comment only | 1 in 10 | Weekly Project Display thread (reportedly low reach: top comment 4 points, readiness plan section 1, secondhand) | https://spacestationlabs.ai/subreddits/ai_agents (data 2026-10-04) |
| r/typescript | Unknown. Mirrors show self-submitted articles marked "[Full disclosure: self-submission]" | Unknown | Unknown | Unknown | None found | Search 2026-11-18 found no rules page; mirror listings only |
| r/node | Unknown. One vendor guide says self-promotion is allowed for active members | Unknown | Unknown | Unknown | None found | https://www.teract.ai/resources/reddit-marketing-developer-tools-2026 (vendor, low weight) |
| r/bun | Existence not verified (aggregator has no page; a 404 there proves nothing) | n/a | n/a | n/a | n/a | Check reddit.com/r/bun by hand |
| r/ollama | Unknown | Unknown | Unknown | Unknown | Unknown | No source found |
| r/MachineLearning | **No standalone post.** Self-promotion goes to the "[D] Self-Promotion Thread"; standalone "[P]" posts exist but are for research-grade projects | "[P]" title tag | n/a | n/a | Periodic "[D] Self-Promotion Thread" | https://aiexpert.network/r-machinelearning/; thread title seen on mirrors |
| r/javascript (extra) | Showcase only in "Showoff Saturday"; keep self-promotion "to a minimum" | n/a | Yes | Weekly | Showoff Saturday | Search result summary of the r/javascript wiki (mirror) |

**Decision from the table:**
- **Main post: r/LocalLLaMA** (the audience with the pain, explicit project flair, direct links allowed).
- **Second: r/typescript**, only if the sidebar allows it once you check.
- **r/AI_Agents:** a problem-first discussion post with no link in the body, the repo in a comment, plus a comment in
  the weekly Project Display thread. Not a launch post.
- **r/LLMDevs:** message the mods first and ask whether an open-source project post is welcome. Post only on a yes.
- **Skip:** r/MachineLearning (wrong audience; standalone promo not allowed), r/node and r/ollama until rules are
  confirmed, r/bun unless it exists and allows it (Bun is recommended, not required, so it is a weak fit anyway).

## 3. Drafts (titles final-ish; bodies are beats to write in your own words)

### 3.1 r/LocalLLaMA, flair "I Built A Thing"

**Angle:** small local models and multi-step tool calling. Lead with failure modes, not the framework.
Matches the strongest proven demand (Forge Show HN, 687 points; "Running local models is good now", 1,596 points;
see landscape doc section 3).

**Title options** (no hype words, no numbers you cannot back):
- `The tool-calling failures I kept hitting with qwen3:4b, and the fixes I built into an open-source TS agent harness`
- `Running a multi-step tool agent on a 4B model: what broke, what a harness can repair, and what it can't`

**Body beats:**
1. One line on you and the setup: TypeScript, Ollama, `qwen3:4b`, multi-step tasks with tools.
2. The failure modes you saw, as a list. Only list ones the code addresses, and name the file:
   - wrong or near-miss tool names (`packages/tools/src/healing/tool-name-healer.ts`);
   - wrong parameter names or shapes (`param-name-healer.ts`, `param-structure-healer.ts`);
   - malformed JSON arguments (`json-repair.ts`) and file content written as one line with literal `\n` (`literal-newlines.ts`);
   - calling the same tool over and over (`repetitionGuard` in `packages/reasoning/src/kernel/capabilities/act/guard.ts`;
     loop detector in `kernel/capabilities/reflect/loop-detector.ts`);
   - when a run did fail, not knowing why. Every run writes a local trace; `rax-diagnose cause <runId>` names a cause from trace events only, with zero tokens.
3. What did *not* work, to show the measuring habit: automatic strategy switching showed no accuracy lift on
   `qwen3:4b` and `cogito:8b` and cost 28% more billed tokens, so it ships off by default (`features/local-model-performance.md`).
4. Honest limits: no with/without-harness pass rate published yet (the GIF is one demo task, not a benchmark); pre-1.0.
5. Link: repo (direct, GitHub). How to try with no key: `ollama pull qwen3:4b`, then the README's tool-agent snippet.
6. Question to the sub: which small models and which tool-call failures do you see most? Which serving backend?
   (Forge found the same weights scoring 7% on one backend and 83% on another, so backend matters.)

**Planned first comment (yours, within minutes):** the 15-line README snippet (`ReactiveAgents.create().withProvider('ollama').withModel('qwen3:4b')...`)
and an offer: "post a task that fails for you on a small model and I'll run it through the harness and share the trace."

### 3.2 r/typescript (only if the sidebar allows project posts)

**Angle:** design write-up about building an agent loop on Effect-TS. The technical lesson leads; the project is context.

**Title options:**
- `Building an LLM agent loop on Effect-TS: typed tool schemas, tagged errors and per-run state`
- `What I learned putting an agent harness on Effect-TS (and hiding it from users who don't want Effect)`

**Body beats:**
1. The problem: agent loops are full of failure paths (provider errors, malformed tool calls, budgets, aborts) that
   usually surface as thrown exceptions and lost state.
2. What Effect gave you: typed error channel, layers for opt-in capabilities, per-run scoped state instead of module-level
   globals, which makes runs traceable and replayable. One short code excerpt of `defineTool` with `Schema.Struct`
   (args typed as `{ orderId: string }`), from the README.
3. The cost: learning curve and contributor friction. The choice to keep `createAgent()` / `agent.run()` promise-based so users
   never touch Effect. Say what is still imperfect (a shrink-only CI ratchet is still draining string throws and casts). No "no `any`" claims.
4. Link to the repo and to `concepts/architecture` docs. Disclose it is your project in the first line.
5. Question: would Effect in the dependency tree stop you from trying a library like this?

**Planned first comment:** short note on Node vs Bun (Bun recommended; Node 22.5+ supported via `runtime-shim`; on Node,
SQLite full-text search falls back to `LIKE`).

### 3.3 r/AI_Agents, flair "Discussion" (no link in the post)

**Angle:** "why did my agent fail, and was it the harness or the model?" Discussion first.

**Title:** `How do you tell whether a failed agent run was the model's fault or your harness's?`

**Body beats:**
1. The situation: a run fails, you swap models or tweak prompts, and you never learn which layer broke it.
2. What you tried: recording every run as a trace and classifying failures from trace events with fixed rules
   (no LLM judge), returning harness / model / environment, or "unattributed" when the trace cannot settle it.
3. The hard parts you have not solved: thin traces give `insufficient-trace`; a verifier reject or a wrong answer
   with no evidence check stays unattributed.
4. Ask: how do others attribute failures today? Evals, LLM judges, manual trace reading?
5. "Repo in the comments if anyone wants the rules" and nothing more.

**Planned first comment:** link to `docs.reactiveagents.dev/reference/cli/diagnose/` and the repo, disclosed as yours.
**Afterwards:** one comment in that week's Project Display thread with the one-line hero and repo link.

## 4. Posting sequence

Spacing respects the 10% norms and keeps each post distinct. Never cross-post the same text.

| When | Action |
|---|---|
| Now to launch (2-4 weeks) | Participate for real in r/LocalLLaMA, r/typescript, r/AI_Agents: answer questions you know (local models, TS, agents). Earn the in-sub karma floor (5 in r/LocalLLaMA). Confirm each sidebar and fix section 2 |
| Launch day (Show HN, Tue-Thu) | No Reddit post that day. Your attention belongs in the HN thread |
| HN + 2-4 days | r/LocalLLaMA post (3.1), weekday US morning. Stay in the thread for the first 3-4 hours |
| HN + 1 week | r/typescript post (3.2), if allowed |
| HN + 2 weeks | r/AI_Agents discussion (3.3); Project Display comment that week |
| After a mod reply | r/LLMDevs post only if the mods approve; write a new body, do not reuse 3.1 |
| Later | A repost-worthy update is the with/without-harness benchmark with error bars. That is a new post, not a bump |

Each post: add an Umami annotation (time, sub, permalink). Reddit and GitHub show referrers, so UTMs are not needed;
skip them on GitHub links (GitHub ignores them).

## 5. Do not

- Do not ask anyone to upvote, and do not share the post link with a "go vote" (Rule 2, content manipulation).
- Do not use alt accounts, friends' accounts or paid posting services, and do not have others post "I found this
  cool repo" (Rule 5, authenticity).
- Do not post the same text to several subs, or more than one project post per sub in the sequence above.
- Do not post a pasted LLM draft. Write it; disclose that the project is yours in the first line.
- Do not claim absolutes ("never fails", "fully type-safe", "no `any`"), "signed receipts" without "optional", a
  pass rate, or production users you cannot name.
- Do not use hype titles ("game-changer", "best", "finally") or put test and package counts in titles.
- Do not argue with critics. Concede valid points, file issues for real bugs, link the issue.
- Do not delete and repost a post that underperformed.
- Do not post in r/MachineLearning outside its self-promotion thread.

## 6. Reddit patterns (evidence quality: secondhand)

Reddit threads could not be read directly, so this section is weaker than the HN one in [[show-hn-post]] section 9.
- r/AI_Agents winners are problem-plus-number posts (140-340 upvotes); the Project Display thread is low reach
  (readiness plan section 1, secondhand, unverified).
- r/LLMDevs: open-source projects with code and measured results stay up; bare signup links get little engagement
  (spacestationlabs, above).
- Small-model tool calling is contested in the community: some report 4B models scoring well on tool-call
  benchmarks yet failing in practice (Agent Times write-up of an April 2026 r/LocalLLaMA thread,
  https://theagenttimes.com/articles/local-tool-calling-divides-our-community-breakthrough-or-col-a0eff21e,
  secondhand, via the landscape doc). Expect "which backend, which quant?" questions: answer with specifics.
