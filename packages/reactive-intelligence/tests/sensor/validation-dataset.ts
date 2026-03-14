/**
 * Validation dataset for EntropySensorService.score() accuracy testing.
 *
 * 65 labeled examples across three categories:
 * - high-signal:  Well-structured reasoning with tool progress → composite < 0.60
 * - low-signal:   Malformed, repetitive, drifting, or stalled → composite > 0.65
 * - ambiguous:    Short but correct, exploratory, jargon-heavy → composite 0.35–0.85
 *
 * Scoring in test mode (no logprobs, no embeddings):
 *   structural weight ≈ 0.525, behavioral weight ≈ 0.375, context = 0.10
 *   Behavioral entropy is the primary discriminator between high/low signal.
 */

// ─── Types ───

export type ValidationCategory = "high-signal" | "low-signal" | "ambiguous";

export interface ValidationExample {
  category: ValidationCategory;
  label: string;
  input: ReturnType<typeof makeInput>;
}

// ─── Helper ───

type StepLike = {
  type: string;
  content?: string;
  metadata?: Record<string, unknown>;
};

function makeInput(
  thought: string,
  opts?: {
    taskDescription?: string;
    strategy?: string;
    iteration?: number;
    maxIterations?: number;
    steps?: StepLike[];
  },
) {
  return {
    thought,
    taskDescription: opts?.taskDescription ?? "Complete the assigned task",
    strategy: opts?.strategy ?? "reactive",
    iteration: opts?.iteration ?? 3,
    maxIterations: opts?.maxIterations ?? 10,
    modelId: "cogito:14b",
    temperature: 0.3,
    kernelState: {
      taskId: `val-${Math.random().toString(36).slice(2, 8)}`,
      strategy: opts?.strategy ?? "reactive",
      kernelType: "react",
      steps: opts?.steps ?? [],
      toolsUsed: new Set<string>(),
      scratchpad: new Map<string, string>(),
      iteration: opts?.iteration ?? 3,
      tokens: 0,
      cost: 0,
      status: "thinking",
      output: null,
      error: null,
      meta: {},
    },
  };
}

// ─── Reusable step arrays ───

/** Diverse successful tools with completion markers */
const progressSteps: StepLike[] = [
  { type: "thought", content: "Let me search for the answer" },
  { type: "action", content: "web-search", metadata: { success: true, toolUsed: "web-search" } },
  { type: "observation", content: "Search returned results", metadata: { success: true } },
  { type: "thought", content: "Now I need to verify this. The answer is clear." },
  { type: "action", content: "file-read", metadata: { success: true, toolUsed: "file-read" } },
  { type: "observation", content: "File confirms the data", metadata: { success: true } },
  { type: "thought", content: "In conclusion, I have the final answer." },
  { type: "action", content: "final-answer", metadata: { success: true, toolUsed: "final-answer" } },
];

/** Two diverse successful tools with completion markers */
const twoToolSteps: StepLike[] = [
  { type: "thought", content: "Let me search first" },
  { type: "action", content: "web-search", metadata: { success: true, toolUsed: "web-search" } },
  { type: "observation", content: "Got results", metadata: { success: true } },
  { type: "thought", content: "To summarize, the file reader confirms the answer." },
  { type: "action", content: "file-read", metadata: { success: true, toolUsed: "file-read" } },
  { type: "observation", content: "Confirmed", metadata: { success: true } },
  { type: "action", content: "final-answer", metadata: { success: true, toolUsed: "final-answer" } },
];

/** Final answer tool directly */
const finalAnswerSteps: StepLike[] = [
  { type: "action", content: "web-search", metadata: { success: true, toolUsed: "web-search" } },
  { type: "observation", content: "Found it", metadata: { success: true } },
  { type: "action", content: "final-answer", metadata: { success: true, toolUsed: "final-answer" } },
];

/** Repeated failed tool calls (loop) */
const loopSteps: StepLike[] = [
  { type: "action", content: "web-search query=test", metadata: { success: false, toolUsed: "web-search" } },
  { type: "action", content: "web-search query=test", metadata: { success: false, toolUsed: "web-search" } },
  { type: "action", content: "web-search query=test", metadata: { success: false, toolUsed: "web-search" } },
];

