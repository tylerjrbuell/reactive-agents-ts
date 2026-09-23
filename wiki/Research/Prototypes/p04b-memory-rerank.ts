// p04b-memory-rerank.ts
//
// ─── HYPOTHESIS ────────────────────────────────────────────────────────────────
//
// `packages/memory` has zero judgment coverage today (confirmed: no
// `@reactive-agents/judgment` import anywhere under packages/memory/src —
// grep run before writing this probe). Its recall path
// (`packages/memory/src/search.ts`) ranks candidates by vector-similarity /
// FTS5 score alone. A jev Choice/Score rerank over the SAME candidate set,
// direct-called against the real jev backend, should beat a pure lexical-
// similarity baseline on genuinely paraphrased or indirectly-worded queries
// (the classic vector-search failure mode: high lexical overlap != true
// relevance, and vice versa).
//
// NULL HYPOTHESIS: jev's rerank does not measurably outperform the baseline
// — no lift in top-1 hit rate, no improvement in mean rank of the correct
// candidate.
//
// METHOD: 18 labeled (query, 5 candidates, correct-candidate-id) cases,
// authored to represent the shape of real episodic/semantic memory content
// (short notes: past decisions, facts learned, task outcomes) — disclosed
// here as SYNTHETIC, not drawn from a live memory store (no populated
// memory DB was available within this probe's read-only authority bounds;
// packages/memory/src/** was read-only per the MissionBrief). Several cases
// are deliberately adversarial to lexical overlap: the correct candidate
// shares few/no keywords with the query (paraphrase), and a decoy candidate
// shares many keywords but is topically wrong.
//
// Baseline: TF cosine similarity (no IDF; case-local corpus = the 5
// candidates) between query and each candidate — the same family of signal
// (n-gram/term-overlap) a lexical/FTS5 layer would produce, and a reasonable,
// honestly-labeled proxy for "vector-similarity ranking" given a real
// embedding-model call was out of scope for this probe's budget. This
// limitation is called out explicitly in RESULTS-p04b.md — do not read the
// baseline as a true embedding-cosine baseline.
// jev: one batched `ask()` per case, one Score question per candidate
// (0/1/2 relevance rubric), ranked by score descending.
//
// Measures: top-1 hit rate (baseline vs jev), mean rank of the correct
// candidate (1-5, lower is better; baseline vs jev).
//
// PROMOTION CRITERIA (WORTH-IT): jev top-1 hit rate >= baseline + 15pp, AND
// jev mean-rank-of-correct <= baseline mean-rank-of-correct - 0.5.
//
// KILL CRITERIA (NOT-WORTH-IT): jev top-1 hit rate <= baseline, or mean rank
// not improved.
//
// PROVIDER: jev (TypeSafe) direct-call; TF-cosine baseline is local, no API.
// CASES: 18 synthetic (query, 5 candidates, correct-id) tuples.

import { makeJevBackend } from "@reactive-agents/judgment";
import type { QuestionSpecs, JudgmentEntry } from "@reactive-agents/judgment";
import { Effect } from "effect";
import fs from "node:fs";
import path from "node:path";

interface Case {
  readonly id: string;
  readonly query: string;
  readonly candidates: Record<string, string>; // candidateId -> text
  readonly correctId: string;
  readonly adversarial: boolean; // true = correct candidate has low lexical overlap w/ query, or a decoy has high overlap
}

