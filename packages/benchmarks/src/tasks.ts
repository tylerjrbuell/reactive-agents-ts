// File: src/tasks.ts
/**
 * Benchmark task suite — 20 tasks across 5 complexity tiers.
 * Tasks are designed to exercise different reasoning strategies and capabilities.
 */
import type { BenchmarkTask } from "./types.js";

export const BENCHMARK_TASKS: readonly BenchmarkTask[] = [
  // ─── Trivial (single-shot, no reasoning) ───
  {
    id: "t1-greeting",
    tier: "trivial",
    name: "Simple greeting",
    prompt: "Say hello.",
    expected: "hello",
  },
  {
    id: "t2-math",
    tier: "trivial",
    name: "Basic arithmetic",
    prompt: "What is 7 * 8?",
    expected: "56",
  },
  {
    id: "t3-fact",
    tier: "trivial",
    name: "Factual recall",
    prompt: "What is the capital of France?",
    expected: "Paris",
  },
  {
    id: "t4-format",
    tier: "trivial",
    name: "Output formatting",
    prompt: "List the days of the week as a comma-separated list.",
    expected: "Monday",
  },

  // ─── Simple (minimal reasoning) ───
  {
    id: "s1-summarize",
    tier: "simple",
    name: "Text summarization",
    prompt: "Summarize in one sentence: TypeScript is a typed superset of JavaScript that compiles to plain JavaScript. It adds optional static typing and class-based OOP to the language.",
    expected: "TypeScript",
  },
  {
    id: "s2-translate",
    tier: "simple",
    name: "Code translation",
    prompt: "Convert this Python to TypeScript: def add(a, b): return a + b",
    expected: "function",
  },
  {
    id: "s3-explain",
    tier: "simple",
    name: "Concept explanation",
    prompt: "Explain what a closure is in JavaScript in 2 sentences.",
    expected: "function",
  },
  {
    id: "s4-regex",
    tier: "simple",
    name: "Regex generation",
    prompt: "Write a regex that matches email addresses.",
    expected: "@",
  },

  // ─── Moderate (multi-step reasoning) ───
  {
    id: "m1-debug",
    tier: "moderate",
    name: "Bug identification",
    prompt: "Find the bug: function sum(arr) { let total = 0; for (let i = 0; i <= arr.length; i++) { total += arr[i]; } return total; }",
    expected: "off-by-one|boundary|<|undefined",
    strategy: "react",
  },
  {
    id: "m2-refactor",
    tier: "moderate",
    name: "Code refactoring",
    prompt: "Refactor this to use Array.reduce: function sum(arr) { let total = 0; for (const n of arr) { total += n; } return total; }",
    expected: "reduce",
    strategy: "react",
  },
  {
    id: "m3-compare",
    tier: "moderate",
    name: "Technology comparison",
    prompt: "Compare React and Vue.js — list 3 pros and 3 cons of each.",
    expected: "React|Vue",
    strategy: "react",
  },
  {
    id: "m4-algorithm",
    tier: "moderate",
    name: "Algorithm design",
    prompt: "Implement binary search in TypeScript. Return the index or -1.",
    expected: "function|const",
    strategy: "react",
  },

  // ─── Complex (plan-execute, multi-tool) ───
  {
    id: "c1-architecture",
    tier: "complex",
    name: "System design",
    prompt: "Design a URL shortener service. Describe the API endpoints, database schema, and the shortening algorithm.",
    expected: "POST|GET|database|hash",
    strategy: "plan-execute",
  },
  {
    id: "c2-review",
    tier: "complex",
    name: "Code review",
    prompt: "Review this code for security issues: app.get('/user', (req, res) => { const id = req.query.id; db.query('SELECT * FROM users WHERE id = ' + id); })",
    expected: "injection|SQL|sanitiz|parameteriz",
    strategy: "plan-execute",
  },
  {
    id: "c3-test-gen",
    tier: "complex",
    name: "Test generation",
    prompt: "Write 5 unit tests for a Stack class with push(), pop(), peek(), isEmpty(), and size() methods.",
    expected: "test|expect|assert",
    strategy: "plan-execute",
  },
  {
    id: "c4-migration",
    tier: "complex",
    name: "Migration planning",
    prompt: "Create a migration plan to move a REST API from Express.js to Hono. List the steps, risks, and rollback strategy.",
    expected: "step|risk|rollback",
    strategy: "plan-execute",
  },

  // ─── Expert (deep analysis, tree-of-thought) ───
  {
    id: "e1-optimization",
    tier: "expert",
    name: "Performance optimization",
    prompt: "Analyze and optimize this: function findDuplicates(arr) { const dupes = []; for (let i = 0; i < arr.length; i++) { for (let j = i + 1; j < arr.length; j++) { if (arr[i] === arr[j] && !dupes.includes(arr[i])) dupes.push(arr[i]); } } return dupes; }",
    expected: "Set|Map|O\\(n\\)|hash",
    strategy: "tree-of-thought",
  },
  {
    id: "e2-tradeoff",
    tier: "expert",
    name: "Architecture tradeoffs",
    prompt: "Analyze the tradeoffs between microservices and monolith for a startup with 5 developers building an e-commerce platform. Consider: team size, deployment complexity, data consistency, and time to market.",
    expected: "tradeoff|monolith|microservice",
    strategy: "tree-of-thought",
  },
  {
    id: "e3-concurrency",
    tier: "expert",
    name: "Concurrency analysis",
    prompt: "Explain how to prevent race conditions in a Node.js application that processes payments. Include code examples using locks or queues.",
    expected: "lock|queue|mutex|atomic|concurren",
    strategy: "tree-of-thought",
  },
  {
    id: "e4-dsl",
    tier: "expert",
    name: "DSL design",
    prompt: "Design a domain-specific language for defining API routes. Show the grammar, 3 example expressions, and a parser implementation in TypeScript.",
    expected: "parse|grammar|token|route",
    strategy: "tree-of-thought",
  },
];

export const getTasksByTier = (tier: BenchmarkTask["tier"]): readonly BenchmarkTask[] =>
  BENCHMARK_TASKS.filter((t) => t.tier === tier);
