import type { BenchmarkTask } from "../types.js"

// ── Fixture generators ────────────────────────────────────────────────────────

function generateSalesData(): string {
  const header = "date,order_id,sku,qty,unit_price,discount_pct,net_revenue"
  const rows: string[] = [header]
  let id = 1
  const pad = (n: number) => String(n).padStart(4, "0")

  const skus = [
    { sku: "APPL-IPAD-AIR", price: 329.99 },
    { sku: "FURN-CHAIR-ERG", price: 299.99 },
    { sku: "CLTH-JACKET-L", price: 89.99 },
    { sku: "BOOK-DESIGN-01", price: 34.99 },
  ]
  const tv = { sku: "ELEC-4K-TV-001", price: 849.99 }

  // Day 1 — 2025-03-10: 15 orders, TV appears 8 times (spread through day), no discount
  const tvSlots1 = new Set([1, 2, 4, 6, 8, 10, 12, 14])
  for (let i = 1; i <= 15; i++) {
    const item = tvSlots1.has(i) ? tv : skus[(i % skus.length)]!
    const rev = (item.price).toFixed(2)
    rows.push(`2025-03-10,ORD-${pad(id++)},${item.sku},1,${item.price.toFixed(2)},0.00,${rev}`)
  }

  // Day 2 — 2025-03-11: 15 orders, 15% discount on ALL, TV out of stock after order 3
  for (let i = 1; i <= 15; i++) {
    const useTv = i <= 3
    const item = useTv ? tv : skus[(i % skus.length)]!
    const disc = 0.15
    const rev = (item.price * (1 - disc)).toFixed(2)
    rows.push(`2025-03-11,ORD-${pad(id++)},${item.sku},1,${item.price.toFixed(2)},0.15,${rev}`)
  }

  // Day 3 — 2025-03-12: 15 orders, TV restocked, no discount (recovery)
  const tvSlots3 = new Set([1, 3, 5, 8, 11, 13])
  for (let i = 1; i <= 15; i++) {
    const item = tvSlots3.has(i) ? tv : skus[(i % skus.length)]!
    const rev = (item.price).toFixed(2)
    rows.push(`2025-03-12,ORD-${pad(id++)},${item.sku},1,${item.price.toFixed(2)},0.00,${rev}`)
  }

  return rows.join("\n")
}

function generateEmployeeData(): string {
  const header = "employee_id,name,department,title,salary,tenure_years,performance_score"
  const rows: string[] = [header]

  const depts = [
    // Engineering: 15 people, high salary (~$140k avg), below-avg performance (~2.8)
    ...Array.from({ length: 15 }, (_, i) => ({
      dept: "Engineering",
      title: i < 5 ? "Senior Engineer" : i < 11 ? "Engineer II" : "Engineer I",
      salary: 120000 + Math.round(i * 2800 + (i % 3) * 5000),
      tenure: 1 + (i % 6),
      perf: (2.4 + (i % 5) * 0.14).toFixed(1),
    })),
    // Product: 10 people, medium salary (~$110k), good performance (~3.9)
    ...Array.from({ length: 10 }, (_, i) => ({
      dept: "Product",
      title: i < 3 ? "Senior PM" : "Product Manager",
      salary: 95000 + Math.round(i * 3200),
      tenure: 2 + (i % 5),
      perf: (3.6 + (i % 4) * 0.12).toFixed(1),
    })),
    // Sales: 15 people, lower salary (~$80k), high performance (~4.1)
    ...Array.from({ length: 15 }, (_, i) => ({
      dept: "Sales",
      title: i < 4 ? "Senior AE" : "Account Executive",
      salary: 68000 + Math.round(i * 1600),
      tenure: 1 + (i % 7),
      perf: (3.8 + (i % 4) * 0.12).toFixed(1),
    })),
    // Operations: 10 people, lowest salary (~$65k), good performance (~3.7)
    ...Array.from({ length: 10 }, (_, i) => ({
      dept: "Operations",
      title: i < 3 ? "Senior Ops" : "Operations Analyst",
      salary: 58000 + Math.round(i * 1800),
      tenure: 2 + (i % 8),
      perf: (3.4 + (i % 5) * 0.12).toFixed(1),
    })),
  ]

  const firstNames = ["Alex","Jordan","Taylor","Morgan","Casey","Riley","Jamie","Drew","Avery","Quinn",
                      "Blake","Cameron","Sage","Reese","Parker","Finley","Hayden","Rowan","Kendall","Skylar"]
  const lastNames  = ["Chen","Kim","Patel","Garcia","Johnson","Williams","Brown","Davis","Miller","Wilson"]

  depts.forEach((e, i) => {
    const name = `${firstNames[i % firstNames.length]} ${lastNames[i % lastNames.length]}`
    rows.push(`EMP-${String(i + 1).padStart(3,"0")},${name},${e.dept},${e.title},${e.salary},${e.tenure},${e.perf}`)
  })

  return rows.join("\n")
}

