# Adaptive Harness — Telemetry Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Repo:** `github.com/tylerjrbuell/reactive-telemetry` (separate from `reactive-agents-ts`). This plan runs inside that repo once you have it cloned — none of the paths below exist in the framework repo.

**Goal:** Extend the reactive-telemetry ingestion service to accept the new adaptive-harness fields emitted by the framework (dialect, classifier accuracy, subagent outcomes, arg validity, enhanced entropy features), aggregate them per model, and expose a public read endpoint `GET /v1/profiles/:modelId` that the framework fetches to inform cold-start calibration for its users.

**Architecture:** Additive schema extension on the existing `/v1/reports` ingestion endpoint (new optional fields — wire-compatible with older clients). A scheduled aggregation job rolls the last 30 days of reports per model into a `BehaviorProfile` JSON served under `/v1/profiles/:modelId`. No existing endpoints change. Privacy model unchanged: counts/categoricals only, no task content.

**Tech Stack (from orientation):** Hono + SQLite + hand-rolled validation (TypeScript). Existing code includes `model_profiles` table, `profiles.ts` route, `aggregation.ts` service, `scheduler.ts`. The `run_reports` table (NOT `reports`) is the ingestion target. Several tasks refactor existing files rather than creating new ones.

**Paired plan:** `docs/superpowers/plans/2026-04-15-adaptive-harness-framework.md` — defines the wire schema this server consumes and the read endpoint the framework calls.

---

## Repo Orientation (complete — 2026-04-15)

Orientation already run. The concrete mapping used throughout this plan:

| Concept | Actual Path | Notes |
|---|---|---|
| Ingestion endpoint | `src/routes/reports.ts` | `POST /v1/reports` handler on Hono router `reportsRouter` |
| Request validation | `src/services/validation.ts` | Hand-rolled `validateRunReport(body)` returning `{ valid, error? }` |
| Type definitions | `src/types.ts` | `RunReport` interface — extend with adaptive-harness fields |
| Persistence layer | `src/db/queries.ts` | `insertReport(report: RunReport)` function |
| Database schema | `src/db/schema.sql` | SQLite — table is **`run_reports`** (not `reports`) |
| Aggregation logic | `src/services/aggregation.ts` | Existing service — refactor, don't replace |
| Scheduler | `src/services/scheduler.ts` | Existing — wire profile aggregation into it |
| Profiles route | `src/routes/profiles.ts` | Existing — extend to return new fields |
| App entry point | `src/app.ts` | Registers routes |
| Migrations | `src/db/migrations/` | Create this directory if absent |

**Critical stack differences from the original plan's assumptions:**

1. **SQLite** not Postgres. No `JSONB` — use `TEXT` and `JSON.stringify/parse` at the boundary. No `DOUBLE PRECISION` — use `REAL`. No `ON CONFLICT ... DO UPDATE` — use `INSERT OR REPLACE` (note: this clobbers the row, so if you need to update a subset, do UPDATE + INSERT separately).
2. **Hand-rolled validation** not Zod. Validation returns `{ valid: boolean; error?: string }`. Unknown fields are silently allowed. For enum checks, explicitly test the value against the allowed set.
3. **Hono** not Express. Request/response style differs — consult the existing `profiles.ts` route for conventions.
4. **Existing `model_profiles` table** — inspect its current schema and prefer ALTER TABLE over CREATE TABLE. If columns are missing, add them additively.

**Adapt every Zod/Postgres/Express example below to Hono/hand-rolled/SQLite as you go.** Specific adaptations called out per-task. The TDD cycle still applies — write the failing test first using the repo's existing test utilities.

- [ ] Commit the orientation notes file (`ORIENTATION.md` or equivalent) as the first change before Task 1, so subagents executing later tasks have context without re-deriving it.

---

## Scope and Non-goals

**In scope (this plan):**
- Schema migration to store new optional fields on reports
- Validation changes to accept the new fields (backward compatible)
- Daily aggregation job that rolls up per-model profiles
- `GET /v1/profiles/:modelId` endpoint returning derived calibration fields
- Abuse controls: rate limits, minimum-sample threshold for profile publication, payload size cap
- Privacy audit checklist for the new fields
- End-to-end integration test (ingest → aggregate → fetch)

**Out of scope (future plans):**
- Community skill synthesis (`GET /v1/skills/:taskCategory`)
- Playbooks (`GET /v1/playbooks/:tier/:category`)
- Admin/ops dashboard for viewing the data corpus
- Authentication for write endpoint (already exists; no changes)
- Any data migration for historical reports

---

## Wire Schema — the contract the framework already emits

The framework's `RunReport` (from the paired plan, `packages/reactive-intelligence/src/telemetry/types.ts`) will POST these **new optional fields** to `/v1/reports`:

```ts
// Adaptive-harness signals:
toolCallDialectObserved?: "native-fc" | "fenced-json" | "pseudo-code" | "nameless-shape" | "none";
classifierFalsePositives?: readonly string[];
classifierFalseNegatives?: readonly string[];
subagentInvocations?: readonly { delegated: boolean; succeeded: boolean }[];
toolArgValidityRate?: number; // 0..1

// Enhanced entropy features:
entropyVariance?: number;
entropyOscillationCount?: number;
finalCompositeEntropy?: number | null;
entropyAreaUnderCurve?: number;
```

All are **optional**. Pre-existing clients continue to work unchanged.

The public `GET /v1/profiles/:modelId` endpoint returns a JSON body matching a subset of the framework's `ModelCalibration` shape plus aggregation metadata:

```ts
{
  modelId: string,
  sampleCount: number,          // number of reports in the aggregation window
  lastUpdatedAt: string,         // ISO timestamp of last aggregation run
  windowDays: number,            // rollup window (default 30)
  // Derived calibration fields:
  parallelCallCapability?: "reliable" | "partial" | "sequential-only",
  classifierReliability?: "high" | "low" | "skip",
  toolCallDialect?: "native-fc" | "fenced-json" | "pseudo-code" | "nameless-shape" | "mixed",
  // Diagnostic extras:
  avgEntropyVariance?: number,
  avgOscillationCount?: number,
  meanFinalComposite?: number,
  taskCategoryDistribution?: Record<string, number>,  // {category: count}
}
```

---

## File Structure (assumed — adapt from orientation)

**New files (names are conventions — adjust to repo style):**
- `src/schemas/run-report-v2.ts` — updated validation schema for the ingestion payload
- `src/db/migrations/<timestamp>-adaptive-harness-fields.sql` — SQL migration for new columns
- `src/aggregation/profile-aggregator.ts` — daily rollup job
- `src/aggregation/profile-derivers.ts` — pure functions that derive calibration fields from aggregate stats
- `src/routes/profiles.ts` — `GET /v1/profiles/:modelId` handler
- `tests/aggregation/profile-derivers.test.ts`
- `tests/aggregation/profile-aggregator.test.ts`
- `tests/routes/profiles.test.ts`
- `tests/integration/ingest-aggregate-fetch.test.ts`
- `tests/privacy/payload-audit.test.ts`

**Modified files:**
- `src/routes/reports.ts` (or wherever `/v1/reports` is handled) — accept new fields
- `src/schemas/run-report.ts` — extend validation
- `src/db/schema.sql` (or ORM equivalent) — add columns
- `README.md` — document the new fields and endpoint

---

## Phase 1: Schema extension (accept the new fields)

### Task 1: Extend `RunReport` type and hand-rolled validator

