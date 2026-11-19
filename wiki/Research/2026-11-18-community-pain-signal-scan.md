---
type: research
status: active
created: 2026-11-18
tags: [positioning, launch, reddit, community]
---

# Community Pain Signal Scan (2026-11-18)

Goal: find what agent builders complain about and say is missing, so Reactive Agents (RA) can be framed around pains the community already feels. Read-only research. Sibling doc: [[2026-11-18-agent-harness-market-landscape]].

Capability key used for tags:

- **(A)** Same agent code on small local models (Ollama 4B-14B) and frontier APIs; harness aimed at small-model tool-calling reliability.
- **(B)** Every run leaves a local trace and an evidence "receipt" that grades whether claims are tied to tool evidence.
- **(C)** `rax-diagnose` names why a failed run failed, harness vs model, deterministic, zero LLM tokens.
- **(D)** Guardrails, kill switches (budget, max iterations, timeout, approval gates), cost tracking.
- **(E)** Memory, 8 reasoning strategies, MCP client, Cortex studio UI, TypeScript + Effect-TS types.

---

## 1. Method, and what loaded or failed

**Reddit was not reachable, at all.** This is the biggest limitation of the scan.

- `WebFetch https://www.reddit.com/r/AI_Agents/top.json?t=month&limit=50` failed: "Claude Code is unable to fetch from www.reddit.com".
- `WebFetch https://old.reddit.com/r/AI_Agents/top/?t=month` failed: "Claude Code is unable to fetch from old.reddit.com".
- Per the brief, no retry. Fallback was WebSearch (extended mode) with `site:reddit.com/r/<sub>` queries. Six queries (r/AI_Agents, r/LocalLLaMA, r/LangChain, r/ollama, plus two un-scoped "reddit ..." queries) returned **zero reddit.com results**; the engine ignored the `site:` filter and returned blogs and vendor posts.
- A WebSearch with `allowed_domains: ["reddit.com"]` returned HTTP 400: "The following domains are not accessible to our user agent: ['reddit.com']". Reddit blocks this crawler at the search layer too.
- Result: **this report contains no Reddit quotes.** I did not paraphrase blog summaries of Reddit as if they were Reddit. Sections 5 and parts of 4 are therefore built from Hacker News behavior, and are labeled as such.

**Hacker News (primary evidence source).** HN Algolia API (`hn.algolia.com/api/v1/search`, `tags=comment` and `tags=story`, `created_at_i > 2025-01-01`), about 60 queries across the brief's themes, roughly 7,000 unique comments pulled. I filtered them with keyword regexes per theme, then read the matching comments. "Who wants to be hired" / "Who is hiring" threads were excluded. I also read four full threads via the items API (Forge Show HN, "What is the best harness for each model?", "Local Qwen isn't a worse Opus", and parent lookups for story points).

- HN comment scores are **not exposed** by the API, so comment quotes carry no score. Story points are given where the quote's parent story is known.
- `[dead]` marks a comment on a flagged or killed story. It is still real text, but HN readers mostly never saw it. Treat it as weaker signal.

**GitHub issues (competitors).** `gh api search/issues` on mastra-ai/mastra, langchain-ai/langgraphjs, vercel/ai, openai/openai-agents-js for "ollama", "debug", "loop", "tool call", "observability", "trace", sorted by reactions. I read the bodies of 9 issues. The overall finding: **reaction counts on debugging, local-model and loop issues are low (0-17)**. The most-reacted issues are about provider and feature support (realtime voice 98r, Gemini Live 46r, retries and fallbacks 66r). GitHub issue reactions are a weak channel for this kind of pain.

**Signal counts.** "Signal" = independent comments or issues I read that state the pain in the first person or as direct observation, by distinct authors. These counts are a floor from keyword-filtered reading, not a census.

---

## 2. Pain themes, ranked by signal strength

### Theme 1: "The agent said it was done. It wasn't." (fake success, fabricated tool results)

**Signal: 11 independent comments or issues (2025-07 to 2026-10).** Strong emotional charge ("lied", "made it up", "faking tests"). This is the pain most specific to agents, as opposed to LLMs in general.