function generateSchemaSQL(): string {
  return `-- e-commerce schema (8 tables)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE addresses (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  line1 VARCHAR(255), city VARCHAR(100), country VARCHAR(2)
);

CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  sku VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(255),
  price_cents INT NOT NULL,
  inventory_count INT DEFAULT 0
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  address_id INT REFERENCES addresses(id),
  status VARCHAR(32) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE line_items (
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  product_id INT REFERENCES products(id),
  quantity INT NOT NULL,
  unit_price_cents INT NOT NULL
);

CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  amount_cents INT NOT NULL,
  status VARCHAR(32),
  processed_at TIMESTAMPTZ
);

CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
  product_id INT REFERENCES products(id),
  user_id INT REFERENCES users(id),
  rating INT CHECK (rating BETWEEN 1 AND 5),
  body TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE inventory (
  id SERIAL PRIMARY KEY,
  product_id INT REFERENCES products(id) UNIQUE,
  reserved_count INT DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_line_items_order ON line_items(order_id);
CREATE INDEX idx_payments_order ON payments(order_id);
`
}

function generateSortTS(): string {
  return `// Merge sort — clean O(n log n) implementation
export function mergeSort(arr: readonly number[]): number[] {
  if (arr.length <= 1) return [...arr]
  const mid = Math.floor(arr.length / 2)
  return merge(mergeSort(arr.slice(0, mid)), mergeSort(arr.slice(mid)))
}

function merge(left: number[], right: number[]): number[] {
  const result: number[] = []
  let l = 0, r = 0
  while (l < left.length && r < right.length) {
    result.push(left[l]! <= right[r]! ? left[l++]! : right[r++]!)
  }
  return result.concat(left.slice(l), right.slice(r))
}
`
}

function generateValidatorBug(): string {
  return `// validator.ts
export type ValidationResult = { valid: boolean; errors: string[] }

export function validate(
  data: unknown,
  schema: { required: string[] },
): ValidationResult {
  if (typeof data !== "object" || data === null) {
    return { valid: false, errors: ["Input must be an object"] }
  }
  const obj = data as Record<string, unknown>
  const errors: string[] = []
  for (const field of schema.required) {
    // BUG: !obj[field] rejects falsy-but-valid values (0, "", false)
    // Fix: use !(field in obj) || obj[field] === undefined
    if (!obj[field]) {
      errors.push(\`Missing required field: \${field}\`)
    }
  }
  return { valid: errors.length === 0, errors }
}
`
}

function generateProcessorBug(): string {
  return `// processor.ts
export function filterLargeList<T>(items: T[], predicate: (item: T) => boolean): T[] {
  // BUG: off-by-one — should be >= 10, not > 10
  if (items.length > 10) {
    return items.filter(predicate)
  }
  return items
}

export function normalizeScores(scores: number[]): number[] {
  const max = Math.max(...scores)
  if (max === 0) return scores.map(() => 0)
  return scores.map(s => s / max)
}
`
}

function generatePipelineBug(): string {
  return `// pipeline.ts
export type PipelineState = { count: number; results: string[] }

async function processFirst(state: PipelineState): Promise<string> {
  await new Promise(r => setTimeout(r, 1))
  state.count += 1
  return \`first-\${state.count}\`
}

async function processSecond(state: PipelineState): Promise<string> {
  // BUG: reads state.count before processFirst increments it when run concurrently
  await new Promise(r => setTimeout(r, 1))
  return \`second-\${state.count}\`
}

export async function runPipeline(state: PipelineState): Promise<string[]> {
  // BUG: Promise.all runs both concurrently — processSecond sees stale state.count
  const [r1, r2] = await Promise.all([processFirst(state), processSecond(state)])
  return [r1, r2]
}
`
}

