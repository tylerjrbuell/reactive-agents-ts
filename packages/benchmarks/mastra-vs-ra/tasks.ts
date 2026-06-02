// Shared task corpus for Mastra vs Reactive Agents head-to-head benchmark.
//
// Each task has:
//   - id: stable identifier
//   - category: rough complexity bucket
//   - prompt: literal user input
//   - tools: tool surface available (both frameworks will receive the same shape)
//   - verifier: deterministic check + optional LLM-as-judge fallback rubric
//   - maxIterations: budget (both frameworks honor this)
//   - tags: for analysis grouping
//
// Rules:
//   - No framework-specific scaffolding in prompts (no "use ReactiveAgents", no "use Mastra").
//   - Tools must be defined per-framework but with IDENTICAL behavior + names + descriptions.
//   - Verifier should be permissive enough that BOTH frameworks pass when the LLM answers correctly.

export type ToolSpec =
  | { kind: "none" }
  | { kind: "web-search-success"; returnsCount: number; sampleSnippet: string }
  | { kind: "web-search-error"; errorMessage: string }
  | { kind: "calculator"; }
  | { kind: "key-value-store"; preloaded?: Record<string, string> };

export interface Task {
  readonly id: string;
  readonly category: "knowledge" | "tool-required" | "multi-step" | "long-form" | "failure-recovery" | "critique";
  readonly prompt: string;
  readonly tools: readonly ToolSpec[];
  readonly maxIterations: number;
  readonly verifier: TaskVerifier;
  readonly tags: readonly string[];
}

export type TaskVerifier =
  /** Pass when stripped lowercase output contains any of the substrings. */
  | { kind: "contains-any"; substrings: readonly string[] }
  /** Pass when output contains ALL of the substrings. */
  | { kind: "contains-all"; substrings: readonly string[] }
  /** Pass when output matches regex. */
  | { kind: "regex"; pattern: string; flags?: string }
  /** Pass when output length >= min AND contains all substrings. Useful for long-form tasks. */
  | { kind: "long-form"; minLength: number; mustContain: readonly string[] }
  /** LLM-as-judge — pass when judge model returns "yes" to the rubric. */
  | { kind: "llm-judge"; rubric: string };

