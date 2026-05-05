# Reactive Telemetry Server
**Date:** 2026-03-14
**Status:** Approved design
**Repo:** `reactive-telemetry` (private, GitHub)
**Deploy:** Docker on Raspberry Pi at `reactiveagents.dev`
**Stack:** Bun + Hono + bun:sqlite

---

## Overview

Lightweight telemetry collection API that receives anonymous entropy run reports from Reactive Agents framework installations, stores them in SQLite, and aggregates model optimization profiles and validated skills.

---

## Project Structure

```
reactive-telemetry/
├── src/
│   ├── index.ts              # Hono app + server entry
│   ├── routes/
│   │   ├── reports.ts        # POST /v1/reports
│   │   ├── profiles.ts       # GET /v1/profiles/:modelId
│   │   ├── skills.ts         # GET /v1/skills
│   │   └── stats.ts          # GET /v1/stats
│   ├── db/
│   │   ├── database.ts       # SQLite connection + migrations
│   │   ├── schema.sql        # Table definitions
│   │   └── queries.ts        # Prepared statements
│   ├── services/
│   │   ├── validation.ts     # HMAC signature verification
│   │   ├── aggregation.ts    # Profile rebuilding + skill promotion
│   │   └── scheduler.ts      # Periodic aggregation (cron-like)
│   └── types.ts              # RunReport, ModelProfile, Skill types
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## API

### `POST /v1/reports`

Receives a RunReport from a Reactive Agents installation.

**Headers (required):**
```
X-RA-Client-Version: 0.8.0
X-RA-Client-Signature: <HMAC-SHA256 of body>
Content-Type: application/json
```

**Body:** RunReport JSON (see main spec for full type)

**Validation:**
1. Check `X-RA-Client-Signature` against HMAC-SHA256(body, SIGNING_KEY)
2. Validate body shape (required fields present, types correct)
3. Reject if body > 10KB

**Response:**
- `201 Created` — `{ "id": "<runId>" }`
- `401 Unauthorized` — invalid or missing signature
- `400 Bad Request` — validation failure
- `413 Payload Too Large` — body > 10KB
- `429 Too Many Requests` — rate limit exceeded

### `GET /v1/profiles/:modelId`

Returns aggregated optimization profile for a model.

**Response:** `200 OK`
```json
{
  "modelId": "cogito:14b",
  "sampleCount": 847,
  "meanEntropy": 0.34,
  "convergenceRate": 0.73,
  "optimalStrategy": "plan-execute-reflect",
  "optimalTemperature": 0.5,
  "optimalMaxIterations": 8,
  "avgTokens": 12400,
  "avgDurationMs": 14200,
  "highEntropyThreshold": 0.62,
  "convergenceThreshold": 0.28,
  "updatedAt": "2026-03-14T20:00:00Z"
}
```
- `404 Not Found` — no data for this model yet

### `GET /v1/skills`

Returns validated skills, optionally filtered.

**Query params:**
- `modelId` — filter by model (optional)
- `taskCategory` — filter by task category (optional)
- `limit` — max results, default 20, max 100

**Response:** `200 OK`
```json
{
  "skills": [
    {
      "id": "01ABC...",
      "name": "cogito-14b-multi-tool-recipe",
      "modelId": "cogito:14b",
      "taskCategory": "multi-tool",
      "sampleCount": 47,
      "meanEntropy": 0.28,
      "convergenceRate": 0.89,
      "recipe": { ... },
      "updatedAt": "2026-03-14T20:00:00Z"
    }
  ],
  "total": 1
}
```

### `GET /v1/stats`

Public dashboard data.

**Response:** `200 OK`
```json
{
  "totalRuns": 12847,
  "totalInstalls": 342,
  "modelsTracked": 14,
  "skillsValidated": 23,
  "topModels": [
    { "modelId": "cogito:14b", "runs": 3420 },
    { "modelId": "claude-sonnet-4", "runs": 2891 }
  ],
  "since": "2026-03-14T00:00:00Z"
}
```

### `GET /health`

**Response:** `200 OK` — `{ "status": "ok", "uptime": 84200, "dbSizeBytes": 52428800 }`

---

## Database

### Schema

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS run_reports (
  id TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_tier TEXT NOT NULL,
  provider TEXT NOT NULL,
  task_category TEXT NOT NULL,
  strategy_used TEXT NOT NULL,
  strategy_switched INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL,
  terminated_by TEXT NOT NULL,
  total_iterations INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  tools_used TEXT NOT NULL,           -- JSON array of tool names
  entropy_trace TEXT NOT NULL,        -- JSON array of per-iteration scores
  skill_fragment TEXT,                -- JSON, null if not high-signal
  client_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reports_model ON run_reports(model_id);
CREATE INDEX IF NOT EXISTS idx_reports_category ON run_reports(task_category);
CREATE INDEX IF NOT EXISTS idx_reports_outcome ON run_reports(outcome);
CREATE INDEX IF NOT EXISTS idx_reports_created ON run_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_reports_install ON run_reports(install_id);

CREATE TABLE IF NOT EXISTS model_profiles (
  model_id TEXT PRIMARY KEY,
  sample_count INTEGER NOT NULL,
  mean_entropy REAL NOT NULL,
  convergence_rate REAL NOT NULL,
  optimal_strategy TEXT,
  optimal_temperature REAL,
  optimal_max_iterations INTEGER,
  avg_tokens REAL,
  avg_duration_ms REAL,
  high_entropy_threshold REAL,
  convergence_threshold REAL,
  strategy_breakdown TEXT,            -- JSON: { strategy: { count, successRate, avgEntropy } }
  profile_json TEXT,                  -- full detail blob
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  task_category TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  mean_entropy REAL NOT NULL,
  convergence_rate REAL NOT NULL,
  recipe_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skills_model ON skills(model_id);
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(task_category);
```