function generateFallbackPrices(): string {
  return JSON.stringify({
    note: "Static fallback snapshot — use when live API is unavailable",
    timestamp: "2025-03-11T12:00:00Z",
    prices: {
      bitcoin:  { usd: 68450.21, usd_24h_change: 2.34, usd_market_cap: 1_347_000_000_000 },
      ethereum: { usd: 3512.88,  usd_24h_change: -0.87, usd_market_cap: 422_000_000_000 },
      solana:   { usd: 172.44,   usd_24h_change: 4.12,  usd_market_cap: 79_000_000_000 },
    },
  }, null, 2)
}

// ── Real-world task definitions ───────────────────────────────────────────────

export const REAL_WORLD_TASKS: readonly BenchmarkTask[] = [
  {
    id: "rw-1",
    tier: "real-world",
    name: "Research synthesis with source conflict",
    domain: "research",
    strategy: "plan-execute",
    prompt: `Research the top 3 embedded or edge-deployable vector databases with TypeScript support available in 2025. For each provide: name, license, WASM or browser support (yes/no), approximate query latency at 100k vectors, and a one-sentence verdict.

Note: some sources you find may have conflicting benchmark data for the same database. Where you find a conflict, identify it explicitly and explain how you resolved it or why you cannot resolve it. Output the final answer as a JSON array. Use only databases you can verify actually exist.`,
    requiresTools: true,
    maxIterations: 20,
    successCriteria: {
      type: "llm-judge",
      rubric: "Score 1.0 if: (1) exactly 3 databases named that actually exist, (2) each has a real license identifier, (3) at least one data conflict is explicitly identified, (4) output is a valid JSON array. Score 0.0 if any database is fabricated.",
      passThreshold: 0.6,
    },
    primaryDimensions: ["accuracy", "reasoning", "honest-uncertainty"],
    dimensionRubrics: [
      {
        dimension: "accuracy",
        rubric: "Are all 3 databases real? Are the licenses correct? Is the JSON array valid and parseable? Deduct heavily for any fabricated database or invented license.",
      },
      {
        dimension: "reasoning",
        rubric: "Did the agent form a search plan before executing? Does it synthesize across sources rather than copy-pasting? Does it handle contradictions analytically?",
      },
      {
        dimension: "honest-uncertainty",
        rubric: "Does the agent explicitly flag conflicting data rather than silently picking one source? Does it acknowledge when a latency figure is an estimate?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, memory: true, strategy: "plan-execute" },
    tags: ["research", "web-search", "json-output"],
  },

  {
    id: "rw-2",
    tier: "real-world",
    name: "Data investigation with red herring",
    domain: "analysis",
    strategy: "react",
    prompt: `Analyze the attached sales data in sales-data.csv. Identify what caused the revenue drop on day 2 (2025-03-11) compared to day 1 (2025-03-10). Name the specific primary cause, quantify the dollar impact, and recommend one concrete fix.`,
    requiresTools: true,
    maxIterations: 15,
    fixtures: [{ path: "sales-data.csv", content: generateSalesData() }],
    successCriteria: {
      type: "llm-judge",
      rubric: "Score 1.0 if: primary cause is ELEC-4K-TV-001 going out of stock, dollar impact is quantified, recommendation targets restocking. Score 0.2 if agent only identifies the discount without examining SKU-level data. Score 0.0 if agent fabricates data.",
      passThreshold: 0.6,
    },
    primaryDimensions: ["reasoning", "accuracy", "loop-intelligence"],
    dimensionRubrics: [
      {
        dimension: "reasoning",
        rubric: "Does the agent form multiple hypotheses (discount, OOS, other) and systematically eliminate them? Does it pivot when the discount hypothesis proves insufficient to explain the full drop?",
      },
      {
        dimension: "accuracy",
        rubric: "Is ELEC-4K-TV-001 out-of-stock correctly identified as the primary cause? Is the revenue impact quantified (even approximately)? Is the recommendation concrete?",
      },
      {
        dimension: "loop-intelligence",
        rubric: "Does the agent converge efficiently? Does it avoid re-running the same analysis after it has already ruled out a hypothesis?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, reactiveIntelligence: true, strategy: "react" },
    tags: ["data-analysis", "csv", "red-herring"],
  },

  {
    id: "rw-3",
    tier: "real-world",
    name: "Open-ended analysis, no recipe",
    domain: "automation",
    strategy: "plan-execute",
    prompt: `Analyze employees.csv and write a report to report.md surfacing whatever you think is most actionable for leadership. Show your reasoning.`,
    requiresTools: true,
    maxIterations: 15,
    fixtures: [{ path: "employees.csv", content: generateEmployeeData() }],
    successCriteria: {
      type: "llm-judge",
      rubric: "Score 1.0 if: report.md is written, contains a data table, surfaces the Engineering salary/performance outlier, gives a concrete recommendation grounded in data. Score 0.0 if report only describes data without identifying the actionable finding.",
      passThreshold: 0.6,
    },
    primaryDimensions: ["accuracy", "scope-discipline", "reasoning"],
    dimensionRubrics: [
      {
        dimension: "scope-discipline",
        rubric: "Is the report focused and actionable without scope creep? Does it avoid over-engineering (statistical tests, charts) when a table and paragraph suffice? Is it proportional to the brief?",
      },
      {
        dimension: "reasoning",
        rubric: "Does the analysis logic lead correctly from data to recommendation? Are the numbers accurate? Is the Engineering outlier finding justified by the data?",
      },
      {
        dimension: "accuracy",
        rubric: "Is the Engineering salary premium correctly quantified (approximately 40% above company average)? Are performance scores correctly compared?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, reactiveIntelligence: true, strategy: "plan-execute" },
    tags: ["data-analysis", "csv", "report-writing"],
  },

  {
    id: "rw-4",
    tier: "real-world",
    name: "API integration with type safety",
    domain: "execution",
    strategy: "react",
    prompt: `Using the JSONPlaceholder API at https://jsonplaceholder.typicode.com, fetch all posts by user ID 3, enrich each post with its comment count, and write a TypeScript module to output.ts that exports a typed EnrichedPost[] array as a const. The module must compile without errors.`,
    requiresTools: true,
    maxIterations: 15,
    successCriteria: {
      type: "verifiable",
      command: "bun check output.ts",
    },
    primaryDimensions: ["tool-mastery", "accuracy", "efficiency"],
    dimensionRubrics: [
      {
        dimension: "tool-mastery",
        rubric: "Did the agent use http-get correctly to fetch both posts and comments? Did it avoid redundant API calls (e.g., fetching comments it already retrieved)?",
      },
      {
        dimension: "accuracy",
        rubric: "Does the TypeScript type correctly model the API response? Does output.ts compile? Is the EnrichedPost type correct and complete?",
      },
      {
        dimension: "efficiency",
        rubric: "How many http-get calls were made relative to the theoretical minimum (1 for posts + 1 per post for comments, or batched)? Flag anything above 2× the minimum.",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, strategy: "react" },
    tags: ["http", "typescript", "api-integration"],
  },

  {
    id: "rw-5",
    tier: "real-world",
    name: "Zero-downtime migration plan",
    domain: "planning",
    strategy: "tree-of-thought",
    prompt: `Given the attached PostgreSQL schema in schema.sql, design a migration to support multi-tenancy via row-level security. The migration must be executable with zero downtime on a live database. Produce: (1) 5 specific risks with mitigations, (2) the complete ALTER TABLE and CREATE POLICY SQL statements in execution order, (3) a downtime estimate with justification.`,
    requiresTools: true,
    maxIterations: 20,
    fixtures: [{ path: "schema.sql", content: generateSchemaSQL() }],
    successCriteria: {
      type: "llm-judge",
      rubric: "Score 1.0 if: SQL contains valid CREATE POLICY and ALTER TABLE statements, 5 schema-specific risks are listed (not generic advice), downtime estimate is justified with specific operations cited, zero-downtime approach uses a recognized pattern (shadow table, online DDL, etc.). Score 0.0 if SQL is syntactically invalid or risks are generic.",
      passThreshold: 0.6,
    },
    primaryDimensions: ["reasoning", "memory-fidelity", "accuracy"],
    dimensionRubrics: [
      {
        dimension: "reasoning",
        rubric: "Does the agent explore multiple migration approaches before settling? Does it identify real conflicts in the schema (e.g., shared sequences, FK constraints, the inventory unique constraint) rather than generic risks?",
      },
      {
        dimension: "memory-fidelity",
        rubric: "Is the zero-downtime constraint maintained consistently throughout ALL SQL statements, not just mentioned in the introduction? Check for any DDL that would take an exclusive lock.",
      },
      {
        dimension: "accuracy",
        rubric: "Are the SQL statements syntactically valid? Are the CREATE POLICY statements correct for PostgreSQL RLS syntax? Are the 5 risks specific to the 8-table schema provided?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, reactiveIntelligence: true, memory: true, strategy: "tree-of-thought" },
    tags: ["sql", "postgresql", "planning"],
  },

  {
    id: "rw-6",
    tier: "real-world",
    name: "Adversarial convergence — nothing to optimize",
    domain: "adversarial",
    strategy: "react",
    prompt: `Profile and optimize the attached sorting implementation in sort.ts for maximum performance. Provide specific improvements with before/after benchmarks.`,
    requiresTools: true,
    maxIterations: 15,
    fixtures: [{ path: "sort.ts", content: generateSortTS() }],
    successCriteria: {
      type: "llm-judge",
      rubric: "INVERTED: Score 1.0 if agent correctly identifies the algorithm is already O(n log n), explains why further optimization yields diminishing returns, and stops without rewriting working code. Score 0.0 if agent invents fake bottlenecks, rewrites unnecessarily, or fabricates benchmark numbers.",
      passThreshold: 0.6,
    },
    primaryDimensions: ["loop-intelligence", "honest-uncertainty", "efficiency"],
    dimensionRubrics: [
      {
        dimension: "loop-intelligence",
        rubric: "Does the agent stop after one or two analytical passes? Does it avoid running the same profiling code repeatedly after having already characterized the algorithm?",
      },
      {
        dimension: "honest-uncertainty",
        rubric: "Does the agent explicitly state no meaningful optimization exists and explain why (O(n log n) is optimal for comparison sorts), rather than hedging or inventing minor micro-optimizations?",
      },
      {
        dimension: "efficiency",
        rubric: "Does the agent reach the correct conclusion (nothing to optimize) in minimal iterations, or does it waste iterations running benchmarks that don't change the conclusion?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, reactiveIntelligence: true, strategy: "react" },
    tags: ["adversarial", "convergence", "early-stop"],
  },

  {
    id: "rw-7",
    tier: "real-world",
    name: "Multi-file debug, no test suite",
    domain: "execution",
    strategy: "react",
    prompt: `The TypeScript package in src/ has bugs. No test suite is provided. Write tests to find the bugs, fix all of them, and verify your tests pass. Do not stop until \`bun test\` exits 0.`,
    requiresTools: true,
    maxIterations: 25,
    fixtures: [
      { path: "src/validator.ts",  content: generateValidatorBug() },
      { path: "src/processor.ts",  content: generateProcessorBug() },
      { path: "src/pipeline.ts",   content: generatePipelineBug() },
      { path: "package.json",      content: JSON.stringify({ name: "buggy-pkg", type: "module", devDependencies: { "bun-types": "latest" } }, null, 2) },
      { path: "tsconfig.json",     content: JSON.stringify({ compilerOptions: { strict: true, module: "ESNext", moduleResolution: "bundler", target: "ES2022" } }, null, 2) },
    ],
    successCriteria: {
      type: "verifiable",
      command: "bun test",
      partialCredit: true,
    },
    primaryDimensions: ["tool-mastery", "resilience", "accuracy"],
    dimensionRubrics: [
      {
        dimension: "tool-mastery",
        rubric: "Does the agent use code-execute to discover failures rather than guessing? Does it avoid rerunning tests it already knows the result of?",
      },
      {
        dimension: "resilience",
        rubric: "When a fix attempt doesn't fully resolve a bug, does the agent adapt its approach rather than repeating the same fix? Does it handle the race condition bug (which requires understanding async semantics)?",
      },
      {
        dimension: "accuracy",
        rubric: "Are all 3 bugs found and fixed? Does the validator bug fix correctly handle falsy-but-valid values? Is the off-by-one fixed to >= 10? Is the race condition fixed to sequential awaits?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, reactiveIntelligence: true, strategy: "react" },
    tags: ["debugging", "typescript", "test-writing"],
  },

  {
    id: "rw-8",
    tier: "real-world",
    name: "Memory under compaction pressure",
    domain: "memory",
    strategy: "plan-execute",
    prompt: `You are building a data processing pipeline in 5 phases. Phase 1 establishes the constraints that all subsequent phases must satisfy. Complete all 5 phases in order.

PHASE 1 CONSTRAINT (remember this for all phases):
- All monetary values must use integer cents, never floating-point dollars
- All timestamps must be Unix epoch milliseconds, never ISO strings
- All IDs must be prefixed with the entity type: "user_", "order_", "product_"

Now complete the following phases using these constraints:
Phase 2: Write a TypeScript type definition file (types.ts) for User, Order, Product
Phase 3: Write a data generator (generate.ts) that creates 5 sample records of each type
Phase 4: Write a validator (validate.ts) that checks all constraints are met
Phase 5: Run the validator against the generated data and report results`,
    requiresTools: true,
    maxIterations: 25,
    successCriteria: {
      type: "verifiable",
      command: "bun run generate.ts && bun run validate.ts",
    },
    primaryDimensions: ["memory-fidelity", "reliability", "accuracy"],
    dimensionRubrics: [
      {
        dimension: "memory-fidelity",
        rubric: "Do ALL generated files consistently use integer cents (not dollars), epoch milliseconds (not ISO strings), and prefixed IDs? Any violation in any phase indicates memory loss of the Phase 1 constraint. Check types.ts, generate.ts, and validate.ts independently.",
      },
      {
        dimension: "reliability",
        rubric: "Does the agent complete all 5 phases without drifting on the constraints? Does later work contradict earlier work?",
      },
      {
        dimension: "accuracy",
        rubric: "Does the validator correctly detect constraint violations? Do the type definitions correctly model the constraints? Does the pipeline run end-to-end without errors?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, memory: true, strategy: "plan-execute" },
    tags: ["memory", "multi-phase", "typescript"],
  },

  {
    id: "rw-9",
    tier: "real-world",
    name: "Resilience under tool failure",
    domain: "resilience",
    strategy: "react",
    prompt: `Fetch today's cryptocurrency prices for BTC, ETH, and SOL from the price API at INJECT_MOCK_URL and write a summary to prices.md with current price, 24h change, and market cap. If the API is unavailable, check whether a fallback-prices.json file exists in your working directory.`,
    requiresTools: true,
    maxIterations: 15,
    fixtures: [{ path: "fallback-prices.json", content: generateFallbackPrices() }],
    successCriteria: {
      type: "llm-judge",
      rubric: "Score 1.0 if prices.md exists with prices for BTC, ETH, and SOL including a 24h change figure. Accepts either live or clearly-labeled fallback data. Score 0.0 if prices.md is missing or incomplete.",
      passThreshold: 0.6,
    },
    primaryDimensions: ["resilience", "tool-mastery", "accuracy"],
    dimensionRubrics: [
      {
        dimension: "resilience",
        rubric: "Does the agent retry after receiving HTTP 503? Does it discover and use the fallback-prices.json file when retries fail? Does it complete the task despite the injected failures?",
      },
      {
        dimension: "tool-mastery",
        rubric: "Does the agent correctly interpret 503 as a transient error warranting retry? Does it correctly parse the fallback JSON structure?",
      },
      {
        dimension: "accuracy",
        rubric: "Does prices.md contain correct structure with all 3 assets (BTC, ETH, SOL) and a 24h change value for each?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, reactiveIntelligence: true, strategy: "react" },
    tags: ["resilience", "http", "fallback"],
  },

  {
    id: "rw-10",
    tier: "real-world",
    name: "Ambiguous requirements — scope under pressure",
    domain: "adversarial",
    strategy: "react",
    prompt: `Our user onboarding is underperforming. Improve it.

Here is everything we have: users sign up, confirm email, and are shown a dashboard. Drop-off is 40% between signup and dashboard. Fix this.`,
    requiresTools: true,
    maxIterations: 10,
    successCriteria: {
      type: "llm-judge",
      rubric: "Score 1.0 if agent either (A) explicitly states 2+ assumptions it must make due to missing context before proceeding, OR (B) asks targeted clarifying questions AND produces a deliverable scoped to the information provided. Score 0.0 if agent invents specific metrics, A/B test results, or user research it was not given, or produces a comprehensive strategy for a 2-sentence brief.",
      passThreshold: 0.6,
    },
    primaryDimensions: ["honest-uncertainty", "scope-discipline", "reasoning"],
    dimensionRubrics: [
      {
        dimension: "honest-uncertainty",
        rubric: "Does the agent acknowledge what it doesn't know (stack, platform, user type, actual drop-off reason) rather than assuming? Does it avoid inventing specific numbers or research?",
      },
      {
        dimension: "scope-discipline",
        rubric: "Is the output proportional to the information provided? Does it resist over-delivering with comprehensive strategy docs, user research frameworks, or A/B test plans that require data never provided?",
      },
      {
        dimension: "reasoning",
        rubric: "If the agent makes assumptions, are they reasonable and explicitly stated? Does its recommendation follow logically from what is actually known?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, reactiveIntelligence: true, strategy: "react" },
    tags: ["adversarial", "scope", "ambiguity"],
  },
]