export const TASKS: readonly Task[] = [
  // ── Knowledge recall (no tools needed) ────────────────────────────────────
  {
    id: "k1-france-capital",
    category: "knowledge",
    prompt: "What is the capital city of France? Give just the city name.",
    tools: [{ kind: "none" }],
    maxIterations: 3,
    verifier: { kind: "contains-any", substrings: ["paris"] },
    tags: ["pure-knowledge", "single-fact", "short-output"],
  },
  {
    id: "k2-typescript-paradigm",
    category: "knowledge",
    prompt: "What programming paradigm does TypeScript primarily support? List two features that reflect this.",
    tools: [{ kind: "none" }],
    maxIterations: 4,
    verifier: {
      kind: "long-form",
      minLength: 80,
      mustContain: ["object", "type"],
    },
    tags: ["technical-knowledge", "multi-fact", "medium-output"],
  },
  {
    id: "k3-rgb-colors",
    category: "knowledge",
    prompt: "What are the three primary colors of light (RGB)? List them.",
    tools: [{ kind: "none" }],
    maxIterations: 3,
    verifier: { kind: "contains-all", substrings: ["red", "green", "blue"] },
    tags: ["pure-knowledge", "list-output"],
  },

  // ── Tool-required ─────────────────────────────────────────────────────────
  {
    id: "t1-calculator-add",
    category: "tool-required",
    prompt:
      "Use the bench_calculator tool to compute 17 multiplied by 23. The tool takes an 'expression' string. Return only the final number.",
    tools: [{ kind: "calculator" }],
    maxIterations: 4,
    verifier: { kind: "contains-any", substrings: ["391"] },
    tags: ["single-tool", "deterministic-result"],
  },
  {
    id: "t2-web-search-cite",
    category: "tool-required",
    prompt:
      "Use the bench_web_search tool to look up 'Rust async runtime tokio'. After receiving results, cite ONE URL from the results in your final answer.",
    tools: [
      {
        kind: "web-search-success",
        returnsCount: 3,
        sampleSnippet: "Tokio is an asynchronous runtime for the Rust programming language. https://tokio.rs",
      },
    ],
    maxIterations: 5,
    verifier: { kind: "contains-any", substrings: ["https://", "http://", "tokio.rs"] },
    tags: ["single-tool", "cite-source"],
  },
  {
    id: "t3-kv-fetch",
    category: "tool-required",
    prompt:
      "Use the bench_lookup tool to fetch the value for key 'api-endpoint'. Return only the value.",
    tools: [
      {
        kind: "key-value-store",
        preloaded: {
          "api-endpoint": "https://api.example.com/v2",
          "api-version": "2.4.1",
        },
      },
    ],
    maxIterations: 4,
    verifier: { kind: "contains-any", substrings: ["https://api.example.com/v2"] },
    tags: ["single-tool", "exact-extract"],
  },

  // ── Multi-step ────────────────────────────────────────────────────────────
  {
    id: "m1-database-indexes",
    category: "multi-step",
    prompt:
      "Explain the trade-offs between B-tree, hash, and full-text database indexing strategies. " +
      "Cover when to use each in three distinct sections.",
    tools: [{ kind: "none" }],
    maxIterations: 6,
    verifier: {
      kind: "long-form",
      minLength: 400,
      mustContain: ["b-tree", "hash", "full-text"],
    },
    tags: ["multi-section", "comparative", "long-output"],
  },
  {
    id: "m2-version-then-cite",
    category: "multi-step",
    prompt:
      "Use the bench_lookup tool to get the value for key 'api-version'. Then explain why semantic versioning matters in one sentence. Final answer should include both the version number AND the explanation.",
    tools: [
      {
        kind: "key-value-store",
        preloaded: { "api-version": "2.4.1" },
      },
    ],
    maxIterations: 5,
    verifier: {
      kind: "long-form",
      minLength: 60,
      mustContain: ["2.4.1", "version"],
    },
    tags: ["tool-then-reason", "two-step"],
  },

  // ── Critique / refinement ─────────────────────────────────────────────────
  {
    id: "c1-eventual-vs-strong",
    category: "critique",
    prompt:
      "What are the main trade-offs between eventual consistency and strong consistency in distributed systems? " +
      "After your first answer, critique it, then provide an improved final answer.",
    tools: [{ kind: "none" }],
    maxIterations: 8,
    verifier: {
      kind: "long-form",
      minLength: 300,
      mustContain: ["consist", "trade"],
    },
    tags: ["self-critique", "long-output", "no-tools"],
  },

  // ── Failure-recovery ──────────────────────────────────────────────────────
  {
    id: "f1-web-search-error",
    category: "failure-recovery",
    prompt:
      "Use the bench_web_search tool to find the current Bitcoin price. If you receive an error after 2 attempts, stop trying the tool and state that you cannot fetch the live price.",
    tools: [{ kind: "web-search-error", errorMessage: "Rate limit exceeded — please retry in 60s" }],
    maxIterations: 6,
    verifier: {
      kind: "contains-any",
      substrings: ["cannot", "unable", "failed", "could not", "couldn't"],
    },
    tags: ["tool-fails-always", "honest-failure"],
  },
  {
    id: "f2-no-tool-knowledge-recovery",
    category: "failure-recovery",
    prompt:
      "List the seven days of the week in order, starting with Monday. Do not use any tools — answer from knowledge.",
    tools: [{ kind: "none" }],
    maxIterations: 2,
    verifier: {
      kind: "contains-all",
      substrings: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
    },
    tags: ["pure-knowledge", "no-tools-required", "explicit-no-tool"],
  },
];

export function getTaskById(id: string): Task | undefined {
  return TASKS.find((t) => t.id === id);
}