const CASES: readonly Case[] = [
  {
    id: "c1",
    query: "What database does the checkout service use?",
    candidates: {
      a: "The checkout service persists orders to a Postgres 15 instance, connection pooled via pgbouncer.",
      b: "The recommendation engine caches results in Redis with a 5 minute TTL.",
      c: "Checkout latency spiked last Tuesday due to a slow N+1 query in the order-items join.",
      d: "The notification service sends emails via SendGrid after order confirmation.",
      e: "User sessions are stored in a Postgres table separate from the checkout order tables.",
    },
    correctId: "a",
    adversarial: false,
  },
  {
    id: "c2",
    query: "Why did we decide against using MongoDB for the orders table?",
    candidates: {
      a: "Decision 2026-03-14: rejected a document store for orders because our reporting queries need strong joins across orders, line-items, and inventory — relational fit was judged better than schema flexibility.",
      b: "MongoDB is used for the product catalog service, which has a highly variable schema per category.",
      c: "The orders table currently lives in Postgres with a foreign key to the customers table.",
      d: "We evaluated Cassandra for the events pipeline but chose Kafka + a flat file sink instead.",
      e: "Document databases are generally schemaless, which trades consistency guarantees for flexibility.",
    },
    correctId: "a",
    adversarial: true, // candidate a barely says "MongoDB"; c and e share more surface keywords but aren't the decision record
  },
  {
    id: "c3",
    query: "What's our policy on retrying failed webhook deliveries?",
    candidates: {
      a: "Webhook deliveries are retried with exponential backoff, max 5 attempts, then dead-lettered to a review queue.",
      b: "The billing service polls the payment provider every 30 seconds for status updates.",
      c: "Our incoming webhook signature verification uses HMAC-SHA256 against a per-tenant secret.",
      d: "API rate limits reset on a rolling 60-second window per API key.",
      e: "Outbound emails that bounce are retried once after 24 hours before being marked undeliverable.",
    },
    correctId: "a",
    adversarial: false,
  },
  {
    id: "c4",
    query: "Who approved skipping the security review for the auth refactor?",
    candidates: {
      a: "The auth refactor PR (#4021) was merged after a full security review by the platform team.",
      b: "Approval note 2026-02-02: security review waived for the auth refactor per CTO sign-off, given the tight compliance deadline and an independently scheduled post-hoc audit.",
      c: "Security reviews are normally required for any change touching the identity package.",
      d: "The CTO approved the Q1 infrastructure budget increase for the observability stack.",
      e: "Auth refactor added support for WebAuthn as a second factor.",
    },
    correctId: "b",
    adversarial: true, // a shares "security review" + "auth refactor" but is the OPPOSITE fact
  },
  {
    id: "c5",
    query: "What caused the outage on 2026-06-11?",
    candidates: {
      a: "Postmortem 2026-06-11: a misconfigured autoscaling policy scaled the API pool to zero during a deploy, causing a 14-minute full outage.",
      b: "The 2026-05-02 outage was caused by a expired TLS certificate on the internal load balancer.",
      c: "Autoscaling policies were tuned in April to react faster to traffic spikes.",
      d: "Deploys are gated behind a canary stage that runs for 10 minutes before full rollout.",
      e: "API pool capacity was increased by 20% ahead of the holiday traffic season.",
    },
    correctId: "a",
    adversarial: false,
  },
  {
    id: "c6",
    query: "Is PII ever logged in plaintext anywhere in the pipeline?",
    candidates: {
      a: "Log scrubbing middleware redacts email and phone number fields before any log line is written.",
      b: "Finding 2026-01-20: an unredacted debug log statement in the legacy import script wrote customer SSNs to disk for ~3 weeks before being caught and removed.",
      c: "All logs are shipped to a centralized log aggregator with 30-day retention.",
      d: "PII fields in the primary database are encrypted at rest using column-level encryption.",
      e: "The compliance team runs a quarterly PII-handling audit across all services.",
    },
    correctId: "b",
    adversarial: true, // a directly claims the opposite of the true finding
  },
  {
    id: "c7",
    query: "What's the current on-call rotation tool?",
    candidates: {
      a: "On-call is managed through PagerDuty, with a weekly rotation across the platform team.",
      b: "Incident postmortems are filed in the wiki under Research/Debriefs.",
      c: "The status page is hosted on a third-party service and updated manually during incidents.",
      d: "Escalation policy: page primary, then secondary after 5 minutes of no ack.",
      e: "Slack is used for real-time incident coordination in the #incidents channel.",
    },
    correctId: "a",
    adversarial: false,
  },
  {
    id: "c8",
    query: "Did we ever try running the batch job on a bigger instance to fix the timeout?",
    candidates: {
      a: "Experiment 2026-04-09: moved the nightly batch job from a 4-core to a 16-core instance — timeout persisted, ruling out CPU as the bottleneck; root cause was later found to be a full table scan.",
      b: "The nightly batch job processes roughly 2 million rows and currently times out after 30 minutes.",
      c: "Instance sizing for the API tier was increased last quarter for cost efficiency reasons.",
      d: "A new index was added to the batch job's source table, resolving the timeout.",
      e: "Batch jobs run on a dedicated node pool separate from the request-serving pool.",
    },
    correctId: "a",
    adversarial: false,
  },
  {
    id: "c9",
    query: "What's blocking the migration off the legacy billing system?",
    candidates: {
      a: "The legacy billing system handles proration for mid-cycle plan changes in a way the new system doesn't yet replicate — this is the one open blocker per the migration tracker.",
      b: "The new billing system was built on Stripe's subscriptions API.",
      c: "Legacy billing runs on a decommissioned framework version with no active maintainer.",
      d: "Migration of the legacy notification system was completed in Q3.",
      e: "Billing invoices are generated monthly and emailed via the notification service.",
    },
    correctId: "a",
    adversarial: false,
  },
  {
    id: "c10",
    query: "Has anyone benchmarked FTS5 vs a vector index for our recall use case?",
    candidates: {
      a: "Benchmark 2026-07-02: FTS5 keyword search returned higher precision on exact-term queries; sqlite-vec KNN won on paraphrased/semantic queries — recall path now unions both and re-ranks.",
      b: "sqlite-vec was added as a dependency in the memory package for KNN search.",
      c: "FTS5 requires a virtual table and trigger-based sync with the source table.",
      d: "The working-memory layer uses an in-process cache, not a persistent index.",
      e: "Vector embeddings for episodic entries are computed lazily on first recall, not on write.",
    },
    correctId: "a",
    adversarial: false,
  },
  {
    id: "c11",
    query: "Why does the reasoning kernel cap consecutive thoughts at 3?",
    candidates: {
      a: "maxConsecutiveThoughts: 3 in the loop-detector config — chosen empirically to catch stalls without false-positiving on legitimately reflective multi-step reasoning; only actions reset the counter.",
      b: "The kernel's comprehend phase classifies task complexity before the first thought.",
      c: "Thoughts and actions are both recorded in `state.steps[]` for observability.",
      d: "The reactive strategy is the simplest of the 8 registered strategies.",
      e: "Loop detection also checks for repeated identical tool calls, not just thought count.",
    },
    correctId: "a",
    adversarial: false,
  },
  {
    id: "c12",
    query: "What happened when we tried the adaptive strategy on a trivial task?",
    candidates: {
      a: "The adaptive router defaults to reactive on the local tier to avoid classification overhead for cheap models.",
      b: "Observation 2026-05-11: adaptive was dispatched on 'what's 2+2' and it selected tree-of-thought, adding ~4s of unnecessary planning overhead before answering — flagged as a possible over-escalation bug.",
      c: "Tree-of-thought is intended for exploring and comparing multiple alternative approaches.",
      d: "The reactive strategy handles direct tool use for short, simple tasks.",
      e: "Strategy selection can be overridden explicitly via `.withReasoning({defaultStrategy})`.",
    },
    correctId: "b",
    adversarial: true, // b doesn't literally say "trivial" or "adaptive strategy" up front but is the actual incident
  },
  {
    id: "c13",
    query: "What's our stance on storing API keys in .env files?",
    candidates: {
      a: ".env holds local development secrets only; production secrets are pulled from the secrets manager at deploy time and never committed.",
      b: "The pre-commit hook greps staged diffs for common API-key prefixes as a secrets backstop.",
      c: ".env.example is committed with placeholder values so new contributors know what to configure.",
      d: "Rotating a leaked API key requires updating both the secrets manager and any cached config in running pods.",
      e: "CI has no access to developer .env files, only to CI-scoped secrets.",
    },
    correctId: "a",
    adversarial: false,
  },
  {
    id: "c14",
    query: "Did the token-budget change actually reduce cost, or just latency?",
    candidates: {
      a: "Move 1 (token tax): reduced +109% overhead to +36% — this was a TOKEN cost reduction, not a latency change; latency was not the target metric of that change.",
      b: "The complexity router picks a cheaper model tier for simple tasks, reducing per-call cost.",
      c: "Semantic cache hits skip the LLM call entirely, cutting both cost and latency together.",
      d: "Budget enforcer rejects a run outright once the configured dollar ceiling is hit.",
      e: "Token counting uses the provider's own tokenizer where available, falling back to an estimate.",
    },
    correctId: "a",
    adversarial: true, // c mentions both cost AND latency, tempting but not what was asked about
  },
  {
    id: "c15",
    query: "What's the retry behavior for a rate-limited LLM call?",
    candidates: {
      a: "Rate-limited provider responses trigger the SDK's built-in exponential-backoff retry, honoring any `retryAfterMs` the provider returns.",
      b: "Judgment backend failures degrade to the existing heuristic path rather than failing the run.",
      c: "Streaming responses are buffered per-chunk before being forwarded to the kernel's attend phase.",
      d: "Tool call timeouts are configurable per tool via `maxCallsPerTool`.",
      e: "The provider adapter layer normalizes 8 different providers' streaming formats into one shape.",
    },
    correctId: "a",
    adversarial: false,
  },
  {
    id: "c16",
    query: "Was the gateway chat history windowing ever tested with very long conversations?",
    candidates: {
      a: "Gateway chat mode windows history to 40 turns / 8k chars with daily compaction of older turns.",
      b: "Stress test 2026-06-30: a 500-turn synthetic conversation was replayed through the gateway; windowing correctly truncated to the most recent 40 turns each time, with no memory growth observed over the run.",
      c: "SessionStoreService persists chat history in SQLite keyed by sender.",
      d: "Episodic context injection was fixed to no longer require `enableSelfImprovement`.",
      e: "Chat-turn events are a new entry type added to `DailyLogEntry`.",
    },
    correctId: "b",
    adversarial: true, // a is the general policy; b is the specific test that answers "was it tested"
  },
  {
    id: "c17",
    query: "What tool is gated behind an explicit opt-in flag?",
    candidates: {
      a: "shell-execute is gated via `.withTools({ terminal: true })`, not auto-registered with the other capability tools.",
      b: "web-search, crypto-price, and http-get are part of the 9 built-in capability tools.",
      c: "discover-tools is a meta-tool for listing available tools at runtime.",
      d: "The sandbox executes code-execute calls in an isolated environment by default.",
      e: "MCP tools are registered dynamically based on the configured server list.",
    },
    correctId: "a",
    adversarial: false,
  },
  {
    id: "c18",
    query: "Do we have evidence that jev is faster than the LLM-judge path?",
    candidates: {
      a: "Methodology gate 2026-09-23: jev averaged 1136ms per case vs 2663ms for the llm-engine judge on the same 16-case set — 2.3x faster, consistent with the POC's earlier 2.8x finding.",
      b: "The eval package supports two judge engines: 'llm' (parseFloat-scored) and 'jev' (typed Score request).",
      c: "jev scored 100% classification accuracy on the 16-case set vs 87.5% for the llm engine.",
      d: "TypeSafe pricing is $0.042/MTok in with free output tokens, per the POC's unit economics.",
      e: "The llm-engine dimension scorers call the judge at temperature 0.0 for near-determinism.",
    },
    correctId: "a",
    adversarial: true, // c is also true and about jev but answers "accuracy", not "speed" — the query specifically asks about speed
  },
];

