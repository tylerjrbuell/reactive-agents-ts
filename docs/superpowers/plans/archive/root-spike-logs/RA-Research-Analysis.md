Reactive Agents: Where the Field Is, Where You Stand, What to Do Next

A consolidated view from four parallel research passes — production framework survey, local-model  
 engineering, evaluation rigor, and an internal gap audit. Citations live in the agent reports; this is the
synthesis.

1. Where agentic AI has converged in 2026

Three patterns won. First, the canonical agent loop — gather context → act → verify → repeat (Anthropic's
framing, hidden inside everyone else's runtime). Almost no one ships an agent framework where the user
writes the while-loop anymore. Reactive Agents already has this at kernel/loop/runner.ts (W4 single-owner
termination cleaned it up).

Second, orchestrator-worker is the multi-agent winner. Anthropic published 90.2% lift on internal research
evals at 15× cost (Opus lead + Sonnet subagents). Magentic-One's planner+replanner with dual ledgers,
Devin's parallel-instance dispatch, Cursor 3's parallel-agent UI — they all converge on lead plans and  
 synthesizes, subagents explore in isolated context windows, results condensed back. Nobody is shipping  
 unstructured agent debate anymore. The Cognition "don't build multi-agents" essay and Anthropic's
subagents post don't actually contradict — Cognition is talking about coding (tightly coupled), Anthropic
about parallel research (embarrassingly parallel). The right architecture is task-coupling-dependent.

Third, MCP has won the tool protocol war. 97M monthly SDK downloads, 5,800+ servers, 78% enterprise  
 adoption, Linux Foundation governance with OpenAI/Google/Microsoft/AWS/Anthropic all on board. Tool
definition has been won by an open standard.

Three patterns are diverging.

-   Code-as-action vs JSON-FC. smolagents and OpenHands CodeAct push code execution as the unified action  
    space (CodeAct 2.1 hits 53% SWE-bench Verified with ~30% fewer steps). OpenAI hedged with a sandboxed code
    harness in Oct 2025. Anthropic's "code execution with MCP" essay points toward convergence: tools defined
    via MCP, composed via code. Most JSON-FC frameworks (Reactive Agents included) have not added a  
    code-action escape hatch. This is a real and growing gap.
-   State models. LangGraph: explicit typed state, checkpointed at every super-step. OpenAI: opaque Session.
    Anthropic: file-system-as-memory with just-in-time loading. Mastra: three named layers. No consensus.
-   Framework-thin vs framework-heavy. Industry consensus has tilted hard toward thin. "The framework layer
    is getting thinner with every model generation." OpenAI Agents SDK is the canonical thin runtime (5  
    primitives total: Agent, Handoff, Guardrail, Session, Tool). Anthropic's Agent SDK is even thinner —  
    closer to "look at failure modes, design tools carefully" than a framework. LangGraph is the holdout where
    heavy framework genuinely earns its weight (durable execution, HITL interrupts, time-travel debugging).

2. Where Reactive Agents stands

What you've built well (don't touch)

-   Termination invariant — single-owner via kernel/loop/terminate.ts; CI lint enforces. This kind of  
    single-owner discipline is exactly what NS v3.0 calls for and most frameworks lack.
-   Capability-grouped kernel — act / attend / comprehend / decide / reason / reflect / sense / verify is a
    clean conceptual decomposition; rare in the field.
-   AgentMemory port + adapter — proper port abstraction. LangChain doesn't have this; OpenAI Agents SDK
    doesn't have this.
-   Three-stage context compression pipeline — confirmed coordinated; production-quality discipline.
-   Provider adapter system — all 7 hooks wired; 4×100% on frontier bench.
-   Effect-TS schema-first types — TypeScript ergonomics + runtime validation aligned. Pydantic AI is the  
    closest Python parallel; very few TS frameworks do this rigorously.
-   AGENTS.md / CLAUDE.md / Research Discipline rules — research-first methodology is unusual and  
    load-bearing.  


Where you sit competitively

The honest TS-vs-Python market position: Mastra owns the TypeScript market right now (22k stars, 300k  
 weekly downloads, 1.0 in Jan 2026, Replit + WorkOS in production). Vercel AI SDK v6 is the substrate
Mastra builds on. Pydantic AI dominates Python typed-agent work. LangGraph dominates Python heavyweight  
 orchestration.

Reactive Agents is not competing on academic benchmarks — no TS framework has appeared on a major  
 third-party agent leaderboard. The credible competitive position is:

▎ Production-grade TypeScript framework competing with Mastra/Vercel AI SDK on observability, reliability,
▎ and local-model engineering — not "we beat LangChain on SWE-bench."

The differentiator opportunity is per-tier model adaptation done well — almost no one does this well in  
 OSS, and your ModelTierProfile design (LMAL, Apr 2026) is well-positioned if executed.

3. Biggest engineering/design mistakes to correct

Ranked by impact-on-effectiveness. These are not "make the code prettier" complaints — they're "this is  
 materially holding back agent quality" calls.

Mistake 1 — Mechanism over-investment without spike validation

PROJECT-STATE.md flags it: only 5 of 30+ packages have spike evidence. The rest are plausible mechanisms  
 whose net contribution is unvalidated. The audit has been calling this out for two months and Stage 5  
 closed many defects but did not close the evidence question for most mechanisms.

This is the single biggest mistake. The framework's own Rule 11 (calibrate scope-of-claims to evidence) is
being violated by the framework itself. You ship reactive intelligence dispatcher, healing pipeline,
three-stage compression, calibration store, skills system — all might help, none have isolated spike  
 evidence at the per-mechanism, per-tier level. When the bench shows no lift, you can't tell which  
 mechanism failed.

Fix: make every mechanism either (a) carry a spike result with an AUC/win-rate/% reduction in a tracked  
 failure mode, or (b) get marked _unstable_mechanism_\* with a v0.11 sunset date if no evidence lands. This
is the discipline DSPy and CodeAct papers exhibit and your home benchmarks don't yet.

Mistake 2 — Builder owns too much, in a thin-orchestrator world

builder.ts at 6,082 LOC importing from 13 implementation packages is not where the field is. OpenAI Agents
SDK is 5 primitives. Mastra is 4 cohesive abstractions. The thin-orchestrator consensus says: the
framework layer should shrink, and the model + tools + observability should be primary. Reactive Agents  
 went the other way — every Stage 5 wave added builder hooks, configuration, and wiring.

This is partly hidden because the audit treats it as "SHRINK target FIX-19/FIX-24." But the deeper issue  
 is conceptual: builder is the de-facto orchestrator-of-orchestrators, conflating describe-the-agent with
wire-the-services. Until builder produces only AgentConfig and ExecutionEngine.fromConfig() does the  
 wiring (S4 in §16.4), every new feature deepens the god-class.

Fix: S4 from the strategic findings. Make it a Stage 7 W26 priority, not a "nice to have."

Mistake 3 — The judge is not frozen, and bench results are confounded

The current bench harness constructs a fresh judge agent every call from the same code path being  
 benchmarked. Any change to the harness changes the judge, invalidating before/after comparison. This is a
Rule 4 violation by the framework itself and the audit tracks it as eval P0.

The cost of this mistake compounds with mistake #1 — without a frozen judge, you can't run the spike  
 validation for unproven mechanisms, so the bloat persists.

Fix: containerized judge with pinned model + code SHA + RPC interface. 1-2 sessions. Block v0.10.0  
 publication of any benchmark number until done. The framework's empirical credibility hinges on this.

Mistake 4 — Calibration store collects 14 fields it doesn't consume

packages/llm-provider/src/calibration.ts defines 16 calibration fields; only 2 (optimalToolResultChars,  
 toolCallDialect) are read at runtime. The other 14 (parallelCallCapability, observationHandling,  
 systemPromptAttention, interventionResponseRate, knownToolAliases, knownParamAliases, etc.) are recorded  
 and ignored.

This is the "rich data, sparse consumption" pattern that hides under "we have calibration." When a model  
 under-performs, the harness has the data to react and doesn't.

Fix: for each unused field, either wire a consumer (preferred — parallelCallCapability should gate batch  
 tool calls; interventionResponseRate should gate dispatcher firing for non-compliant models) or delete the
field. The audit-it-or-trim-it discipline.

Mistake 5 — Verifier-driven retry uses the same model + same prompt

Your empirical observation (kills cogito:8b, helps qwen3) is exactly what the literature predicts for  
 single-LLM self-reflection: it degenerates ("degeneration of thought" — MAR paper, arxiv 2512.20845).  
 Self-reflection works when the verifier sees signals the actor missed (schema validation,  
 evidence-grounding gap), and collapses when the verifier just re-asks the same question.