**Files (from orientation):**
- Modify: `src/types.ts` — add the adaptive-harness + entropy optional fields to the `RunReport` interface
- Modify: `src/services/validation.ts` — extend `validateRunReport(body)` to enforce enum/range constraints on the new fields. Unknown fields are already allowed by the hand-rolled validator, so the type addition alone makes them accepted; the validator additions only ENFORCE bounds when the fields are present.
- Test: `tests/services/validation-adaptive-harness.test.ts`

**Zod snippet below is illustrative — adapt to the hand-rolled `{ valid, error }` pattern.** For example:

```ts
// src/services/validation.ts — add inside validateRunReport(body) before the existing success return
const DIALECTS = new Set(["native-fc", "fenced-json", "pseudo-code", "nameless-shape", "none"]);
if (body.toolCallDialectObserved !== undefined && !DIALECTS.has(body.toolCallDialectObserved)) {
  return { valid: false, error: `invalid toolCallDialectObserved: ${body.toolCallDialectObserved}` };
}
if (body.toolArgValidityRate !== undefined) {
  const v = body.toolArgValidityRate;
  if (typeof v !== "number" || v < 0 || v > 1) {
    return { valid: false, error: "toolArgValidityRate must be a number in [0, 1]" };
  }
}
if (body.entropyVariance !== undefined && (typeof body.entropyVariance !== "number" || body.entropyVariance < 0)) {
  return { valid: false, error: "entropyVariance must be a non-negative number" };
}
if (body.entropyOscillationCount !== undefined && (!Number.isInteger(body.entropyOscillationCount) || body.entropyOscillationCount < 0)) {
  return { valid: false, error: "entropyOscillationCount must be a non-negative integer" };
}
if (body.parallelTurnCount !== undefined && (!Number.isInteger(body.parallelTurnCount) || body.parallelTurnCount < 0)) {
  return { valid: false, error: "parallelTurnCount must be a non-negative integer" };
}
if (body.classifierFalsePositives !== undefined && (!Array.isArray(body.classifierFalsePositives) || !body.classifierFalsePositives.every((s: unknown) => typeof s === "string"))) {
  return { valid: false, error: "classifierFalsePositives must be string[]" };
}
// ... same shape check for classifierFalseNegatives and subagentInvocations
```

The Zod example in Step 3 below stays as-is for reference but should be translated into this conditional style at implementation time.

- [ ] **Step 1: Write the failing test**

```ts
// tests/schemas/run-report-v2.test.ts
// Assumes Zod-style schema. Replace with actual validator if different.
import { describe, it, expect } from "vitest"; // or bun:test — match repo convention
import { RunReportSchema } from "../../src/schemas/run-report.js";

const baseValidReport = {
  id: "01KP...",
  installId: "uuid-ish",
  modelId: "cogito",
  modelTier: "local",
  provider: "ollama",
  taskCategory: "research",
  toolCount: 3,
  toolsUsed: ["web-search"],
  strategyUsed: "reactive",
  strategySwitched: false,
  entropyTrace: [],
  terminatedBy: "final_answer",
  outcome: "success",
  totalIterations: 3,
  totalTokens: 1500,
  durationMs: 1234,
  clientVersion: "0.9.0",
};

describe("RunReportSchema with adaptive-harness fields", () => {
  it("accepts payload without the new fields (backward compat)", () => {
    const parsed = RunReportSchema.parse(baseValidReport);
    expect(parsed.modelId).toBe("cogito");
  });

  it("accepts dialect field values", () => {
    for (const dialect of ["native-fc", "fenced-json", "pseudo-code", "nameless-shape", "none"]) {
      const parsed = RunReportSchema.parse({ ...baseValidReport, toolCallDialectObserved: dialect });
      expect(parsed.toolCallDialectObserved).toBe(dialect);
    }
  });

  it("rejects invalid dialect values", () => {
    expect(() => RunReportSchema.parse({ ...baseValidReport, toolCallDialectObserved: "bogus" })).toThrow();
  });

  it("accepts classifierFalsePositives as string array", () => {
    const parsed = RunReportSchema.parse({
      ...baseValidReport,
      classifierFalsePositives: ["code-execute"],
      classifierFalseNegatives: [],
    });
    expect(parsed.classifierFalsePositives).toEqual(["code-execute"]);
  });

  it("accepts subagentInvocations array of {delegated,succeeded}", () => {
    const parsed = RunReportSchema.parse({
      ...baseValidReport,
      subagentInvocations: [{ delegated: true, succeeded: true }],
    });
    expect(parsed.subagentInvocations).toHaveLength(1);
  });

  it("bounds toolArgValidityRate to [0, 1]", () => {
    expect(() => RunReportSchema.parse({ ...baseValidReport, toolArgValidityRate: -0.1 })).toThrow();
    expect(() => RunReportSchema.parse({ ...baseValidReport, toolArgValidityRate: 1.5 })).toThrow();
    const parsed = RunReportSchema.parse({ ...baseValidReport, toolArgValidityRate: 0.75 });
    expect(parsed.toolArgValidityRate).toBe(0.75);
  });

  it("accepts enhanced entropy features", () => {
    const parsed = RunReportSchema.parse({
      ...baseValidReport,
      entropyVariance: 0.12,
      entropyOscillationCount: 3,
      finalCompositeEntropy: 0.45,
      entropyAreaUnderCurve: 1.7,
    });
    expect(parsed.entropyVariance).toBe(0.12);
  });
});
```

- [ ] **Step 2: Run test to confirm failures (new fields unrecognized)**

Run: `npm test -- run-report-v2` (or equivalent)
Expected: FAIL — schema does not know about new fields; either strips them or throws on unknown properties depending on validator mode.

- [ ] **Step 3: Extend the schema**

Example using Zod:

```ts
// src/schemas/run-report.ts — extend the existing schema
const DialectSchema = z.enum(["native-fc", "fenced-json", "pseudo-code", "nameless-shape", "none"]);
const SubagentInvocationSchema = z.object({
  delegated: z.boolean(),
  succeeded: z.boolean(),
});

export const RunReportSchema = BaseRunReportSchema.extend({
  // Adaptive harness signals
  toolCallDialectObserved: DialectSchema.optional(),
  classifierFalsePositives: z.array(z.string()).optional(),
  classifierFalseNegatives: z.array(z.string()).optional(),
  subagentInvocations: z.array(SubagentInvocationSchema).optional(),
  toolArgValidityRate: z.number().min(0).max(1).optional(),

  // Enhanced entropy features
  entropyVariance: z.number().min(0).optional(),
  entropyOscillationCount: z.number().int().min(0).optional(),
  finalCompositeEntropy: z.number().nullable().optional(),
  entropyAreaUnderCurve: z.number().min(0).optional(),
});
```

Adapt to the actual validator if not Zod.

- [ ] **Step 4: Run tests to confirm green**

Run: `npm test -- run-report-v2`
Expected: PASS, 7 cases

- [ ] **Step 5: Commit**

```bash
git add src/schemas/run-report.ts tests/schemas/run-report-v2.test.ts
git commit -m "feat(schema): accept adaptive-harness + enhanced-entropy fields on RunReport"
```

---

### Task 2: SQL migration — add columns to reports table