// ─── TF-cosine baseline (case-local corpus, no IDF — see header disclosure) ───

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function termFreq(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  for (const [k, v] of a) dot += v * (b.get(k) ?? 0);
  const normA = Math.sqrt([...a.values()].reduce((s, v) => s + v * v, 0));
  const normB = Math.sqrt([...b.values()].reduce((s, v) => s + v * v, 0));
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}

function baselineRank(c: Case): readonly string[] {
  const qVec = termFreq(tokenize(c.query));
  const scored = Object.entries(c.candidates).map(([id, text]) => ({
    id,
    score: cosine(qVec, termFreq(tokenize(text))),
  }));
  scored.sort((x, y) => y.score - x.score);
  return scored.map((s) => s.id);
}

// ─── jev rerank: one Score question per candidate, batched ───

function jevQuestions(c: Case): QuestionSpecs {
  const out: Record<string, { type: "score"; instructions: string; criteria: readonly [string, string, string] }> = {};
  for (const [id, text] of Object.entries(c.candidates)) {
    out[`candidate::${id}`] = {
      type: "score",
      instructions: `Rate how relevant this memory note is for answering the query: "${c.query}". Note text: "${text}"`,
      criteria: [
        "Not relevant — irrelevant or unrelated to the query.",
        "Somewhat relevant — related topic but doesn't directly answer the query.",
        "Highly relevant — directly answers or is the most on-point evidence for the query.",
      ],
    };
  }
  return out;
}