/** All failures, same tool repeated — triggers loop detection */
const failSteps: StepLike[] = [
  { type: "action", content: "web-search query=foo", metadata: { success: false, toolUsed: "web-search" } },
  { type: "observation", content: "error", metadata: { success: false } },
  { type: "action", content: "web-search query=foo", metadata: { success: false, toolUsed: "web-search" } },
  { type: "observation", content: "error again", metadata: { success: false } },
  { type: "action", content: "web-search query=foo", metadata: { success: false, toolUsed: "web-search" } },
  { type: "observation", content: "error again", metadata: { success: false } },
];

/** Single successful tool, some progress but not complete */
const partialSteps: StepLike[] = [
  { type: "thought", content: "I should investigate" },
  { type: "action", content: "web-search", metadata: { success: true, toolUsed: "web-search" } },
  { type: "observation", content: "Some results", metadata: { success: true } },
];

// ─── Dataset ───

export const VALIDATION_DATASET: ValidationExample[] = [
  // ════════════════════════════════════════════════════════════
  // HIGH-SIGNAL (22 examples): Good reasoning, tool progress
  // Composite should be < 0.60
  // ════════════════════════════════════════════════════════════

  {
    category: "high-signal",
    label: "reactive search with progress",
    input: makeInput(
      'Thought: I need to search for the capital of France. Action: web-search({"query": "capital of France"})',
      { steps: progressSteps },
    ),
  },
  {
    category: "high-signal",
    label: "final answer delivery",
    input: makeInput(
      'Thought: Based on the search results, the capital of France is Paris. This is well-established. Action: final-answer({"answer": "Paris"})',
      { steps: finalAnswerSteps },
    ),
  },
  {
    category: "high-signal",
    label: "weather API call with context",
    input: makeInput(
      'Thought: Let me check the weather API for today\'s forecast. Action: weather-api({"location": "NYC"})',
      { taskDescription: "Get the NYC weather forecast", steps: twoToolSteps },
    ),
  },
  {
    category: "high-signal",
    label: "test verification step",
    input: makeInput(
      'Thought: The file contents show the configuration is correct. I should verify the test passes. Action: run-tests({"file": "config.test.ts"})',
      { steps: progressSteps },
    ),
  },
  {
    category: "high-signal",
    label: "code analysis with file read",
    input: makeInput(
      'Thought: I found the bug in the parsing logic. The regex is missing the global flag. Action: file-write({"path": "parser.ts", "content": "fixed regex"})',
      { taskDescription: "Fix the parser bug", steps: twoToolSteps },
    ),
  },
  {
    category: "high-signal",
    label: "database query execution",
    input: makeInput(
      'Thought: I need to query the users table to find the admin account. Action: db-query({"sql": "SELECT * FROM users WHERE role = \'admin\'"})',
      { steps: progressSteps },
    ),
  },
  {
    category: "high-signal",
    label: "API integration with validation",
    input: makeInput(
      'Thought: The API returned a 200 status with valid JSON. I can now extract the user\'s email. Action: extract-field({"data": "response", "field": "email"})',
      { steps: twoToolSteps },
    ),
  },
  {
    category: "high-signal",
    label: "multi-step research conclusion",
    input: makeInput(
      'Thought: After reviewing three sources, all confirm that TypeScript 5.0 introduced decorators. In conclusion, the answer is clear. Action: final-answer({"answer": "TypeScript 5.0"})',
      { steps: progressSteps },
    ),
  },
  {
    category: "high-signal",
    label: "plan-execute step with number",
    input: makeInput(
      "Step 1: Gather requirements from the user. Step 2: Design the schema. I have completed Step 1 and the requirements are clear.",
      { strategy: "plan-execute", steps: twoToolSteps },
    ),
  },
  {
    category: "high-signal",
    label: "tool result analysis",
    input: makeInput(
      'Thought: The web search returned 5 relevant results. The top result from MDN confirms the Array.prototype.flat() method. Action: final-answer({"answer": "Array.prototype.flat()"})',
      { steps: finalAnswerSteps },
    ),
  },
  {
    category: "high-signal",
    label: "file modification with purpose",
    input: makeInput(
      'Thought: The config file needs the database URL updated. Action: file-write({"path": ".env", "content": "DATABASE_URL=postgres://..."})',
      { taskDescription: "Update database configuration", steps: twoToolSteps },
    ),
  },
  {
    category: "high-signal",
    label: "systematic debugging",
    input: makeInput(
      'Thought: The error trace shows a null pointer at line 42. I need to add a null check before accessing the property. Action: file-write({"path": "handler.ts", "content": "if (obj) { ... }"})',
      { taskDescription: "Fix null pointer error", steps: progressSteps },
    ),
  },
  {
    category: "high-signal",
    label: "search and summarize",
    input: makeInput(
      'Thought: I found three key findings from the search. To summarize: (1) Effect-TS uses algebraic effects, (2) it provides type-safe dependency injection, (3) it handles errors as values. Action: final-answer({"summary": "Effect-TS key features"})',
      { steps: progressSteps },
    ),
  },
  {
    category: "high-signal",
    label: "data transformation step",
    input: makeInput(
      'Thought: The CSV data has been parsed. I need to transform the date column to ISO format. Action: transform-data({"column": "date", "format": "ISO8601"})',
      { steps: twoToolSteps },
    ),
  },
  {
    category: "high-signal",
    label: "verification before final answer",
    input: makeInput(
      'Thought: I\'ve verified the calculation: 15 * 7 = 105. The answer is confirmed by two independent methods. Therefore the answer is 105. Action: final-answer({"result": 105})',
      { steps: finalAnswerSteps },
    ),
  },
  {
    category: "high-signal",
    label: "security audit finding",
    input: makeInput(
      'Thought: The dependency audit found 2 high-severity vulnerabilities in lodash@4.17.20. Action: report-finding({"severity": "high", "package": "lodash", "version": "4.17.20"})',
      { taskDescription: "Audit npm dependencies", steps: twoToolSteps },
    ),
  },
  {
    category: "high-signal",
    label: "test results analysis",
    input: makeInput(
      'Thought: All 42 tests passed. The coverage report shows 95% line coverage. In conclusion, the implementation is complete. Action: final-answer({"tests": 42, "coverage": "95%"})',
      { steps: progressSteps },
    ),
  },
  {
    category: "high-signal",
    label: "git operation",
    input: makeInput(
      'Thought: The changes look correct. I should create a commit with the bug fix. Action: git-commit({"message": "fix: resolve null pointer in handler"})',
      { taskDescription: "Commit the fix", steps: twoToolSteps },
    ),
  },
  {
    category: "high-signal",
    label: "deployment check",
    input: makeInput(
      'Thought: The health check returns 200 OK and all services are running. The deployment was successful. Action: final-answer({"status": "deployed", "health": "ok"})',
      { taskDescription: "Verify deployment", steps: finalAnswerSteps },
    ),
  },
  {
    category: "high-signal",
    label: "configuration validation",
    input: makeInput(
      'Thought: The configuration schema validates against all required fields. The only warning is about deprecated field "legacy_mode". Action: validate-config({"warnings": 1, "errors": 0})',
      { steps: twoToolSteps },
    ),
  },
  {
    category: "high-signal",
    label: "research with multiple sources",
    input: makeInput(
      'Thought: Cross-referencing Wikipedia and the official docs: React 18 introduced concurrent features in March 2022. Action: final-answer({"release": "March 2022", "version": "18.0"})',
      { steps: progressSteps },
    ),
  },
  {
    category: "high-signal",
    label: "error recovery success",
    input: makeInput(
      'Thought: The first attempt failed due to rate limiting. After waiting and retrying, the API call succeeded. The data shows 1,234 active users. Action: final-answer({"activeUsers": 1234})',
      { steps: progressSteps },
    ),
  },

  // ════════════════════════════════════════════════════════════
  // LOW-SIGNAL (23 examples): Malformed, repetitive, stalled
  // Composite should be > 0.65
  // ════════════════════════════════════════════════════════════

  {
    category: "low-signal",
    label: "pure hedging with no action",
    input: makeInput(
      "I think maybe possibly the answer could be something but I'm not entirely sure, perhaps it might be...",
      { steps: loopSteps },
    ),
  },
  {
    category: "low-signal",
    label: "verbatim repetition",
    input: makeInput(
      "search search search search search search search search",
      { steps: loopSteps },
    ),
  },
  {
    category: "low-signal",
    label: "wrong order + malformed JSON",
    input: makeInput(
      'Action: web-search({"query": "test")\nThought: I should search',
      { steps: failSteps },
    ),
  },
  {
    category: "low-signal",
    label: "complete topic drift",
    input: makeInput(
      "Let me think about quantum physics and the nature of consciousness and how the universe began with the big bang",
      { taskDescription: "Edit the config file", steps: loopSteps },
    ),
  },
  {
    category: "low-signal",
    label: "empty thought",
    input: makeInput("", { steps: loopSteps }),
  },
  {
    category: "low-signal",
    label: "single word repeated",
    input: makeInput("help help help help help help help help help help", { steps: failSteps }),
  },
  {
    category: "low-signal",
    label: "circular reasoning",
    input: makeInput(
      "I need to find the answer. To find the answer I need to search. To search I need to find what to search for. I need to find the answer.",
      { steps: loopSteps },
    ),
  },
  {
    category: "low-signal",
    label: "apologetic stalling",
    input: makeInput(
      "I apologize for the confusion. Let me try again. I'm sorry but I'm having trouble with this. I apologize.",
      { steps: failSteps },
    ),
  },
  {
    category: "low-signal",
    label: "malformed action only",
    input: makeInput(
      'Action: {broken json here action: something else',
      { steps: loopSteps },
    ),
  },
  {
    category: "low-signal",
    label: "hedging with uncertainty markers",
    input: makeInput(
      "I believe it might possibly be that maybe the likely answer could perhaps be something approximately like that probably",
      { steps: failSteps },
    ),
  },
  {
    category: "low-signal",
    label: "copy-paste artifacts",
    input: makeInput(
      "```\n```\n```\nundefined\nnull\n[object Object]\n```\n```",
      { steps: loopSteps },
    ),
  },
  {
    category: "low-signal",
    label: "no reasoning just filler",
    input: makeInput(
      "Well, you see, the thing is, basically, what we have here is, you know, sort of like, a situation where...",
      { steps: failSteps },
    ),
  },
  {
    category: "low-signal",
    label: "repeated failed tool pattern",
    input: makeInput(
      'Thought: Let me try again. Action: web-search({"query": "test"})',
      { steps: loopSteps },
    ),
  },
  {
    category: "low-signal",
    label: "gibberish output",
    input: makeInput(
      "asdf jkl; qwerty uiop zxcv bnm, asdf jkl; qwerty",
      { steps: loopSteps },
    ),
  },
  {
    category: "low-signal",
    label: "late iteration with no progress",
    input: makeInput(
      "I'm still working on this. Let me think more about it.",
      { iteration: 9, maxIterations: 10, steps: failSteps },
    ),
  },
  {
    category: "low-signal",
    label: "hallucinated tool output",
    input: makeInput(
      "Observation: The search returned exactly what I expected. The answer is 42. Thought: Perfect, just as I predicted.",
      { steps: loopSteps },
    ),
  },
  {
    category: "low-signal",
    label: "meta-commentary instead of action",
    input: makeInput(
      "I am an AI language model and I need to carefully consider all aspects of this problem before proceeding with any action.",
      { steps: failSteps },
    ),
  },
  {
    category: "low-signal",
    label: "contradictory reasoning",
    input: makeInput(
      "The answer is definitely yes. But on the other hand, it could be no. Actually, I think it might be yes. Or maybe no.",
      { steps: loopSteps },
    ),
  },
  {
    category: "low-signal",
    label: "excessive quoting with no analysis",
    input: makeInput(
      '"According to the source, the data shows X." "Another source says Y." "A third source mentions Z." No conclusion drawn.',
      { steps: failSteps },
    ),
  },
  {
    category: "low-signal",
    label: "broken markdown formatting",
    input: makeInput(
      "# ## ### #### **bold** *italic* ~~strike~~ [link](broken) ![img](404)",
      { steps: loopSteps },
    ),
  },
  {
    category: "low-signal",
    label: "all hedges no substance",
    input: makeInput(
      "It seems like it could possibly perhaps maybe be the case that this might likely be approximately roughly uncertain",
      { steps: failSteps },
    ),
  },
  {
    category: "low-signal",
    label: "single letter spam",
    input: makeInput("a a a a a a a a a a a a a a a a a a a a", { steps: loopSteps }),
  },
  {
    category: "low-signal",
    label: "self-referential loop",
    input: makeInput(
      "As I mentioned before, I need to reconsider what I said earlier about reconsidering my initial approach to reconsidering",
      { steps: loopSteps },
    ),
  },

  // ════════════════════════════════════════════════════════════
  // AMBIGUOUS (20 examples): Short, exploratory, or jargon-heavy
  // Composite should be 0.35–0.85
  // ════════════════════════════════════════════════════════════

  {
    category: "ambiguous",
    label: "very short acknowledgment",
    input: makeInput("OK.", { steps: partialSteps }),
  },
  {
    category: "ambiguous",
    label: "jargon-heavy technical analysis",
    input: makeInput(
      "The algorithm uses O(n log n) time complexity with a balanced BST for the range query operation",
      { steps: partialSteps },
    ),
  },
  {
    category: "ambiguous",
    label: "exploratory pivot",
    input: makeInput(
      "Exploring alternative approach: what if we try a different API endpoint?",
      { taskDescription: "Integrate with the payments API" },
    ),
  },
  {
    category: "ambiguous",
    label: "legitimate uncertainty",
    input: makeInput(
      "The documentation is ambiguous about this parameter. I should check the source code to confirm.",
      { steps: partialSteps },
    ),
  },
  {
    category: "ambiguous",
    label: "domain-specific jargon",
    input: makeInput(
      "The CQRS pattern with event sourcing requires separate read and write models with eventual consistency guarantees",
      { taskDescription: "Design the architecture" },
    ),
  },
  {
    category: "ambiguous",
    label: "partial progress acknowledgment",
    input: makeInput(
      "Good, the first test passed. Now I need to handle the edge case.",
      { steps: partialSteps },
    ),
  },
  {
    category: "ambiguous",
    label: "planning without action",
    input: makeInput(
      "I should: 1) check the logs, 2) verify the config, 3) restart the service. Let me start with the logs.",
    ),
  },
  {
    category: "ambiguous",
    label: "error acknowledgment",
    input: makeInput(
      "That tool call failed because the API key was invalid. I need to try a different approach.",
      { steps: partialSteps },
    ),
  },
  {
    category: "ambiguous",
    label: "mathematical reasoning",
    input: makeInput(
      "If we compute the derivative of f(x) = x^3 - 2x + 1, we get f'(x) = 3x^2 - 2, which equals zero at x = sqrt(2/3)",
      { taskDescription: "Find the critical points" },
    ),
  },
  {
    category: "ambiguous",
    label: "short confirmation",
    input: makeInput("Yes, that's correct.", { steps: partialSteps }),
  },
  {
    category: "ambiguous",
    label: "comparative analysis",
    input: makeInput(
      "React uses a virtual DOM while Svelte compiles to vanilla JS. Both have trade-offs for this use case.",
      { taskDescription: "Choose a frontend framework" },
    ),
  },
  {
    category: "ambiguous",
    label: "hypothesis formation",
    input: makeInput(
      "The memory leak might be caused by the event listener not being cleaned up in the useEffect return function.",
      { taskDescription: "Debug the memory leak", steps: partialSteps },
    ),
  },
  {
    category: "ambiguous",
    label: "single-word response",
    input: makeInput("Done."),
  },
  {
    category: "ambiguous",
    label: "code-like output",
    input: makeInput(
      "const result = items.filter(i => i.active).map(i => i.name).sort();",
      { taskDescription: "Write filter logic" },
    ),
  },
  {
    category: "ambiguous",
    label: "context switching",
    input: makeInput(
      "Before I continue with the main task, I noticed a typo in the README that should be fixed.",
      { taskDescription: "Implement the feature", steps: partialSteps },
    ),
  },
  {
    category: "ambiguous",
    label: "abstract reasoning",
    input: makeInput(
      "The key insight is that this is essentially a graph traversal problem, which can be solved with BFS or DFS.",
      { taskDescription: "Solve the routing problem" },
    ),
  },
  {
    category: "ambiguous",
    label: "cautious but correct",
    input: makeInput(
      "I believe the answer is 42, based on the calculation. Let me double-check before committing.",
      { steps: partialSteps },
    ),
  },
  {
    category: "ambiguous",
    label: "tradeoff discussion",
    input: makeInput(
      "We could use SQLite for simplicity or PostgreSQL for scalability. The choice depends on expected load.",
      { taskDescription: "Choose database" },
    ),
  },
  {
    category: "ambiguous",
    label: "intermediate debugging",
    input: makeInput(
      "The stack trace points to line 157 but the actual cause is likely upstream in the middleware chain.",
      { taskDescription: "Fix the 500 error", steps: partialSteps },
    ),
  },
  {
    category: "ambiguous",
    label: "emoji-style response",
    input: makeInput("Got it, moving on to the next step."),
  },
];
