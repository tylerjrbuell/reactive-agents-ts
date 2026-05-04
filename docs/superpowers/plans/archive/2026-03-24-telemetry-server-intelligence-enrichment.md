# Telemetry Server — Intelligence Enrichment

**Goal:** Extend the telemetry API server (`api.reactiveagents.dev`) to accept, store, and aggregate the new intelligence data fields from the Living Intelligence System.

**Server stack:** Hono + bun:sqlite on Raspberry Pi (existing deployment)

**Spec reference:** `docs/superpowers/specs/2026-03-23-living-intelligence-system-design.md` Sections 7.1–7.4

---

## Changes Summary

### 1. Schema Migration — `run_reports` table (11 new columns)

```sql
-- Migration: 002_intelligence_enrichment.sql
ALTER TABLE run_reports ADD COLUMN trajectory_fingerprint TEXT;
ALTER TABLE run_reports ADD COLUMN abstract_tool_pattern TEXT;        -- JSON array
ALTER TABLE run_reports ADD COLUMN iterations_to_convergence INTEGER;
ALTER TABLE run_reports ADD COLUMN token_efficiency_ratio REAL;
ALTER TABLE run_reports ADD COLUMN thought_to_action_ratio REAL;
ALTER TABLE run_reports ADD COLUMN context_pressure_peak REAL;
ALTER TABLE run_reports ADD COLUMN skills_active_count INTEGER;
ALTER TABLE run_reports ADD COLUMN skill_effectiveness_scores TEXT;   -- JSON array
ALTER TABLE run_reports ADD COLUMN learned_skills_contribution INTEGER DEFAULT 0;
ALTER TABLE run_reports ADD COLUMN task_complexity TEXT;
ALTER TABLE run_reports ADD COLUMN failure_pattern TEXT;

CREATE INDEX IF NOT EXISTS idx_reports_complexity ON run_reports(task_complexity);
CREATE INDEX IF NOT EXISTS idx_reports_trajectory ON run_reports(trajectory_fingerprint);
CREATE INDEX IF NOT EXISTS idx_reports_failure ON run_reports(failure_pattern) WHERE failure_pattern IS NOT NULL;
```

All columns nullable — backward compatible with older clients.

### 2. New Table — `skill_effectiveness`

```sql
CREATE TABLE IF NOT EXISTS skill_effectiveness (
  id TEXT PRIMARY KEY,
  skill_fragment_hash TEXT NOT NULL,
  model_id TEXT NOT NULL,
  task_category TEXT NOT NULL,
  task_complexity TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  mean_entropy_delta REAL,
  mean_convergence_improvement REAL,
  success_rate REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(skill_fragment_hash, model_id, task_category)
);

CREATE INDEX IF NOT EXISTS idx_skill_eff_model ON skill_effectiveness(model_id);
CREATE INDEX IF NOT EXISTS idx_skill_eff_category ON skill_effectiveness(task_category);
```

### 3. Schema Migration — `model_profiles` table (7 new columns)

```sql
ALTER TABLE model_profiles ADD COLUMN avg_convergence_iteration REAL;
ALTER TABLE model_profiles ADD COLUMN p50_context_pressure REAL;
ALTER TABLE model_profiles ADD COLUMN p90_context_pressure REAL;
ALTER TABLE model_profiles ADD COLUMN common_trajectory_fingerprints TEXT;  -- JSON
ALTER TABLE model_profiles ADD COLUMN complexity_breakdown TEXT;            -- JSON
ALTER TABLE model_profiles ADD COLUMN failure_pattern_breakdown TEXT;       -- JSON
ALTER TABLE model_profiles ADD COLUMN skill_improvement_rate REAL;
```

### 4. Validation Changes (`POST /v1/reports`)

- Accept new optional fields
- Reject `trajectoryFingerprint` if present but not matching `{word}-{n}` segments (regex: `/^(\w+-\d+)(:\w+-\d+)*$/`)
- Reject `taskComplexity` if present but not one of: `trivial`, `moderate`, `complex`, `expert`
- Reject `failurePattern` if present but not one of: `loop-detected`, `context-overflow`, `tool-cascade-failure`, `strategy-exhausted`, `guardrail-halt`, `timeout`, `unknown`
- Body size limit unchanged (10KB)

### 5. New API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /v1/profiles/:modelId/trajectories` | Most common trajectory fingerprints for a model |
| `GET /v1/profiles/:modelId/complexity` | Performance breakdown by task complexity tier |
| `GET /v1/skills/effectiveness` | Skill effectiveness aggregated across community runs |
| `GET /v1/stats` (extended) | Add `skillsValidated`, `learnedSkillContributionRate`, `avgEntropyImprovement`, `topFailurePatterns`, `complexityDistribution` |

### 6. Aggregation Updates (`services/aggregation.ts`)

Extend the periodic aggregation job to compute:
- `avg_convergence_iteration` — mean across all runs for each model
- `p50/p90_context_pressure` — percentile calculations from `context_pressure_peak`
- `common_trajectory_fingerprints` — top 10 by count for each model
- `complexity_breakdown` — count by tier for each model
- `failure_pattern_breakdown` — count by pattern for each model
- `skill_improvement_rate` — % of runs where skills fired AND entropy improved
- Upsert into `skill_effectiveness` table from individual run data

---

## Implementation Order

1. Create `migrations/002_intelligence_enrichment.sql` with all ALTER TABLE + CREATE TABLE statements
2. Update `services/validation.ts` — accept new fields, add format validators
3. Update `services/ingestion.ts` — INSERT new columns, upsert `skill_effectiveness`
4. Update `services/aggregation.ts` — new model_profiles columns, trajectory/complexity queries
5. Add 3 new route handlers + extend `/v1/stats`
6. Run migration on production, verify with test report payload