**Files:**
- Create: `src/db/migrations/<timestamp>-adaptive-harness-fields.sql`
- Test: `tests/db/migration-adaptive-harness.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/migration-adaptive-harness.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { openTestDb, applyMigrations } from "../helpers/db-utils.js";

describe("adaptive-harness migration", () => {
  let db: Awaited<ReturnType<typeof openTestDb>>;

  beforeAll(async () => {
    db = await openTestDb();
    await applyMigrations(db);
  });

  it("reports table has new adaptive-harness columns", async () => {
    const cols = await db.listColumns("reports");
    const names = cols.map((c) => c.name);
    expect(names).toContain("tool_call_dialect_observed");
    expect(names).toContain("classifier_false_positives"); // JSON column
    expect(names).toContain("classifier_false_negatives");
    expect(names).toContain("subagent_invocations");
    expect(names).toContain("tool_arg_validity_rate");
    expect(names).toContain("entropy_variance");
    expect(names).toContain("entropy_oscillation_count");
    expect(names).toContain("final_composite_entropy");
    expect(names).toContain("entropy_area_under_curve");
  });

  it("new columns are all nullable (backward compat)", async () => {
    const cols = await db.listColumns("reports");
    const newCols = cols.filter((c) => c.name.startsWith("tool_call_dialect") || c.name.startsWith("classifier_") || c.name.startsWith("subagent_") || c.name.startsWith("tool_arg_") || c.name.startsWith("entropy_") || c.name.startsWith("final_composite"));
    expect(newCols.length).toBeGreaterThanOrEqual(9);
    for (const col of newCols) {
      expect(col.notNull).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm test -- migration-adaptive-harness`
Expected: FAIL — columns don't exist

- [ ] **Step 3: Write the SQLite migration**

Each `ALTER TABLE` must be its own statement (SQLite limitation). JSON fields are `TEXT` — serialize/deserialize at the query boundary. No `CHECK` constraints on optional numeric ranges — validation happens at the validator layer (Task 1).

```sql
-- src/db/migrations/20260415120000-adaptive-harness-fields.sql
ALTER TABLE run_reports ADD COLUMN tool_call_dialect_observed TEXT;
ALTER TABLE run_reports ADD COLUMN classifier_false_positives TEXT; -- JSON-encoded string[]
ALTER TABLE run_reports ADD COLUMN classifier_false_negatives TEXT; -- JSON-encoded string[]
ALTER TABLE run_reports ADD COLUMN subagent_invocations TEXT;        -- JSON-encoded {delegated,succeeded}[]
ALTER TABLE run_reports ADD COLUMN tool_arg_validity_rate REAL;
ALTER TABLE run_reports ADD COLUMN entropy_variance REAL;
ALTER TABLE run_reports ADD COLUMN entropy_oscillation_count INTEGER;
ALTER TABLE run_reports ADD COLUMN final_composite_entropy REAL;
ALTER TABLE run_reports ADD COLUMN entropy_area_under_curve REAL;

CREATE INDEX IF NOT EXISTS idx_run_reports_model_recent ON run_reports (model_id, created_at DESC);
```

Migration runner: if the repo doesn't already have one, the simplest approach is a startup-time `db.exec(fs.readFileSync("src/db/migrations/*.sql"))` ordered by filename with an `applied_migrations` table to track idempotency. Follow whatever convention already exists in `src/db/schema.sql` setup.

- [ ] **Step 4: Run test to confirm green**

Run: `npm test -- migration-adaptive-harness`
Expected: PASS, 2 cases

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/20260415120000-adaptive-harness-fields.sql \
        tests/db/migration-adaptive-harness.test.ts
git commit -m "feat(db): add adaptive-harness + entropy columns to reports table"
```

---

### Task 3: Persist the new fields via `insertReport()`

**Files (from orientation):**
- Modify: `src/db/queries.ts` — extend `insertReport(report: RunReport)` to include the new columns
- Modify: `src/routes/reports.ts` — no logic change needed (route already delegates to `insertReport`); verify the whole `body` object is passed through after validation
- Test: `tests/db/queries-adaptive-harness.test.ts`

For JSON-typed columns (classifier_false_positives, classifier_false_negatives, subagent_invocations), serialize with `JSON.stringify(value ?? null)` on insert and parse on read. Keep the column value `NULL` when the field is `undefined` on the incoming report.

- [ ] **Step 1: Write the failing test**

```ts
// tests/routes/reports-new-fields.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestApp } from "../helpers/app-utils.js";
import { openTestDb, applyMigrations } from "../helpers/db-utils.js";