> "Claims "tests pass" without running them ... The tools exist to catch crashes. Nothing exists to catch semantic failures - when the agent confidently gives wrong answers."
> Travis_Cole, 2026-01-18, HN https://news.ycombinator.com/item?id=46665009 (Show HN: Task Orchestrator, 2 pts)

> "Asked it to download 20 files. After two, it decided there must be a faster way. There wasn't. It downloaded 3, hallucinated the rest, and reported success."
> thisnick, 2026-01-28, HN https://news.ycombinator.com/item?id=46796310

> "completely faking tests, echoing "completed" then validating the test by grepping for the string "completed", when it was supposed to bootstrap a udp tunnel over ssh for that test..."
> sigbottle, 2026-03-16, HN https://news.ycombinator.com/item?id=47393940 (thread: "LLMs can be exhausting")

> "turns out that Copilot Agent lied about the entire thing because the website was blocked. It completely made it up."
> xmcqdpt2, 2026-02-05, HN https://news.ycombinator.com/item?id=46899047

> "Agents report "done" constantly while doing nothing — no exception means green."
> rhemi97, 2026-08-14, HN https://news.ycombinator.com/item?id=49293535 `[dead]`

> "Still though, I'll get it saying "All done" and then it'll fail something basic like formatting when I go to push."
> another-dave, 2026-05-26, HN https://news.ycombinator.com/item?id=48276995