### Data volume estimates

- ~3KB per run_reports row (entropy_trace is the bulk)
- 1M runs ≈ 3GB SQLite file
- Pi with 1TB drive handles 300M+ runs before storage concern
- WAL mode handles concurrent reads during writes

---

## Validation Service

```typescript
import { createHmac } from "crypto";

const SIGNING_KEY = process.env.RA_SIGNING_KEY!;

export function verifySignature(body: string, signature: string): boolean {
  const expected = createHmac("sha256", SIGNING_KEY)
    .update(body)
    .digest("hex");
  return timingSafeEqual(expected, signature);
}
```

Use timing-safe comparison to prevent timing attacks on the signature.

---

## Aggregation Service

Runs periodically (every 100 new reports OR every 6 hours, whichever comes first).

### Profile Rebuilding

```sql
-- For each distinct model_id in run_reports:
SELECT
  model_id,
  COUNT(*) as sample_count,
  AVG(json_extract(entropy_trace, '$[#-1].composite')) as mean_final_entropy,
  SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as success_rate,
  -- strategy breakdown
  strategy_used,
  AVG(total_tokens) as avg_tokens,
  AVG(duration_ms) as avg_duration_ms
FROM run_reports
WHERE created_at > datetime('now', '-30 days')
GROUP BY model_id;
```