describe("POST /v1/reports — persists adaptive-harness fields", () => {
  let app: ReturnType<typeof createTestApp>;
  let db: Awaited<ReturnType<typeof openTestDb>>;

  beforeEach(async () => {
    db = await openTestDb();
    await applyMigrations(db);
    app = createTestApp({ db });
  });

  it("round-trips all new fields through the DB", async () => {
    const payload = {
      id: "01KP_XX",
      installId: "install-1",
      modelId: "cogito",
      modelTier: "local",
      provider: "ollama",
      taskCategory: "research",
      toolCount: 2,
      toolsUsed: ["web-search"],
      strategyUsed: "reactive",
      strategySwitched: false,
      entropyTrace: [],
      terminatedBy: "final_answer",
      outcome: "success",
      totalIterations: 3,
      totalTokens: 1500,
      durationMs: 1234,
      clientVersion: "0.9.0",
      toolCallDialectObserved: "pseudo-code",
      classifierFalsePositives: ["code-execute"],
      classifierFalseNegatives: [],
      subagentInvocations: [{ delegated: true, succeeded: true }],
      toolArgValidityRate: 0.85,
      entropyVariance: 0.12,
      entropyOscillationCount: 3,
      finalCompositeEntropy: 0.45,
      entropyAreaUnderCurve: 1.7,
    };

    const response = await app.post("/v1/reports", payload);
    expect(response.status).toBe(202);

    const row = await db.queryOne<Record<string, unknown>>(
      "SELECT * FROM run_reports WHERE id = $1",
      [payload.id],
    );
    expect(row?.tool_call_dialect_observed).toBe("pseudo-code");
    expect(row?.classifier_false_positives).toEqual(["code-execute"]);
    expect(row?.tool_arg_validity_rate).toBeCloseTo(0.85, 5);
    expect(row?.entropy_oscillation_count).toBe(3);
  });

  it("accepts payloads without any new fields (backward compat)", async () => {
    const payload = {
      id: "01KP_LEGACY",
      installId: "install-1",
      modelId: "cogito",
      modelTier: "local",
      provider: "ollama",
      taskCategory: "research",
      toolCount: 0,
      toolsUsed: [],
      strategyUsed: "reactive",
      strategySwitched: false,
      entropyTrace: [],
      terminatedBy: "final_answer",
      outcome: "success",
      totalIterations: 1,
      totalTokens: 500,
      durationMs: 300,
      clientVersion: "0.8.0",
    };
    const response = await app.post("/v1/reports", payload);
    expect(response.status).toBe(202);

    const row = await db.queryOne<Record<string, unknown>>(
      "SELECT * FROM run_reports WHERE id = $1",
      [payload.id],
    );
    expect(row?.tool_call_dialect_observed).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to confirm failure (columns unused by insert)**

Run: `npm test -- reports-new-fields`
Expected: FAIL — fields not persisted

- [ ] **Step 3: Update the insert path**

In the existing `/v1/reports` handler, extend the INSERT to include the new columns. Example for a prepared-statement style:

```ts
await db.query(
  `INSERT INTO run_reports (
    id, install_id, model_id, model_tier, provider, task_category,
    /* ... existing columns ... */
    tool_call_dialect_observed, classifier_false_positives,
    classifier_false_negatives, subagent_invocations,
    tool_arg_validity_rate, entropy_variance,
    entropy_oscillation_count, final_composite_entropy,
    entropy_area_under_curve, created_at
  ) VALUES ($1, $2, /* ... */, $20, $21, $22, $23, $24, $25, $26, $27, $28, NOW())`,
  [
    report.id, report.installId, report.modelId, report.modelTier, report.provider, report.taskCategory,
    /* existing */
    report.toolCallDialectObserved ?? null,
    report.classifierFalsePositives ?? null,
    report.classifierFalseNegatives ?? null,
    report.subagentInvocations ?? null,
    report.toolArgValidityRate ?? null,
    report.entropyVariance ?? null,
    report.entropyOscillationCount ?? null,
    report.finalCompositeEntropy ?? null,
    report.entropyAreaUnderCurve ?? null,
  ],
);
```

- [ ] **Step 4: Run test to confirm green**

Run: `npm test -- reports-new-fields`
Expected: PASS, 2 cases

- [ ] **Step 5: Commit**

```bash
git add src/routes/reports.ts tests/routes/reports-new-fields.test.ts
git commit -m "feat(ingest): persist adaptive-harness + entropy fields into reports table"
```

---

## Phase 2: Aggregation — derive model profiles

### Task 4: Pure-function derivers for profile fields

**Files:**
- Create: `src/aggregation/profile-derivers.ts`
- Test: `tests/aggregation/profile-derivers.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/aggregation/profile-derivers.test.ts
import { describe, it, expect } from "vitest";
import {
  deriveParallelCallCapability,
  deriveClassifierReliability,
  deriveDominantDialect,
  deriveTaskCategoryDistribution,
} from "../../src/aggregation/profile-derivers.js";

describe("deriveParallelCallCapability", () => {
  it("returns 'reliable' when ≥80% of reports had any parallel tool call", () => {
    const stats = { totalReports: 10, parallelTurnReports: 9 };
    expect(deriveParallelCallCapability(stats)).toBe("reliable");
  });
  it("returns 'sequential-only' when <20%", () => {
    expect(deriveParallelCallCapability({ totalReports: 10, parallelTurnReports: 1 })).toBe("sequential-only");
  });
  it("returns 'partial' in between", () => {
    expect(deriveParallelCallCapability({ totalReports: 10, parallelTurnReports: 5 })).toBe("partial");
  });
  it("returns undefined for fewer than 10 samples", () => {
    expect(deriveParallelCallCapability({ totalReports: 5, parallelTurnReports: 5 })).toBeUndefined();
  });
});

describe("deriveClassifierReliability", () => {
  it("returns 'high' when <20% of reports have false positives", () => {
    expect(deriveClassifierReliability({ totalReports: 20, falsePositiveReports: 3 })).toBe("high");
  });
  it("returns 'low' when ≥40% have false positives", () => {
    expect(deriveClassifierReliability({ totalReports: 20, falsePositiveReports: 10 })).toBe("low");
  });
  it("returns undefined below threshold (N=10)", () => {
    expect(deriveClassifierReliability({ totalReports: 5, falsePositiveReports: 5 })).toBeUndefined();
  });
});

describe("deriveDominantDialect", () => {
  it("returns the dialect with >60% share", () => {
    const counts = { "native-fc": 80, "pseudo-code": 10, "fenced-json": 10, "nameless-shape": 0, "none": 0 };
    expect(deriveDominantDialect(counts, 100)).toBe("native-fc");
  });
  it("returns 'mixed' when no dialect dominates", () => {
    const counts = { "native-fc": 40, "pseudo-code": 35, "fenced-json": 15, "nameless-shape": 10, "none": 0 };
    expect(deriveDominantDialect(counts, 100)).toBe("mixed");
  });
  it("returns undefined when total is too small (<10)", () => {
    expect(deriveDominantDialect({ "native-fc": 5, "pseudo-code": 0, "fenced-json": 0, "nameless-shape": 0, "none": 0 }, 5)).toBeUndefined();
  });
});

describe("deriveTaskCategoryDistribution", () => {
  it("returns a normalized count map", () => {
    const rows = [
      { taskCategory: "research" }, { taskCategory: "research" }, { taskCategory: "code" },
    ];
    expect(deriveTaskCategoryDistribution(rows)).toEqual({ research: 2, code: 1 });
  });
  it("returns an empty object for no rows", () => {
    expect(deriveTaskCategoryDistribution([])).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test -- profile-derivers`
Expected: FAIL — module not found

- [ ] **Step 3: Implement derivers**

```ts
// src/aggregation/profile-derivers.ts

export const MIN_SAMPLES_FOR_PARALLEL = 10;
export const MIN_SAMPLES_FOR_CLASSIFIER = 10;
export const MIN_SAMPLES_FOR_DIALECT = 10;

export type DialectLabel = "native-fc" | "fenced-json" | "pseudo-code" | "nameless-shape" | "none";

export function deriveParallelCallCapability(stats: {
  totalReports: number;
  parallelTurnReports: number;
}): "reliable" | "partial" | "sequential-only" | undefined {
  if (stats.totalReports < MIN_SAMPLES_FOR_PARALLEL) return undefined;
  const rate = stats.parallelTurnReports / stats.totalReports;
  if (rate >= 0.8) return "reliable";
  if (rate < 0.2) return "sequential-only";
  return "partial";
}

export function deriveClassifierReliability(stats: {
  totalReports: number;
  falsePositiveReports: number;
}): "high" | "low" | undefined {
  if (stats.totalReports < MIN_SAMPLES_FOR_CLASSIFIER) return undefined;
  const rate = stats.falsePositiveReports / stats.totalReports;
  return rate >= 0.4 ? "low" : "high";
}

export function deriveDominantDialect(
  counts: Record<DialectLabel, number>,
  total: number,
): DialectLabel | "mixed" | undefined {
  if (total < MIN_SAMPLES_FOR_DIALECT) return undefined;
  for (const key of Object.keys(counts) as DialectLabel[]) {
    if (counts[key]! / total > 0.6) return key;
  }
  return "mixed";
}

export function deriveTaskCategoryDistribution(
  rows: readonly { readonly taskCategory: string }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    out[row.taskCategory] = (out[row.taskCategory] ?? 0) + 1;
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- profile-derivers`
Expected: PASS, 12 cases

- [ ] **Step 5: Commit**

```bash
git add src/aggregation/profile-derivers.ts tests/aggregation/profile-derivers.test.ts
git commit -m "feat(aggregation): pure derivers for parallel/classifier/dialect profile fields"
```

---

### Task 5: Aggregation job — roll up a 30-day window per model

**Files:**
- Create: `src/aggregation/profile-aggregator.ts`
- Test: `tests/aggregation/profile-aggregator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/aggregation/profile-aggregator.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { openTestDb, applyMigrations, insertTestReport } from "../helpers/db-utils.js";
import { runProfileAggregation } from "../../src/aggregation/profile-aggregator.js";

describe("runProfileAggregation", () => {
  let db: Awaited<ReturnType<typeof openTestDb>>;

  beforeEach(async () => {
    db = await openTestDb();
    await applyMigrations(db);
  });

  it("computes a profile when enough samples exist", async () => {
    for (let i = 0; i < 15; i++) {
      await insertTestReport(db, {
        id: `r${i}`,
        modelId: "cogito",
        toolCallDialectObserved: i < 12 ? "pseudo-code" : "native-fc",
        classifierFalsePositives: i % 2 === 0 ? ["code-execute"] : [],
        entropyVariance: 0.1 + i * 0.01,
        createdAt: new Date().toISOString(),
      });
    }

    const summary = await runProfileAggregation(db, { windowDays: 30 });
    expect(summary.profilesProduced).toBe(1);

    const profile = await db.queryOne<Record<string, unknown>>(
      "SELECT * FROM model_profiles WHERE model_id = $1",
      ["cogito"],
    );
    expect(profile?.tool_call_dialect).toBe("pseudo-code");
    expect(profile?.classifier_reliability).toBe("low"); // ~50% false positive
    expect(profile?.sample_count).toBe(15);
  });

  it("skips models below sample threshold", async () => {
    for (let i = 0; i < 5; i++) {
      await insertTestReport(db, { id: `s${i}`, modelId: "rare-model", createdAt: new Date().toISOString() });
    }
    const summary = await runProfileAggregation(db, { windowDays: 30 });
    expect(summary.profilesProduced).toBe(0);

    const profile = await db.queryOne(
      "SELECT * FROM model_profiles WHERE model_id = $1",
      ["rare-model"],
    );
    expect(profile).toBeNull();
  });

  it("ignores reports outside the window", async () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    for (let i = 0; i < 15; i++) {
      await insertTestReport(db, { id: `old${i}`, modelId: "cogito", createdAt: oldDate });
    }
    const summary = await runProfileAggregation(db, { windowDays: 30 });
    expect(summary.profilesProduced).toBe(0);
  });
});
```

- [ ] **Step 2: Ensure `model_profiles` has the columns we need**

**Important:** orientation noted that `model_profiles` already exists. Before running this migration, inspect the current schema:

```bash
sqlite3 <db-file> ".schema model_profiles"
```

Then write a migration that ADDS any missing columns. Template (edit to only include columns that don't yet exist):

```sql
-- src/db/migrations/20260415130000-model-profiles-adaptive-fields.sql
-- Add columns only if they don't already exist. SQLite has no IF NOT EXISTS on ALTER
-- TABLE ADD COLUMN, so we run each ALTER in its own try/catch at the migration runner level,
-- OR inspect the schema and emit only needed ALTERs.

ALTER TABLE model_profiles ADD COLUMN classifier_reliability TEXT;
ALTER TABLE model_profiles ADD COLUMN tool_call_dialect TEXT;
ALTER TABLE model_profiles ADD COLUMN avg_entropy_variance REAL;
ALTER TABLE model_profiles ADD COLUMN avg_oscillation_count REAL;
ALTER TABLE model_profiles ADD COLUMN mean_final_composite REAL;
ALTER TABLE model_profiles ADD COLUMN task_category_distribution TEXT; -- JSON string
-- If sample_count / last_updated_at / parallel_call_capability / window_days already exist, DON'T re-add them.
```

If the table is empty or missing entirely, the CREATE form:

```sql
CREATE TABLE IF NOT EXISTS model_profiles (
  model_id TEXT PRIMARY KEY,
  sample_count INTEGER NOT NULL,
  last_updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  window_days INTEGER NOT NULL DEFAULT 30,
  parallel_call_capability TEXT,
  classifier_reliability TEXT,
  tool_call_dialect TEXT,
  avg_entropy_variance REAL,
  avg_oscillation_count REAL,
  mean_final_composite REAL,
  task_category_distribution TEXT
);
```

- [ ] **Step 3: Run tests to confirm failure**

Run: `npm test -- profile-aggregator`
Expected: FAIL — module not found / table not found

- [ ] **Step 4: Implement the aggregator**

```ts
// src/aggregation/profile-aggregator.ts
import type { Database } from "../db/types.js"; // adapt to actual type
import {
  deriveParallelCallCapability,
  deriveClassifierReliability,
  deriveDominantDialect,
  type DialectLabel,
} from "./profile-derivers.js";

export interface AggregationOptions {
  readonly windowDays?: number;
  readonly now?: Date;
}

export interface AggregationSummary {
  readonly profilesProduced: number;
  readonly modelsSeen: number;
  readonly skippedBelowThreshold: number;
}

export async function runProfileAggregation(
  db: Database,
  opts: AggregationOptions = {},
): Promise<AggregationSummary> {
  const windowDays = opts.windowDays ?? 30;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const modelIds = await db.queryRows<{ model_id: string }>(
    "SELECT DISTINCT model_id FROM run_reports WHERE created_at >= $1",
    [cutoff.toISOString()],
  );

  let profilesProduced = 0;
  let skippedBelowThreshold = 0;

  for (const { model_id: modelId } of modelIds) {
    const rows = await db.queryRows<ReportRow>(
      `SELECT * FROM run_reports WHERE model_id = $1 AND created_at >= $2`,
      [modelId, cutoff.toISOString()],
    );

    const total = rows.length;
    const parallelReports = rows.filter((r) => countParallelTurns(r) > 0).length;
    const falsePositiveReports = rows.filter((r) => (r.classifier_false_positives ?? []).length > 0).length;
    const dialectCounts: Record<DialectLabel, number> = {
      "native-fc": 0, "fenced-json": 0, "pseudo-code": 0, "nameless-shape": 0, "none": 0,
    };
    for (const r of rows) {
      const d = (r.tool_call_dialect_observed as DialectLabel | null) ?? "none";
      dialectCounts[d] = (dialectCounts[d] ?? 0) + 1;
    }
    const avgEntropyVariance = avgOrNull(rows.map((r) => r.entropy_variance));
    const avgOscillationCount = avgOrNull(rows.map((r) => r.entropy_oscillation_count));
    const meanFinalComposite = avgOrNull(rows.map((r) => r.final_composite_entropy));
    const taskCategoryDistribution: Record<string, number> = {};
    for (const r of rows) {
      taskCategoryDistribution[r.task_category] = (taskCategoryDistribution[r.task_category] ?? 0) + 1;
    }

    const parallelCapability = deriveParallelCallCapability({ totalReports: total, parallelTurnReports: parallelReports });
    const classifierReliability = deriveClassifierReliability({ totalReports: total, falsePositiveReports });
    const dialect = deriveDominantDialect(dialectCounts, total);

    if (!parallelCapability && !classifierReliability && !dialect) {
      skippedBelowThreshold++;
      continue;
    }

    // SQLite: use INSERT OR REPLACE (upsert on PRIMARY KEY model_id).
    // Every column must be specified since REPLACE clobbers the full row.
    await db.query(
      `INSERT OR REPLACE INTO model_profiles (
        model_id, sample_count, last_updated_at, window_days,
        parallel_call_capability, classifier_reliability, tool_call_dialect,
        avg_entropy_variance, avg_oscillation_count, mean_final_composite,
        task_category_distribution
      ) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        modelId, total, windowDays,
        parallelCapability ?? null,
        classifierReliability ?? null,
        dialect ?? null,
        avgEntropyVariance,
        avgOscillationCount,
        meanFinalComposite,
        JSON.stringify(taskCategoryDistribution),
      ],
    );
    profilesProduced++;
  }

  return { profilesProduced, modelsSeen: modelIds.length, skippedBelowThreshold };
}

interface ReportRow {
  readonly model_id: string;
  readonly task_category: string;
  readonly tool_call_dialect_observed: string | null;
  readonly classifier_false_positives: string[] | null;
  readonly entropy_variance: number | null;
  readonly entropy_oscillation_count: number | null;
  readonly final_composite_entropy: number | null;
  readonly subagent_invocations: { delegated: boolean; succeeded: boolean }[] | null;
  // ... etc. — add fields as they're accessed
}

function countParallelTurns(_row: ReportRow): number {
  // Requires per-turn data we don't persist currently. Use a proxy:
  //   subagent_invocations.length ≥ 2 OR entropyOscillationCount ≥ 2 as a rough signal.
  // Better: add a `parallel_turn_count` column in a future migration if the proxy
  // proves insufficient. For now, rely on the framework pre-computing and sending
  // the parallel turn count as part of the report (add to schema if needed).
  return 0; // STUB — see note below
}

function avgOrNull(values: readonly (number | null)[]): number | null {
  const filtered = values.filter((v): v is number => v !== null);
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, v) => sum + v, 0) / filtered.length;
}
```

**Important note on `countParallelTurns`:** the current `RunReport` schema does not persist a `parallelTurnCount` at the wire level. There are two options:

**Option A (recommended):** Add a `parallelTurnCount` field to the wire schema and DB column. This is a small additive extension — add it as Task 5.5 below in Phase 1.

**Option B:** Derive from the existing `entropyTrace` or `toolsUsed.length >= 2` in the aggregator. Less precise but requires no schema change.

For this plan, pick **Option A** — tracked as Task 5.5.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- profile-aggregator`
Expected: PASS, 3 cases