S3 (just shipped) routes the retry through the kernel — this is good — but the underlying issue is the  
 verifier should default to a different model or a structurally different prompt, not the same one. The
framework has the abstraction for this (VerificationLLM interface) but no opinionated default.

Fix: make withVerification() default to escalating one tier higher than the actor model (or use a  
 different prompt persona). Document the cogito-collapse failure mode in FAILURE-MODES.md as the canonical
example.

Mistake 6 — No code-as-action escape hatch

This is the gap that hurts most for hard agentic tasks. smolagents' GAIA result (44.2% with code-action vs
7% bare GPT-4-Turbo) and OpenHands CodeAct 2.1 (53% SWE-bench Verified) are not marginal lifts — they're
step-function changes. For tasks needing 3+ sequential tool calls, a Python-sandboxed code action  
 collapses to one LLM call.

Reactive Agents has code-execution.ts but it's a tool, not an action paradigm. The model is still expected
to emit tool-call JSON; the code skill is just one of many tools. The smolagents thesis is the inverse:
the LLM emits Python that uses tools.

Fix: add a CodeAgentStrategy alongside the existing reactive/plan-execute strategies. Single  
 Python-sandboxed action emitting tool_x(...); tool_y(...); return final_answer(...). The
provider/tier-routing decides when to use it (qwen3 14B + multi-step tasks = code action; haiku + simple  
 Q&A = reactive). This is the highest-impact addition to the strategy registry available right now.

Mistake 7 — Local-model FC parsing is not per-provider-version

Five+ open issues across vLLM, Ollama, llama.cpp, SGLang, LiteLLM all on Qwen3 alone. Each runtime has its
own parser; they all disagree on thinking + tool_calls coexistence. The framework's MEMORY notes already
call this out at the provider level (Anthropic raw streamEvent, Gemini parts walking, Ollama  
 chunk.message.tool_calls) — but it's not extended to the harder case: thinking-model-via-Ollama returning