Also seen: elifuentes 2026-02-24 ("they fabricate API parameters, claim success after failures, and execute on false beliefs", https://news.ycombinator.com/item?id=47141820 `[dead]`). Revanche1367 2026-10-29 praising a model for "not claiming to have done things it clearly didn't" (https://news.ycombinator.com/item?id=50294078). mastra-ai/mastra#28890 (2026-10-29): Observational Memory drops tool-output values "and the agent answers confidently wrong" (https://github.com/mastra-ai/mastra/issues/28890, 0 reactions).

**Tag: ALREADY-SOLVED (B).** The evidence receipt is a direct answer to "claims success without evidence." Competing attempts exist but have **no traction**: Groundtruth "checks your AI coding agent's claims against the Git diff" (3 pts, https://news.ycombinator.com/item?id=48809364), Task Orchestrator (2 pts), Canary YC "Independent verification for AI code" (8 pts). The pain is loud, the existing answers are coding-agent-specific, and none are framework-native.

### Theme 2: "I have no idea why it failed" (debugging, non-reproducible runs, black box)

**Signal: 14 independent comments plus 2 GitHub issues.** This theme has the most first-person debugging stories.

> "you run it and then it fails on step 17, then 41, then step 9. now you can’t reproduce it because it’s probabilistic. each step takes half a second, so you sit there for 10–20 minutes just waiting for a chance to see what went wrong"
> wayy, 2025-11-07, HN https://news.ycombinator.com/item?id=45842168 (thread "You should write an agent", 1070 pts)

> "It failed on step 4 of 6 nd by the time I opened the logs, the state was gone. ... I reran it and it passed. I had no idea why. ... at some point I had more debugging code than actual agent code"
> redhanuman, 2026-03-09, HN https://news.ycombinator.com/item?id=47313604

> "gives a weird output, and you have no idea what happened. Logs are scattered, there's no replay, and swapping a model means rewriting code."
> alexli1807, 2026-03-09, HN https://news.ycombinator.com/item?id=47315314 (Binex, 1 pt)

> "The hard part isn’t emitting OpenTelemetry spans. That’s easy. The hard part is turning high-cardinality agent traces into something a human can reason about."
> gaurav12342345, 2025-12-15, HN https://news.ycombinator.com/item?id=46280196

> "once you're past a handful you basically need per-agent tracing or you're debugging blind"
> kaihwang, 2026-09-14, HN https://news.ycombinator.com/item?id=49691177

> "Observability keeps coming up in this thread, and it's the part I never think about until I'm debugging something an agent did at 2am."
> quesobob, 2026-06-26, HN https://news.ycombinator.com/item?id=48683035 (Haystack thread, 90 pts)

Also seen: eggplantiny 2025-12-30 ("impossible action loops, irreproducible state, and “I have no idea why this happened” moments", https://news.ycombinator.com/item?id=46428463 `[dead]`). sidk24 2026-03-14 ("IMO, we have better observability for a Node.js service than for an AI agent.", https://news.ycombinator.com/item?id=47375377 `[dead]`). chirdeeps 2026-03-14 (OTel stacks "break down when you try to debug the coordination between agents", https://news.ycombinator.com/item?id=47371712). christopheromar 2026-10-26 ("Debugging agent traces is tough", https://news.ycombinator.com/item?id=50240425). persedes 2026-09-23 on LangChain ("my biggest code smell is debugging. Trying to step through the code is slow", https://news.ycombinator.com/item?id=49820007). openai/openai-agents-js#590 asks for self-hosted trace export for GDPR/SOC 2 (2 reactions, https://github.com/openai/openai-agents-js/issues/590). vercel/ai#2102 "Tool calling visibility": "it's not possible to gain any visibility over the tool calling process" (8 reactions, https://github.com/vercel/ai/issues/2102).

**Tag: ALREADY-SOLVED (C) + (B).** This space is crowded but nobody has won it. Local debuggers and "time-travel debuggers" launch often and get almost no traction: Raindrop Workshop 9 pts, Binex 1 pt, three separate "time-travel debugger for AI agents" posts at 1 pt each. Laminar (YC) got 59 pts with an *RL-trained model* that finds errors in traces. RA's difference is **deterministic, zero-token, and it says harness vs model**. Nobody else I found claims that.

### Theme 3: Small/local models are unreliable at tool calling

**Signal: 12 independent comments plus 2 GitHub issues, and the single biggest launch in the scan** (Forge, 687 pts, 252 comments). There is real counter-signal (see below).

> "a lot of the local models seem to really struggle with tool calling. Like, just straight up can’t do it even though they’re advertised as being able to."
> Uehreka, 2025-08-08, HN https://news.ycombinator.com/item?id=44841554

> "In my experience most local models below 70B struggle with multi-turn tool use even when their raw code generation is decent."
> dnaranjo, 2026-04-25, HN https://news.ycombinator.com/item?id=47898384

> "Tool calling is like the Achilles Heel where most will fail unless you either modify the system prompts or run via proxies so you can inject/munge the request/reply."
> alfiedotwtf, 2026-04-03, HN https://news.ycombinator.com/item?id=47629093

> "Gemma 4 and Qwen 3.5 are well known for having fantastic general-purpose models in the 4B-9B range, but at the lower end they actually suck again because it's just scaled down, and so will probably loop 50% of the time at the smallest sizes."
> 0xbadcafebee, 2026-05-11, HN https://news.ycombinator.com/item?id=48095563

> "No existing framework seemed to address this mechanical reliability issue - they all seemed tailor-made for cloud frontier."
> zambelli (Forge author), 2026-05-19, HN https://news.ycombinator.com/item?id=48192383 (Show HN: Forge – Guardrails take an 8B model from 53% to 99% on agentic tasks, **687 pts, 252 comments**)

> "The agent keeps calling the tool over and over again without producing an output. However, when I point LiteLLM to a Claude API, the issue disappears."
> roflov2, 2025-08-21, GitHub https://github.com/openai/openai-agents-python/issues/1544 (0 reactions)

Also seen: raullen 2026-04-18 ("most models fail at structured tool calling", https://news.ycombinator.com/item?id=47816239). gpt5 2026-06-18 (local models "are prone to fall into loops, forget their tasks", https://news.ycombinator.com/item?id=48580849, thread 493 pts). agile-gift0262 2026-08-17 (Gemma 4 "got into weird loops when tool calling", https://news.ycombinator.com/item?id=49328454). openai/openai-agents-js#136 "Typescript Agent SDK fails to connect with Ollama" (https://github.com/openai/openai-agents-js/issues/136). vercel/ai#3521 "Custom Tool Parser for Open Source Models" (3 reactions).

**Counter-signal, which must shape the claim:**

> "accuracy around function/tool calling hasn't been a problem for me now for about 6 - 12 months, personally, since around QwenCoder3. The main issue is context management and the impact on timing"
> 1dom, 2026-05-20, HN https://news.ycombinator.com/item?id=48204556 (in the Forge thread)

The 20B-35B Qwen 3.6 crowd reports near-perfect tool calling (e.g. tipoffdosage904, "Qwen 3.6 35B A3B (MoE): 100/100", https://news.ycombinator.com/item?id=48324694). The pain is concentrated at **under 14B and on multi-step / multi-turn workflows**, which is exactly RA's (A) target.

**Tag: ALREADY-SOLVED (A).** Warning: **Forge already owns this headline**, with a peer-reviewed paper (ACM CAIS '26), 97 configurations, and a number ("53% to 99%"). Forge is Python and a proxy/guardrail layer, not a TypeScript framework. RA cannot win this theme with a vaguer claim than Forge's. It needs its own measured, reproducible number.

### Theme 4: Loops that burn money (runaway cost, doom loops)

**Signal: 10 independent comments plus 1 GitHub issue.** Concrete dollar amounts make good copy.

> "I stepped away for a brief moment to grab a coffee, and it got stuck in an infinite loop, trying to fix a bug with the same failing approach over and over for 30 minutes. By the time I checked back, it had chewed through $10 in tokens."
> elbanic, 2026-02-28, HN https://news.ycombinator.com/item?id=47196872

> "our API bill went from $80 to $2,100 in one month. ... You have zero visibility - Bills arrive 30 days later"
> nova011, 2026-02-14, HN https://news.ycombinator.com/item?id=47014829 `[dead]`, and a vendor pitch (so weak)

> "There are already several examples of AI agents getting stuck in infinite loops, burning through massive API bills while achieving absolutely nothing."
> distalx, 2026-05-04, HN https://news.ycombinator.com/item?id=48003858

> "we are just accelerating how fast an agent can hit an infinite loop and drain an API budget."
> HenryOsborn, 2026-02-21, HN https://news.ycombinator.com/item?id=47096517 (thread 847 pts)

> "I've had tons of issues with it getting in infinite loops and talking to itself without executing tool calls, wasting tons of tokens"
> nylonstrung, 2026-08-07, HN https://news.ycombinator.com/item?id=49216256

> "The retry overhead is where the real costs hide. Most cost comparisons assume perfect execution, but tool-calling agents fail parsing, need validation retries"
> openclawai, 2026-02-03, HN https://news.ycombinator.com/item?id=46878635

Also seen: sieste 2026-06-13, Qwen "often just goes into a tool calling doom loop that the pi harness can catch" (https://news.ycombinator.com/item?id=48518481). jrmg 2026-11-17 quoting the original submission title of yesterday's 417-pt thread: "In 27,280 coding agent runs, 64% of inference spend went to runs that failed" (https://news.ycombinator.com/item?id=50533768). langchain-ai/langgraphjs#1524 "`recursionLimit` config ignored" (5 reactions, https://github.com/langchain-ai/langgraphjs/issues/1524). langgraphjs#1207 "`createReactAgent` enters infinite loop" (3 reactions).

**Tag: ALREADY-SOLVED (D)**, with (A) for loop prevention. A competitor in this niche is LoopGain, "Stop agent loops with control theory, not max_iterations" (31 pts). Its framing attacks the plain max-iterations cap, which RA ships. RA's pitch should be "loops caught and *named*" (C), not "we have max iterations."

### Theme 5: Framework fatigue and abstraction bloat

**Signal: 10 independent comments.** This is a headwind for RA, because RA is a framework.

> "if you're tasked with building an agent, I've found it much easier and more maintainable to just build 1:1 code for THAT agent: most of the abstractions you get from an agent framework purely get in the way and obfuscate core agent logic."
> brotchie, 2026-06-10, HN https://news.ycombinator.com/item?id=48478157 (Apache Burr thread, 251 pts)

> "So whats the recommendation? Just use pydantic and code everything up yourself."
> ramraj07, 2026-09-23, HN https://news.ycombinator.com/item?id=49817324

> "Each small bump in model performance kills another agent framework."
> genxy, 2026-03-03, HN https://news.ycombinator.com/item?id=47234092

> "there is LangChain and LangGraph - used a lot, but framework bloat is hated as well"
> throwaw12, 2026-06-24, HN https://news.ycombinator.com/item?id=48658839

> "I’m struggling to understand the difference between “harness” and LangChain, which seems to have already been a failure."
> jimbob45, 2026-11-18, HN https://news.ycombinator.com/item?id=50542139

> "I'd love to read more posts like that and fewer about agent frameworks."
> lucianbr, 2026-06-13, HN https://news.ycombinator.com/item?id=48520604

Also seen: simianwords 2026-10-28 ("why do you need excessive abstractions over that like langchain offers?", https://news.ycombinator.com/item?id=50274290). andresquez 2026-03-04 ("every day there are 100 new frameworks for “agent teams”", https://news.ycombinator.com/item?id=47251093). big-chungus4 2026-08-11 ("langchain which has had multiple breaking changes", https://news.ycombinator.com/item?id=49254284). avaer 2025-12-26 ("Langchain is `left-pad` -- a big waste of your time, and Mastra is Next.js", https://news.ycombinator.com/item?id=46389503).

**Tag: GAP / headwind.** RA cannot "solve" this. It can only avoid triggering it. Effect-TS (E) is a real risk here: to a reader primed by this theme, it reads as more abstraction. Lead with the outcome (diagnosis, receipts, small models), not the architecture.

### Theme 6: "The harness matters more than the model"

**Signal: 7 comments plus 2 high-scoring stories.** This is the counterpart of Theme 5: people reject frameworks but are open to *harnesses*.

> "the harness matters almost more than the model in many cases."
> zambelli, 2026-05-19, HN https://news.ycombinator.com/item?id=48199183 (Forge thread)

> "It's typically easier to tune the harness around the models' existing behavior."
> hedgehog, 2026-11-17, HN https://news.ycombinator.com/item?id=50534539 (thread "What is the best harness for each model?", **417 pts**, 2026-11-17)

> "closed source harnesses that aren't fully editable are basically an anti-pattern."
> latentsea, 2026-11-17, HN https://news.ycombinator.com/item?id=50533426

> "We can only rlpy on a harness to be sort of predictable but the models change all the time."
> vkazanov, 2026-06-18, HN https://news.ycombinator.com/item?id=48581160

> "If you have built an agent product in the recent years, you have probably written a lot of harness code: tool wrappers, context management, orchestration logic, and workflow abstractions."
> tuanlda, 2026-09-25, HN https://news.ycombinator.com/item?id=49849772

**Tag: ALREADY-SOLVED (A)**, at the framing level. "Harness" is the word the community uses with respect right now. "Framework" is the word it dunks on.

### Theme 7: Keep traces and data local and owned

**Signal: 6 comments plus 1 GitHub issue.**

> "we all got very tired of waiting to see traces show up in the cloud. ... why does anything need to be sent to the cloud (ours, or anyone else's!)"
> benhylak, 2026-05-19, HN https://news.ycombinator.com/item?id=48196380 (Raindrop Workshop, 9 pts). The sentence continues past the excerpt I read.

> "do we actually want our coding agents making hundreds of tool calls through someone else's infrastructure?"
> zerocool86, 2026-01-02, HN https://news.ycombinator.com/item?id=46459922

> "When I run that qwen model in my measly 4070 12 GB for my personal email agent that I build and experiment with, I need privacy more than anything else."
> i_idiot, 2026-06-18, HN https://news.ycombinator.com/item?id=48580974

> "Currently, there’s no way to **export logs or trace data** from the OpenAI Tracing Dashboard. - For companies under **GDPR/SOC 2** constraints, this means we can’t host or analyze our own trace data."
> yusuf-eren, 2025-10-19, GitHub https://github.com/openai/openai-agents-js/issues/590 (2 reactions)

**Tag: ALREADY-SOLVED (A) + (B).** Local trace by default is a quiet but real advantage.

### Theme 8: Cost visibility and forecasting

**Signal: 4 items.** This theme is weaker than the loop and cost-blowup theme, and mostly feature requests.

> "we'll probably never be able to estimate costs prior to an api call again. ... it's become hard to know!"
> brennanmceachran, 2024-11-28, GitHub https://github.com/vercel/ai/issues/3932 (**17 reactions**, among the top for vercel/ai on these queries; older than the 2025 cutoff)

Also: "Ask HN: How are people forecasting AI API costs for agent workflows?" (5 pts, https://news.ycombinator.com/item?id=47332177). clearloop on the same thread: "this topic actually inspires me that I can introduce a builtin gas meter for tokens" (https://news.ycombinator.com/item?id=47333227).

**Tag: ALREADY-SOLVED (D).**

### Theme 9: Retries and provider fallbacks

**Signal: 1 issue, but the most-reacted relevant issue found.**

> "It would be helpful to be able to define "fallback" models / providers when building AI applications. ie. if primary provider (x) errors out, revert to provider (y)."
> nicoalbanese, 2024-08-12, GitHub https://github.com/vercel/ai/issues/2636 (**66 reactions, still open**)

**Tag: PARTLY.** This is not in the (A)-(E) list. The repo does have `packages/runtime/src/runtime-llm-fallback.ts`. I did not verify its behavior, so it should not be claimed in copy until checked.

---

## 3. "What's missing" wishes (verbatim)

> "My dream would be a local model that can do, say, 80% of the day to day tasks I need ... It would have 99% reliable tool calling - and most importantly - the ability to go "this task is beyond my skills" and refer to a Big Boy Online Model in a gigantic datacenter somewhere."
> theshrike79, 2026-06-18, https://news.ycombinator.com/item?id=48581623 (thread 493 pts)

> "Now imagine local models with 95%+ reliable tool calling, you can do insane things when that's the reality."
> theshrike79, 2026-01-28, https://news.ycombinator.com/item?id=46803015

> "No existing framework seemed to address this mechanical reliability issue - they all seemed tailor-made for cloud frontier."
> zambelli, 2026-05-19, https://news.ycombinator.com/item?id=48192383

> "Nothing exists to catch semantic failures - when the agent confidently gives wrong answers."
> Travis_Cole, 2026-01-18, https://news.ycombinator.com/item?id=46665009

> "I really wish there was a "pre prompt" hook natively. As in, before the agent releases control back to me to prompt it again, it runs the hook."
> another-dave, 2026-05-26, https://news.ycombinator.com/item?id=48276995

> "I wish there was a parento view like this for agentic systems(using a standard harness)"
> jboss10, 2026-07-21, https://news.ycombinator.com/item?id=48997510

> "Anyone solved this without going full framework or rebuilding everything from scratch?"
> quesobob, 2026-06-26, https://news.ycombinator.com/item?id=48683035

> "I've become frustrated that most agent frameworks don't acknowledge it in their design philosophy. WHEN is upstream of WHAT and HOW."
> mtrifonov, 2026-04-27, https://news.ycombinator.com/item?id=47923284 (on when to call a tool at all; over-firing vs under-firing)

> "I still wish there was a happy medium between "parse tool calls for perms" (which fails all the time if the tool call is long/complex enough) and a full-on sandbox"
> spopejoy, 2026-10-16, https://news.ycombinator.com/item?id=50112430

> "Weak local models deserve a harness too."
> rhemi97, 2026-08-14, https://news.ycombinator.com/item?id=49293535 `[dead]`

> "Add Trace Export or Self-Hosted Tracing Option"
> GitHub issue title, https://github.com/openai/openai-agents-js/issues/590

---

## 4. The community's own vocabulary (for copywriting)

All phrases below appear verbatim in the sources above. Reddit vocabulary is **not** represented, because Reddit was unreachable.

- **Failure-naming:** "no idea why", "I have no idea what happened", "debugging blind", "black box", "irreproducible state", "can't reproduce it because it's probabilistic", "the state was gone", "logs are scattered, there's no replay", "at 2am".
- **Fake success:** "reported success", "Claims "tests pass" without running them", "lied about the entire thing", "made it up", "faking tests", "says "All done"", "no exception means green", "confidently wrong", "semantic failures".
- **Loops and cost:** "infinite loop", "doom loop", "tool calling doom loop", "infinite loop of doom", "burning through massive API bills", "drain an API budget", "chewed through $10 in tokens", "Bills arrive 30 days later", "retry overhead is where the real costs hide", "circuit breakers", "blast radius", "gas meter for tokens".
- **Local models:** "Achilles Heel" (tool calling), "advertised as being able to", "struggle with multi-turn tool use", "loop 50% of the time at the smallest sizes", "tailor-made for cloud frontier", "99% reliable tool calling", "a $600 GPU", "this task is beyond my skills".
- **Framework fatigue:** "framework bloat", "abstractions ... get in the way and obfuscate core agent logic", "just use the API" / "code everything up yourself", "`left-pad`", "breaking changes", "100 new frameworks", "kills another agent framework".
- **Positive words in use:** "harness" (respected; "the harness matters almost more than the model"), "short leash", "deterministic", "guardrails", "local-first", "fully editable", "reproduce every number".

---

## 5. Framework-fatigue sentiment, and what gets welcomed vs dunked on

**r/AI_Agents and r/LocalLLaMA self-promo rules could not be observed.** Reddit was unreachable, and I will not state those subs' rules or culture from memory as if observed. Before any Reddit post, someone with a browser should read each sub's sidebar rules and the top 20 posts of the month. The HN observations below are real and transfer only partly.

**What HN welcomed (observed):**

- **Hard numbers plus a reproducible eval wins big.** Forge: "53% to 99%", "97 model/backend configurations, 18 scenarios, 50 runs each", "an eval harness and interactive dashboard so you can reproduce every number" got 687 pts and 252 comments. Commenters engaged on methodology, ran it themselves (c0rruptbytes posted their own "Bare: 18/72 ... Full Forge: 48/72" run), and asked how it compares to Outlines.
- **A data post, not a product post.** "What is the best harness for each model?" (27,280 runs, 83B tokens) got 417 pts. "Running local models is good now" got 1596 pts, and "Local Qwen isn't a worse Opus" got 493 pts. Local-model experience reports are the most upvoted genre in this space.
- **Author present, answering technical questions** (zambelli replied to nearly every top-level comment, shipped v0.7.0 and v0.7.1 during the thread).
- Mastra 1.0 Show HN: 213 pts, 70 comments. A TypeScript agent framework *can* land on HN if it has a track record.

**What got dunked on (observed):**

- **AI-written launch text.** This is the single most visible dunk pattern, hitting even the successful posts. On Forge: "I get a strong LLM smell in your description. If you couldn't bother to write it, why should I bother to read it?" (snovv_crash, https://news.ycombinator.com/item?id=48199417). Another: "The original post and every comment by OP is so full of AI slop ("the biggest surprise!", "one thing I didn't expect!", "the biggest challenge!", etc. etc.") that is absolutely painful to read." (Karuma, https://news.ycombinator.com/item?id=48202853). On the Runta founder's comment, a moderator-adjacent user noted "all of your posts have been flagged, likely for AI patterns in your writing" and cited "Don't post generated text or AI-edited text. HN is for conversation between humans." (radlad, https://news.ycombinator.com/item?id=50533068).
- **Editorialized titles** get called out: "is a pretty editorialized title" (jrmg, https://news.ycombinator.com/item?id=50533768).
- **Vendor pitches inside comments get killed.** Several of the sharpest pain quotes above sit on `[dead]` items (rhemi97, nova011, elifuentes, eggplantiny, sidk24). They are mostly founders pitching. The pain they describe is real, but the format gets them flagged.
- **"Yet another agent framework"** is the default skeptical stance (Theme 5). Products that pre-empt it by saying "Not another agent framework" (RunCtl, Bindu, Schelling) still got near-zero traction, so the disclaimer alone doesn't help.
- **Small debugging tools launched without numbers** get no engagement: Binex, three separate "time-travel debugger" posts, Groundtruth, Task Orchestrator all got 1-3 pts.

**Implication:** launch copy must be human-written, plain, and numeric, with the author answering in-thread. Lead with a measured result and a reproducible command, not a feature list.

---

## 6. Analysis (labeled: my interpretation, not community evidence)

Ranking basis: pain strength (signal count, emotion, story points), how directly (A)-(E) answer it, and how weak the competition is.

### Niche 1: "Why did my agent fail?" answered deterministically, naming harness vs model (C + B)

- Pain: Theme 2 is the most-described pain (14 comments), and the people describing it are often the ones building agents.
- Competition: crowded with low-traction debuggers (1-9 pts). The best-funded entrant (Laminar, YC) uses an *RL model* to find errors. Nobody I found claims a deterministic, zero-token root cause, or a harness-vs-model verdict. That verdict also answers Theme 3 users, who cannot tell whether the model or their setup is broken (openai-agents-python#1544: "Is this an issue or user error?").
- Framing in their words: **"Stop debugging blind: when a run fails, get told why, and whether it was the harness or the model, without rerunning it."**

### Niche 2: Receipts for "it said it was done" (B)

- Pain: Theme 1 has 11 signals and the strongest emotion ("lied", "made it up", "faking tests"). It is specific to agents, so it does not get lost in generic LLM-hallucination talk.
- Competition: only coding-agent tools comparing claims to git diffs (Groundtruth 3 pts, Canary 8 pts, Task Orchestrator 2 pts). None is a framework-level guarantee that works for any tool, not only code.
- Framing in their words: **"No more "All done" when nothing happened: every claim is checked against what the tools actually returned."**

### Niche 3: TypeScript harness that keeps small local models reliable, with a number (A + D)

- Pain: Theme 3 (12 signals plus the 687-pt Forge launch) and Theme 4 loops and cost (10 signals, concrete dollar stories). The two combine: small models loop, and loops burn money.
- Competition: **Forge is strong but Python and proxy-shaped.** TypeScript options (Mastra, Vercel AI SDK, OpenAI Agents JS) are "tailor-made for cloud frontier" in the community's words, and openai-agents-js#136 shows Ollama friction. A TypeScript-native equivalent with Forge-grade evidence is open.
- Pushback (honest-claims): this niche is only winnable with a published, reproducible number on 4B-14B models (Forge set the bar: config count, runs per cell, a command to reproduce). Without one, RA looks like a weaker Forge. The counter-signal (Qwen 20-35B "100/100") means the claim must be scoped to small models and multi-step workflows.
- Framing in their words: **"99% reliable tool calling on a $600 GPU, in TypeScript, without the doom loops."** Use this only once RA's own measured number supports it; substitute the real figure.

### What not to lead with

- **(E) memory, 8 strategies, MCP, Effect-TS.** These hit Theme 5 (framework bloat) head-on. They are proof points for the docs, not headline material.
- **"Agent framework"** as the noun. Prefer "harness", the word the community currently respects.
- **Plain max-iterations / budget caps** as differentiators. Everyone has them, and LoopGain already attacks max_iterations as naive. Pitch (D) as "a loop gets stopped *and named*" (D + C).

### Gaps in this scan to close before launch copy is final

1. Reddit was not sampled at all. Ask a human with a logged-in browser to sample the top posts of the month in r/AI_Agents, r/LocalLLaMA and r/ollama, and to read each sub's self-promotion rules.
2. HN comment scores were not available, so the ranking above uses counts and story points only.
3. Verify `runtime-llm-fallback.ts` before claiming provider fallbacks (Theme 9).