- [ ] **Step 6: Commit**

```bash
git add src/aggregation/profile-aggregator.ts \
        src/db/migrations/20260415130000-model-profiles.sql \
        tests/aggregation/profile-aggregator.test.ts
git commit -m "feat(aggregation): 30-day per-model profile rollup with thresholded publication"
```

---

### Task 5.5: Add `parallelTurnCount` to wire schema and DB (back-port)

This task fills the gap noted above. It should be executed **before** Task 5 is re-run — or in parallel with it.

**Files:**
- Modify: `src/schemas/run-report.ts`
- Modify: `src/db/migrations/` (new migration file)
- Modify: `src/routes/reports.ts`
- Coordinate: The framework repo's paired plan (Task 10 of `2026-04-15-adaptive-harness-framework.md`) must also add `parallelTurnCount?: number` to `RunReport`. Open a companion PR.

- [ ] **Step 1: Add `parallelTurnCount?: number` (non-negative integer) to the schema**

```ts
// Extend RunReportSchema
parallelTurnCount: z.number().int().min(0).optional(),
```

- [ ] **Step 2: Add a migration**

```sql
-- src/db/migrations/20260415131500-parallel-turn-count.sql (SQLite)
ALTER TABLE run_reports ADD COLUMN parallel_turn_count INTEGER;
```