both thinking and tool_calls (LiteLLM #18922 documents this dropping tool_calls silently).

Fix: extend the provider adapter to include parseToolCalls(rawResponse, modelId, runtimeVersion) with  
 per-model+per-runtime parsers. This is plumbing, not architecture, but it's where 7-14B local model FC
lift is hiding.

4. What's missing entirely

Capabilities other 2026 frameworks ship that Reactive Agents doesn't:

-   Programmatic prompt optimization (DSPy/AutoAgent-style automated optimization). DSPy lets you declare  
    what you want and have the framework optimize prompts via task performance. AutoAgent (April 2026) treats
    the harness itself as an optimization target. Reactive Agents has manual prompt scaffolding via  
    withPersona()/withPrompts() and no auto-optimization loop.
-   First-class snapshot + replay for spike validation. LangSmith and Anthropic Workbench let you replay a
    run with different prompts/models holding everything else constant. Reactive Agents has tracing (rich) but
    no replay primitive — every spike re-runs from scratch. The audit's G4 finding.
-   File-system-discoverable Skills (Anthropic's progressive disclosure pattern). Skills became cross-vendor
    in Dec 2025 (Anthropic, OpenAI Codex, Gemini CLI, GitHub Copilot all on board). The pattern: only Skill  
    name + one-line description in context; full SKILL.md loaded only when relevant; bundled files only when
    steps need them. Reactive Agents has skills, but they're typed-tool/registry-based, not  
    file-system-discoverable.
-   First-class manager pattern for multi-agent. Sub-agent delegation works, but no Manager type that takes
    a list of sub-agents + orchestration mode (sequential/parallel/voting) + merging strategy. The  
    orchestration package has primitives; it doesn't expose the high-level pattern.
-   Public benchmark presence. Frontier 100% on home-grown tasks gives zero external credibility. Even one  
    HAL (Princeton) harness run on τ-bench or BFCL would be a real differentiator — third-party-validated TS  
    framework numbers don't exist today.
-   Vision/multimodal. Intentionally deferred per VISION.md. Strategic, but worth noting that it's  
    increasingly table-stakes.
-   HITL checkpoint primitive. Gateway supports persistent agents but no built-in
    "pause-prompt-human-resume" pattern. LangGraph has it as interrupt(); OpenAI Agents SDK has it via  
    Sessions; Reactive Agents users must build it.
-   Cost-aware live budget alerts. CostService tracks; doesn't proactively alert or escalate-down strategy  
    when approaching limits.

5. The 5 highest-leverage actions (prioritized)  


#: 1  
 Action: Frozen separately-versioned judge in containerized RPC process
Why it matters: Unblocks empirical validation of every mechanism. Without this, mechanism trim-or-prove  
 discipline is impossible. Resolves the eval Rule 4 violation.  
 Effort: 1–2 sessions
When: Blocks v0.10.0 benchmark claims  
 ────────────────────────────────────────
#: 2  
 Action: Mechanism spike-or-trim sweep  
 Why it matters: 5/30+ packages have spike evidence. Either prove each mechanism or mark it _unstable_\*  
 with  
 a v0.11 sunset. The framework's biggest lever for lower complexity AND higher quality simultaneously.
Effort: 5–10 sessions over 2-3 months
When: Stage 7+
────────────────────────────────────────
#: 3  
 Action: CodeAgentStrategy — Python-sandboxed code-as-action
Why it matters: Step-function effect on hard local-model tasks (smolagents 44% vs 7% on GAIA). Closes the
largest current capability gap vs the field.  
 Effort: 2–3 sessions
When: Stage 7, parallel with decomposition
────────────────────────────────────────
#: 4  
 Action: Decompose orchestration trio (S1 from §16.2)
Why it matters: The framework's "thin orchestrator" violation. Until this lands, every new feature deepens

    the god-class. Blocks scalability of the framework itself.

Effort: 4–6 sessions, multi-wave
When: Stage 7 (W23, W26)
────────────────────────────────────────
#: 5  
 Action: Per-provider-version FC parsing + thinking-mode coexistence
Why it matters: Where local-model lift is hiding. The single highest-ROI fix for 7-14B agentic  
 performance.  
 Effort: 2–4 sessions
When: Stage 7, can run parallel

Notably NOT in the top 5:

-   Vision/multimodal — strategic deferral confirmed as correct given current scope.
-   Manager pattern — DX win but agent-as-tool covers most use cases.
-   Skills file-system-discovery — nice convergence with Anthropic standard but not framework-defining.
-   Automated prompt optimization (DSPy-style) — high impact but high effort; better as v0.12+ research  
    direction.  


6. Strategic positioning recommendation  


Stop framing the framework against LangChain/LangGraph SWE-bench numbers. The honest competitive frame is:

▎ Reactive Agents is the production-grade TypeScript framework for teams building agents that need to run
▎ on both frontier APIs and local 7-14B models, with research-grade observability and per-tier model  
 ▎ adaptation. We compete with Mastra and Vercel AI SDK on developer experience and reliability; we  
 ▎ differentiate on local-model engineering and empirical mechanism validation.

This frame is defensible, ships today, and aligns with the genuine moats (Effect-TS schema rigor,  
 capability-grouped kernel, AgentMemory port, single-owner termination, calibration-aware adaptation). It
also positions the next wave of work — code-as-action strategy, frozen judge, per-provider FC parsing — as
natural extensions of the differentiator, not catch-up to LangChain.

7. The hardest thing to internalize

The biggest engineering mistake is not technical — it's the gap between rich-mechanism investment and  
 spike-validated lift. The framework has built more mechanisms than most peers (RI dispatcher, healing
pipeline, three-stage compression, calibration, skills, verifier-retry, sub-agents, gateway). Each was  
 reasonable to add. But the cumulative effect is a 12,000-LOC orchestration layer where you can't tell  
 which mechanism is earning its keep.

Anthropic's anti-framework stance in their Agent SDK guidance — "look at failures, design tools carefully"
— is not framework rejection; it's a recognition that mechanism count is a lagging indicator of agent
quality, while empirical-loop-discipline is a leading one. The frameworks winning in 2026 (OpenAI Agents  
 SDK at 5 primitives, Mastra at 4, Pydantic AI at type-driven minimalism) ship less and validate more.

The Stage 7 Decomposition Wave is the structural correction. The mechanism spike-or-trim sweep is the  
 empirical correction. Both are needed; both are post-v0.10.0 work; both will make the framework smaller
AND better simultaneously. That's the test of whether v1.0 is credible.

---

Sources for everything above live in the four research-agent reports. Every non-obvious claim is cited
there with a primary URL. Happy to drill into any specific finding — the local-model FC parsing landscape,
the τ-bench/BFCL methodology, the manager-vs-sub-agent debate, the frozen-judge implementation patterns —
whichever direction you want to go next.

---