function jevState(c: Case): JudgmentEntry {
  return { query: c.query };
}

async function jevRank(backend: ReturnType<typeof makeJevBackend>, c: Case): Promise<readonly string[]> {
  const answers = await Effect.runPromise(backend.evaluate({ state: jevState(c), questions: jevQuestions(c) }));
  const scored = Object.entries(c.candidates).map(([id]) => {
    const a = answers[`candidate::${id}`];
    return { id, score: a && a.kind === "score" ? a.value : -1 };
  });
  scored.sort((x, y) => y.score - x.score);
  return scored.map((s) => s.id);
}

interface CaseOutcome {
  readonly id: string;
  readonly adversarial: boolean;
  readonly correctId: string;
  readonly baselineRank: readonly string[];
  readonly jevRank: readonly string[];
  readonly baselineRankOfCorrect: number; // 1-indexed
  readonly jevRankOfCorrect: number;
}

async function main() {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    console.error("TYPESAFE_API_KEY not set — aborting.");
    process.exit(1);
  }
  const backend = makeJevBackend({ apiKey });
  const outcomes: CaseOutcome[] = [];

  for (const c of CASES) {
    const bRank = baselineRank(c);
    const jRank = await jevRank(backend, c);
    const bIdx = bRank.indexOf(c.correctId) + 1;
    const jIdx = jRank.indexOf(c.correctId) + 1;
    outcomes.push({
      id: c.id,
      adversarial: c.adversarial,
      correctId: c.correctId,
      baselineRank: bRank,
      jevRank: jRank,
      baselineRankOfCorrect: bIdx,
      jevRankOfCorrect: jIdx,
    });
    console.log(`${c.id} [${c.adversarial ? "ADV" : "plain"}] correct=${c.correctId} baseline_rank=${bIdx} jev_rank=${jIdx}`);
  }

  const outPath = path.join(import.meta.dirname, "spike-results", "p04b-memory-rerank.json");
  fs.writeFileSync(outPath, JSON.stringify(outcomes, null, 2));
  console.log(`\nWrote ${outPath}`);

  const n = outcomes.length;
  const baselineTop1 = outcomes.filter((o) => o.baselineRankOfCorrect === 1).length;
  const jevTop1 = outcomes.filter((o) => o.jevRankOfCorrect === 1).length;
  const baselineMeanRank = outcomes.reduce((s, o) => s + o.baselineRankOfCorrect, 0) / n;
  const jevMeanRank = outcomes.reduce((s, o) => s + o.jevRankOfCorrect, 0) / n;

  const adv = outcomes.filter((o) => o.adversarial);
  const advBaselineTop1 = adv.filter((o) => o.baselineRankOfCorrect === 1).length;
  const advJevTop1 = adv.filter((o) => o.jevRankOfCorrect === 1).length;

  console.log(`\nSUMMARY (n=${n}):`);
  console.log(`  top-1 hit rate: baseline=${baselineTop1}/${n} (${((baselineTop1 / n) * 100).toFixed(1)}%)  jev=${jevTop1}/${n} (${((jevTop1 / n) * 100).toFixed(1)}%)`);
  console.log(`  mean rank of correct: baseline=${baselineMeanRank.toFixed(2)}  jev=${jevMeanRank.toFixed(2)}`);
  console.log(`  adversarial subset (n=${adv.length}): baseline top-1=${advBaselineTop1}/${adv.length}  jev top-1=${advJevTop1}/${adv.length}`);
}

main();