Conformal thresholds computed in TypeScript from the entropy distributions (same algorithm as the framework's `conformal.ts`).

### Skill Promotion

```typescript
// Group skill fragments by (model_id, task_category, recipe shape)
// For each group with 10+ entries:
//   - Compute convergence rate (% with converging trajectory)
//   - If convergenceRate > 0.7 AND meanEntropy < model's highEntropyThreshold:
//     → Promote to validated skill
//     → Merge recipe fields (use mode for categorical, median for numerical)
```

---

## Rate Limiting

Simple IP-based rate limiting using in-memory Map:

- 100 requests/minute per IP for POST
- 300 requests/minute per IP for GET
- Response: `429 Too Many Requests` with `Retry-After` header
- Map entries expire after 60 seconds

No Redis, no external deps. For a Pi serving the early community, this is sufficient.

---

## Environment

```env
# .env
PORT=3000
RA_SIGNING_KEY=your-hmac-signing-key-here
DB_PATH=./data/telemetry.db
AGGREGATION_INTERVAL_HOURS=6
AGGREGATION_REPORT_THRESHOLD=100
```

---

## Docker

### Dockerfile

```dockerfile
FROM oven/bun:1.1-alpine

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

COPY src/ ./src/
COPY tsconfig.json ./

# Data directory for SQLite
RUN mkdir -p /data

ENV PORT=3000
ENV DB_PATH=/data/telemetry.db

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
```

### docker-compose.yml

```yaml
services:
  telemetry:
    build: .
    container_name: reactive-telemetry
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - telemetry-data:/data
    environment:
      - PORT=3000
      - RA_SIGNING_KEY=${RA_SIGNING_KEY}
      - DB_PATH=/data/telemetry.db
      - AGGREGATION_INTERVAL_HOURS=6
      - AGGREGATION_REPORT_THRESHOLD=100
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  telemetry-data:
    driver: local
```

### Deploy on Pi

```bash
git clone git@github.com:tylerjrbuell/reactive-telemetry.git
cd reactive-telemetry
cp .env.example .env
# Edit .env: set RA_SIGNING_KEY
docker compose up -d
# Verify:
curl http://localhost:3000/health
```

---

## Cloudflare Tunnel Setup

You already have a tunnel running for `analytics.reactiveagents.dev`. Add the telemetry API as a second public hostname on the same tunnel — no new tunnel needed.

### 1. Add hostname to existing tunnel

```bash
# On the Pi, edit the tunnel config
# (usually at ~/.cloudflared/config.yml or /etc/cloudflared/config.yml)
```

Add an ingress entry for the telemetry service:

```yaml
tunnel: <your-existing-tunnel-id>
credentials-file: /path/to/credentials.json

ingress:
  # Existing: analytics dashboard
  - hostname: analytics.reactiveagents.dev
    service: http://localhost:<analytics-port>

  # New: telemetry API
  - hostname: api.reactiveagents.dev
    service: http://localhost:3000

  # Catch-all (required by cloudflared)
  - service: http_status:404
```

### 2. Add DNS record in Cloudflare dashboard

1. Go to Cloudflare dashboard → `reactiveagents.dev` → DNS
2. Add record:
   - Type: `CNAME`
   - Name: `api`
   - Target: `<your-tunnel-id>.cfargotunnel.com`
   - Proxy: ON (orange cloud)

This is the same pattern as your `analytics` subdomain — just a new CNAME pointing to the same tunnel.

### 3. Restart cloudflared to pick up the new ingress

```bash
sudo systemctl restart cloudflared
# Or if running as a Docker container:
docker restart cloudflared
```

### 4. Verify

```bash
curl https://api.reactiveagents.dev/health
# → { "status": "ok", "uptime": ..., "dbSizeBytes": ... }
```

### 5. Update telemetry endpoint

The framework's default telemetry endpoint should point to:
```
https://api.reactiveagents.dev/v1/reports
```

### Cloudflare settings (recommended)

In Cloudflare dashboard → `reactiveagents.dev` → SSL/TLS:
- Mode: **Full (strict)** — Cloudflare handles TLS, tunnel is encrypted end-to-end
- Minimum TLS version: **1.2**

Under Security → WAF:
- Rate limiting is handled in-app (100 req/min), but you can add a Cloudflare rule as a second layer: Block IPs with >200 requests/minute to `/v1/reports`

Under Caching:
- Cache GET endpoints (`/v1/profiles/*`, `/v1/skills`, `/v1/stats`) with a 5-minute TTL
- Never cache POST (`/v1/reports`) — this is the default

---

## Repo Name

**`reactive-telemetry`** — short, clear, matches the domain purpose. Repo at `github.com/tylerjrbuell/reactive-telemetry`.

---

## What's NOT in scope (v1)

- Web UI / dashboard (data is API-only for now)
- User accounts or API keys
- Skill marketplace browsing experience
- Automated deployment / CI/CD (manual docker compose on Pi)
- Backup automation (manual SQLite file copy)
- Geographic distribution / CDN