Range validation for `parallel_turn_count` happens in the validator (Task 1), not as a DB constraint.

- [ ] **Step 3: Update the INSERT and aggregator to use the persisted value**

```ts
// in profile-aggregator.ts
function countParallelTurns(row: ReportRow & { parallel_turn_count: number | null }): number {
  return row.parallel_turn_count ?? 0;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- profile-aggregator run-report-v2 reports-new-fields`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/schemas/run-report.ts \
        src/db/migrations/20260415131500-parallel-turn-count.sql \
        src/routes/reports.ts \
        src/aggregation/profile-aggregator.ts
git commit -m "feat(schema): persist parallelTurnCount for aggregation precision"
```

---

## Phase 3: Public profile endpoint

### Task 6: `GET /v1/profiles/:modelId` — refactor the existing route

**Files (from orientation):**
- Modify: `src/routes/profiles.ts` (exists — extend response shape to include the new derived fields)
- Test: `tests/routes/profiles.test.ts`

**Hono convention reminder:** the Express-style `(req, res) => { res.json(...) }` examples below must be translated to Hono handlers, which typically look like `router.get("/:modelId", async (c) => c.json(body, status))`. Consult the existing `profiles.ts` for patterns already in use.

- [ ] **Step 1: Write the failing test**

```ts
// tests/routes/profiles.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestApp } from "../helpers/app-utils.js";
import { openTestDb, applyMigrations, insertTestReport } from "../helpers/db-utils.js";
import { runProfileAggregation } from "../../src/aggregation/profile-aggregator.js";

