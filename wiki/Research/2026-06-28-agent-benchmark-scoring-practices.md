# Agent Benchmark Scoring — Best Practices (research 2026-06-28)

**Question:** Is LLM-as-judge reliable enough to score a public agent benchmark, or is there a better deterministic way?

**Verdict:** Deterministic (execution / end-state / tool-trace) verification is the gold standard and what every trusted *agent* benchmark uses. LLM-judge is a documented-unreliable supplement, not a headline metric.

## Evidence

**Leading agent benchmarks score deterministically:**
- **SWE-bench Verified** — apply patch → run the repo's test suite (execution).
- **τ-bench** (Sierra) — **final database-state comparison**; "unambiguous success criteria, eliminates subjectivity."
- **WebArena** — programmatic end-state checks.
- **Terminal-Bench** — CLI task execution checks.
- **BFCL** — AST-match of tool calls.
- **WildClawBench** — deterministic state + execution + **error-injection to expose agents that "finish without actually completing"** + semantic judgment only over *auditable evidence* (file diffs, command traces).

**LLM-as-judge is unreliable for scoring:**
- 12 systematic bias types (position, verbosity, self-preference/self-enhancement, bandwagon, authority, sentiment, CoT…).
- Run-to-run inconsistency; "Reliability without Validity" (large-scale study); circular preference chains (A>B>C>A).
- Exact-match judge-validation overstates discriminative ability (no chance correction).
- Consensus: use judge **only** for open-ended nuance, reported **separately**, ideally over auditable artifacts — never the trust number.

**Best practice = layered:** rule-based/execution hard checks first → LLM judge as a clearly-separated supplement → human calibration.

## Decision for this repo

Public docs bench = **deterministic-only headline** (v1). No judge in the trust number. This also removes judge cost + the "moving/unreliable judge" concern and makes the run fully reproducible.

**Oracle types to use** (all already supported or cheap to add):
- `verifiable` — run a check command in the agent's working dir (end-state / execution). FIX: run via shell so `&&` works.
- `trace` (new) — assert over the recorded tool-call trace (`tool-call-start/end` events): "called tool X", "recovered after N failures", "did NOT rewrite working code". τ-bench/WildClawBench pattern.
- `schema` — structural JSON validity (exists; shape-check is a TODO).

**Tasks:** keep/convert to deterministic — rw-4, rw-7, rw-8 (fixed), rw-bp1, rw-9 (→ end-state). Drop from headline (genuine judgment) — rw-1, rw-3, rw-5, rw-6, rw-10. Author new deterministic agentic tasks for a difficulty gradient.

## Sources
- Confident AI — LLM Agent Evaluation Metrics (tool calling, trace-based): https://www.confident-ai.com/blog/llm-agent-evaluation-complete-guide
- Evidently AI — LLM-as-a-judge guide: https://www.evidentlyai.com/llm-guide/llm-as-a-judge
- "Reliability without Validity: …LLM-as-a-Judge Across Agreement, Consistency, and Bias": https://arxiv.org/html/2606.19544
- "Justice or Prejudice? Quantifying Biases in LLM-as-a-Judge": https://openreview.net/forum?id=3GTtZFiajM
- τ-bench (Sierra): https://sierra.ai/blog/benchmarking-ai-agents
- SWE-bench Verified: https://www.swebench.com/verified.html
- WildClawBench (long-horizon, error-injection): https://arxiv.org/html/2605.10912v1
- Evaluation and Benchmarking of LLM Agents: A Survey: https://arxiv.org/html/2507.21504v1