describe("GET /v1/profiles/:modelId", () => {
  let app: ReturnType<typeof createTestApp>;
  let db: Awaited<ReturnType<typeof openTestDb>>;

  beforeEach(async () => {
    db = await openTestDb();
    await applyMigrations(db);
    app = createTestApp({ db });
  });

  it("returns 404 when no profile exists for the model", async () => {
    const response = await app.get("/v1/profiles/unknown-model");
    expect(response.status).toBe(404);
  });

  it("returns the aggregated profile", async () => {
    for (let i = 0; i < 15; i++) {
      await insertTestReport(db, {
        id: `r${i}`,
        modelId: "cogito",
        toolCallDialectObserved: "pseudo-code",
        parallelTurnCount: i < 12 ? 2 : 0,
        createdAt: new Date().toISOString(),
      });
    }
    await runProfileAggregation(db);

    const response = await app.get("/v1/profiles/cogito");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/application\/json/);
    expect(response.headers["cache-control"]).toMatch(/public/);
    const body = response.body;
    expect(body.modelId).toBe("cogito");
    expect(body.sampleCount).toBe(15);
    expect(body.parallelCallCapability).toBe("reliable");
    expect(body.toolCallDialect).toBe("pseudo-code");
  });

  it("URL-decodes model IDs with colons", async () => {
    for (let i = 0; i < 15; i++) {
      await insertTestReport(db, {
        id: `q${i}`,
        modelId: "qwen2.5-coder:14b",
        createdAt: new Date().toISOString(),
      });
    }
    await runProfileAggregation(db);

    const response = await app.get("/v1/profiles/qwen2.5-coder%3A14b");
    expect(response.status).toBe(200);
    expect(response.body.modelId).toBe("qwen2.5-coder:14b");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- profiles`
Expected: FAIL — route not defined

- [ ] **Step 3: Implement the route**

```ts
// src/routes/profiles.ts (Express-style example — adapt to actual framework)
import type { Request, Response, Router } from "express";
import type { Database } from "../db/types.js";

const CACHE_TTL_SECONDS = 3600; // 1h — safe since aggregation runs daily

export function registerProfilesRoute(router: Router, db: Database): void {
  router.get("/v1/profiles/:modelId", async (req: Request, res: Response) => {
    const modelId = decodeURIComponent(req.params.modelId ?? "");
    if (!modelId) {
      return res.status(400).json({ error: "missing modelId" });
    }

    const row = await db.queryOne<ProfileRow>(
      "SELECT * FROM model_profiles WHERE model_id = $1",
      [modelId],
    );
    if (!row) {
      return res.status(404).json({ error: "profile not found", modelId });
    }

    res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
    res.json(toResponseShape(row));
  });
}

interface ProfileRow {
  readonly model_id: string;
  readonly sample_count: number;
  readonly last_updated_at: string;
  readonly window_days: number;
  readonly parallel_call_capability: string | null;
  readonly classifier_reliability: string | null;
  readonly tool_call_dialect: string | null;
  readonly avg_entropy_variance: number | null;
  readonly avg_oscillation_count: number | null;
  readonly mean_final_composite: number | null;
  readonly task_category_distribution: Record<string, number> | null;
}

function toResponseShape(row: ProfileRow) {
  return {
    modelId: row.model_id,
    sampleCount: row.sample_count,
    lastUpdatedAt: row.last_updated_at,
    windowDays: row.window_days,
    parallelCallCapability: row.parallel_call_capability ?? undefined,
    classifierReliability: row.classifier_reliability ?? undefined,
    toolCallDialect: row.tool_call_dialect ?? undefined,
    avgEntropyVariance: row.avg_entropy_variance ?? undefined,
    avgOscillationCount: row.avg_oscillation_count ?? undefined,
    meanFinalComposite: row.mean_final_composite ?? undefined,
    taskCategoryDistribution: row.task_category_distribution ?? undefined,
  };
}
```

- [ ] **Step 4: Wire the route in the app entry point**

Add `registerProfilesRoute(app, db)` to the main router setup.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- profiles`
Expected: PASS, 3 cases

- [ ] **Step 6: Commit**

```bash
git add src/routes/profiles.ts tests/routes/profiles.test.ts src/app.ts
git commit -m "feat(profiles): GET /v1/profiles/:modelId with 1h public cache"
```

---

### Task 7: Rate limit and payload size for profile endpoint

**Files:**
- Modify: `src/routes/profiles.ts`
- Test: `tests/routes/profiles-rate-limit.test.ts`

- [ ] **Step 1: Add the rate limit middleware test**

```ts
// tests/routes/profiles-rate-limit.test.ts
import { describe, it, expect } from "vitest";
import { createTestApp } from "../helpers/app-utils.js";
import { openTestDb, applyMigrations } from "../helpers/db-utils.js";

describe("profile endpoint rate limiting", () => {
  it("returns 429 after N requests from the same IP in the window", async () => {
    const db = await openTestDb();
    await applyMigrations(db);
    const app = createTestApp({ db, rateLimit: { windowMs: 60_000, max: 5 } });

    for (let i = 0; i < 5; i++) {
      const r = await app.get("/v1/profiles/anything", { ip: "1.2.3.4" });
      expect([200, 404]).toContain(r.status);
    }
    const sixth = await app.get("/v1/profiles/anything", { ip: "1.2.3.4" });
    expect(sixth.status).toBe(429);
  });

  it("per-IP — different clients share no budget", async () => {
    const db = await openTestDb();
    await applyMigrations(db);
    const app = createTestApp({ db, rateLimit: { windowMs: 60_000, max: 2 } });
    for (let i = 0; i < 2; i++) await app.get("/v1/profiles/x", { ip: "1.1.1.1" });
    const fromOtherIp = await app.get("/v1/profiles/x", { ip: "2.2.2.2" });
    expect(fromOtherIp.status).not.toBe(429);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- profiles-rate-limit`
Expected: FAIL — no rate limit in place

- [ ] **Step 3: Add a Hono-compatible rate limiter**

`express-rate-limit` doesn't work with Hono. Options:

- **`hono-rate-limiter`** (community package) — similar API to express-rate-limit.
- **Hand-rolled token bucket** — keyed by client IP (`c.req.header("x-forwarded-for") ?? c.req.raw.headers.get("cf-connecting-ip") ?? "anon"`), stored in an in-memory `Map`. Sufficient for single-node Pi deployment. For multi-node, swap the Map for SQLite with a small `rate_limit_buckets` table.

Hand-rolled sketch for a single-node Pi:

```ts
// src/middleware/rate-limit.ts
import type { Context, Next } from "hono";

interface Bucket { count: number; resetAt: number; }
const buckets = new Map<string, Bucket>();

export function rateLimit(windowMs: number, max: number) {
  return async (c: Context, next: Next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
      ?? c.req.raw.headers.get("cf-connecting-ip")
      ?? "anon";
    const now = Date.now();
    const bucket = buckets.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (bucket.count >= max) {
      return c.json({ error: "rate_limited" }, 429);
    }
    bucket.count++;
    return next();
  };
}
```

Apply only to `GET /v1/profiles/:modelId` (60 req/min/IP). Do NOT apply to `POST /v1/reports` in this task — write-path rate limiting deserves its own hardening plan because it interacts with HMAC signing and can't use raw IP (install IDs would be a better key).

- [ ] **Step 4: Run tests**

Run: `npm test -- profiles-rate-limit`
Expected: PASS, 2 cases

- [ ] **Step 5: Commit**

```bash
git add src/routes/profiles.ts tests/routes/profiles-rate-limit.test.ts
git commit -m "feat(profiles): per-IP rate limit (60/min) on profile endpoint"
```

---

### Task 8: Wire profile aggregation into the existing scheduler

**Files (from orientation):**
- Modify: `src/services/scheduler.ts` (exists — add the profile-aggregation job to the scheduler's registration list)
- Test: `tests/services/scheduler.test.ts`

If the existing scheduler already uses `node-cron`, reuse it. If it uses Bun's `setInterval`-based scheduling or a Pi-hosted systemd timer, adapt to whichever pattern is present. The goal is a daily 03:00 run; the mechanism doesn't matter.

- [ ] **Step 1: Implement the scheduler**

Choose one approach based on the repo's deployment model:

**Option A — Self-scheduled via `node-cron`:**

```ts
// src/aggregation/scheduler.ts
import cron from "node-cron";
import type { Database } from "../db/types.js";
import { runProfileAggregation } from "./profile-aggregator.js";

export function scheduleProfileAggregation(db: Database): void {
  // Run daily at 03:00 UTC
  cron.schedule("0 3 * * *", async () => {
    try {
      const summary = await runProfileAggregation(db);
      console.log(`[aggregation] ${summary.profilesProduced} profiles produced (${summary.modelsSeen} models seen, ${summary.skippedBelowThreshold} skipped)`);
    } catch (err) {
      console.error("[aggregation] failed:", err);
    }
  });
}
```

**Option B — External cron/k8s CronJob:** expose a one-shot CLI like `npm run aggregate-profiles` and configure the platform's scheduler to run it.

- [ ] **Step 2: Unit-test the scheduler wiring (minimal)**

```ts
// tests/aggregation/scheduler.test.ts
import { describe, it, expect, vi } from "vitest";
import { scheduleProfileAggregation } from "../../src/aggregation/scheduler.js";

vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));

describe("scheduleProfileAggregation", () => {
  it("registers a daily cron at 03:00", async () => {
    const cron = (await import("node-cron")).default;
    scheduleProfileAggregation({} as any);
    expect(cron.schedule).toHaveBeenCalledWith(
      "0 3 * * *",
      expect.any(Function),
    );
  });
});
```

- [ ] **Step 3: Run test**

Run: `npm test -- scheduler`
Expected: PASS

- [ ] **Step 4: Wire the scheduler in app bootstrap**

Add `scheduleProfileAggregation(db)` to the main startup.

- [ ] **Step 5: Commit**

```bash
git add src/aggregation/scheduler.ts tests/aggregation/scheduler.test.ts src/app.ts
git commit -m "feat(aggregation): schedule daily profile rollup at 03:00 UTC"
```

---

## Phase 4: Privacy and integration

### Task 9: Privacy audit — reject payloads that contain content-looking strings

**Files:**
- Create: `src/validation/privacy-guard.ts`
- Test: `tests/privacy/payload-audit.test.ts`

This is a defensive measure: even though the schema rejects unknown fields, we add an explicit guard that rejects payloads containing what looks like user-entered text (e.g., in tool argument values) in case a client bug leaks content.

- [ ] **Step 1: Write the failing test**

```ts
// tests/privacy/payload-audit.test.ts
import { describe, it, expect } from "vitest";
import { assertNoLikelyContent } from "../../src/validation/privacy-guard.ts";

describe("assertNoLikelyContent", () => {
  it("passes a clean payload", () => {
    expect(() => assertNoLikelyContent({
      modelId: "cogito",
      toolsUsed: ["web-search", "http-get"],
      classifierFalsePositives: ["code-execute"],
    })).not.toThrow();
  });

  it("throws when a suspected 'query' or 'prompt' key is present", () => {
    expect(() => assertNoLikelyContent({
      modelId: "cogito",
      query: "explain linked lists in detail",
    } as any)).toThrow(/likely content/);
  });

  it("throws when a string value is longer than 512 chars (heuristic for content leak)", () => {
    expect(() => assertNoLikelyContent({
      modelId: "cogito",
      terminatedBy: "x".repeat(600),
    })).toThrow(/too long/);
  });

  it("ignores known large fields like entropyTrace (array-typed)", () => {
    expect(() => assertNoLikelyContent({
      modelId: "cogito",
      entropyTrace: [{ iteration: 1, composite: 0.5 }],
    })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- payload-audit`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the guard**

```ts
// src/validation/privacy-guard.ts
const FORBIDDEN_KEYS = new Set([
  "query", "prompt", "task", "input", "output", "content", "message", "text", "body",
]);
const MAX_STRING_LEN = 512;

export function assertNoLikelyContent(payload: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(payload)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`payload rejected: key "${key}" is likely content and must not be submitted`);
    }
    if (typeof value === "string" && value.length > MAX_STRING_LEN) {
      throw new Error(`payload rejected: value at key "${key}" is too long (${value.length} chars) — likely content`);
    }
  }
}
```

- [ ] **Step 4: Integrate into `/v1/reports` handler** (call `assertNoLikelyContent(req.body)` before validation)

- [ ] **Step 5: Run tests**

Run: `npm test -- payload-audit`
Expected: PASS, 4 cases

- [ ] **Step 6: Commit**

```bash
git add src/validation/privacy-guard.ts tests/privacy/payload-audit.test.ts src/routes/reports.ts
git commit -m "feat(privacy): reject payloads with content-shaped keys or overlong strings"
```

---

### Task 10: End-to-end integration test — ingest → aggregate → fetch

**Files:**
- Create: `tests/integration/ingest-aggregate-fetch.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/integration/ingest-aggregate-fetch.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestApp } from "../helpers/app-utils.js";
import { openTestDb, applyMigrations } from "../helpers/db-utils.js";
import { runProfileAggregation } from "../../src/aggregation/profile-aggregator.js";

describe("ingest → aggregate → fetch flow", () => {
  let app: ReturnType<typeof createTestApp>;
  let db: Awaited<ReturnType<typeof openTestDb>>;

  beforeEach(async () => {
    db = await openTestDb();
    await applyMigrations(db);
    app = createTestApp({ db });
  });

  it("posted reports aggregate into a fetchable profile", async () => {
    // 1. Ingest 12 reports for model X
    for (let i = 0; i < 12; i++) {
      const payload = {
        id: `e2e-${i}`,
        installId: `install-${i % 3}`,
        modelId: "cogito",
        modelTier: "local",
        provider: "ollama",
        taskCategory: "research",
        toolCount: 2,
        toolsUsed: ["web-search"],
        strategyUsed: "reactive",
        strategySwitched: false,
        entropyTrace: [],
        terminatedBy: "final_answer",
        outcome: "success",
        totalIterations: 3,
        totalTokens: 1000,
        durationMs: 800,
        clientVersion: "0.9.0",
        toolCallDialectObserved: "pseudo-code",
        parallelTurnCount: i < 10 ? 2 : 0,
      };
      const r = await app.post("/v1/reports", payload);
      expect(r.status).toBe(202);
    }

    // 2. Aggregate
    const summary = await runProfileAggregation(db);
    expect(summary.profilesProduced).toBe(1);

    // 3. Fetch
    const response = await app.get("/v1/profiles/cogito");
    expect(response.status).toBe(200);
    expect(response.body.sampleCount).toBe(12);
    expect(response.body.toolCallDialect).toBe("pseudo-code");
    expect(response.body.parallelCallCapability).toBe("reliable"); // 10/12 = 83%
  });
});
```

- [ ] **Step 2: Run test**

Run: `npm test -- ingest-aggregate-fetch`
Expected: PASS, 1 case

- [ ] **Step 3: Commit**

```bash
git add tests/integration/ingest-aggregate-fetch.test.ts
git commit -m "test: end-to-end ingest → aggregate → fetch integration"
```

---

## Phase 5: Documentation and rollout

### Task 11: Document the new fields and endpoint

**Files:**
- Modify: `README.md`
- Create: `docs/api/profiles.md`

- [ ] **Step 1: Add an API reference section to `README.md` under existing API docs:**

````markdown
## New in v<bump>: Adaptive Harness Fields

The `/v1/reports` endpoint now accepts these optional fields for clients running
the adaptive-harness calibration pipeline (see reactive-agents framework v0.9+):

| Field | Type | Purpose |
|---|---|---|
| `toolCallDialectObserved` | enum | Which resolver tier fired (native-fc / fenced-json / pseudo-code / nameless-shape / none) |
| `classifierFalsePositives` | string[] | Tools classifier said were required but were not called |
| `classifierFalseNegatives` | string[] | Tools called ≥2× but classifier didn't list |
| `subagentInvocations` | { delegated, succeeded }[] | Sub-agent calls and their outcomes |
| `toolArgValidityRate` | number 0..1 | Fraction of tool calls with well-formed arg dicts |
| `parallelTurnCount` | integer | Turns with ≥2 tool calls in a single response |
| `entropyVariance` | number | Variance of composite entropy across iterations |
| `entropyOscillationCount` | integer | Derivative sign-change count |
| `finalCompositeEntropy` | number\|null | Last observed composite value |
| `entropyAreaUnderCurve` | number | Trapezoidal integral of composite over iterations |

All fields are optional — older clients continue to work.

## `GET /v1/profiles/:modelId`

Returns the aggregated behavioral profile for a model. Profiles update daily
from the last 30 days of reports. Returns 404 when fewer than 10 samples exist.

**Example:** `curl https://api.reactiveagents.dev/v1/profiles/cogito`

Response shape — see `docs/api/profiles.md`.
````

- [ ] **Step 2: Create `docs/api/profiles.md` with full response schema + examples**

- [ ] **Step 3: Commit**

```bash
git add README.md docs/api/profiles.md
git commit -m "docs: describe new adaptive-harness report fields + /v1/profiles endpoint"
```

---

### Task 12: Rollout checklist

- [ ] **Step 1: Deploy migration** (Task 2 + 5.5 migrations) to production DB during low-traffic window
- [ ] **Step 2: Deploy code** (write path + read path + aggregator)
- [ ] **Step 3: Trigger initial aggregation** manually so profiles exist before the daily cron fires
- [ ] **Step 4: Verify `/v1/profiles/cogito`** returns a populated response
- [ ] **Step 5: Monitor** — write-rate to `reports` unchanged; aggregator logs "N profiles produced" daily
- [ ] **Step 6: Tag a release** — `v<bump>`
- [ ] **Step 7: Coordinate release** with the framework plan's Task 19–20 so the client knows the endpoint is live

---

## Self-review checklist

Before handing off:
- Every task has a failing test, minimal impl, passing test, commit.
- No "TBD" / "similar to above" / placeholder content.
- Type consistency: wire schema matches framework's `RunReport` extension field-for-field.
- Migrations are additive only (no column drops, no type changes).
- All new fields are nullable/optional at every layer (schema, DB, derivation).
- Privacy: the new guard runs BEFORE schema validation on the write path.
- Rate limit is per-IP, not global.
- Aggregation is idempotent — re-running it produces identical output.
- End-to-end integration test exercises the full round trip.

## Execution handoff

After reviewing the plan:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task with review checkpoints. Good for a separate repo where context is minimal.
2. **Inline Execution** — execute in a session that's already oriented to the reactive-telemetry repo.

Coordinate with the framework-side plan (`2026-04-15-adaptive-harness-framework.md`) — Tasks 19–20 there depend on this server being live. Either:
- Ship this plan first, then enable framework's Task 19–20 (`fetchCommunity: true`)
- Ship both in parallel with a feature flag on the framework side; flip the flag when the server is live
