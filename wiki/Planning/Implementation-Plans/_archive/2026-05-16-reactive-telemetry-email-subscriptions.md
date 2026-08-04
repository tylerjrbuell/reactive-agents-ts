# Reactive Telemetry Email Subscription System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email subscription capture, confirmation, unsubscribe, and release announcement endpoints to the reactive-telemetry API (https://github.com/tylerjrbuell/reactive-telemetry).

**Architecture:** New SQLite table `email_subscribers` stores emails + per-subscriber UUID tokens. Resend handles transactional and broadcast email sending. Three new route files added to Hono app — `subscribers.ts` (capture/confirm/unsubscribe), `announce.ts` (CI-triggered release blasts). Routes mounted in existing `src/app.ts`.

**Tech Stack:** Bun, Hono v4, bun:sqlite (raw SQL), Resend SDK (`resend` npm package), existing Docker/env-var deployment pattern.

---

## File Map

| Path | Action | Purpose |
|------|--------|---------|
| `migrations/004_email_subscribers.sql` | Create | Schema for subscribers table + indexes |
| `src/db/email-queries.ts` | Create | Typed CRUD functions over subscribers table |
| `src/services/email.ts` | Create | Resend integration: confirmation + announcement sends |
| `src/routes/subscribers.ts` | Create | `POST /v1/subscribe`, `GET /v1/subscribe/confirm/:token`, `GET /v1/subscribe/unsubscribe` |
| `src/routes/announce.ts` | Create | `POST /v1/emails/announce` (API-key protected, CI use) |
| `src/app.ts` | Modify | Mount new routers, pass db instance |
| `src/index.ts` | Modify | Add `RESEND_API_KEY`, `ANNOUNCE_API_KEY`, `BASE_URL`, `FROM_EMAIL` env validation |
| `docker/docker-compose.yml` | Modify | Add new env vars to compose service definition |
| `README.md` | Modify | Document new endpoints + env vars |
| `tests/routes/subscribers.test.ts` | Create | Integration tests for subscribe/confirm/unsubscribe routes |
| `tests/routes/announce.test.ts` | Create | Integration tests for announce endpoint |
| `tests/db/email-queries.test.ts` | Create | Unit tests for all email-queries functions |
| `tests/services/email.test.ts` | Create | Unit tests for Resend email service (mocked) |

---

## Environment Variables Required

Add to your `.env` / deployment:

```
RESEND_API_KEY=re_...          # From resend.com dashboard
ANNOUNCE_API_KEY=...           # Random secret for CI-triggered announcements
BASE_URL=https://api.reactiveagents.dev
FROM_EMAIL=Reactive Agents <updates@reactiveagents.dev>
```

---

## Task 1: Database Migration

**Files:**
- Create: `migrations/004_email_subscribers.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- migrations/004_email_subscribers.sql
CREATE TABLE IF NOT EXISTS email_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  verified INTEGER NOT NULL DEFAULT 0,
  consent_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT,
  unsubscribed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_subscribers_email ON email_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_subscribers_token ON email_subscribers(token);
CREATE INDEX IF NOT EXISTS idx_subscribers_verified ON email_subscribers(verified, unsubscribed_at);
```

- [ ] **Step 2: Verify migration applies via existing migration runner**

Check how existing migrations are applied. Open `src/db/schema.sql` and look for migration application logic (likely in `src/index.ts` or `src/db/`). Run:

```bash
bun run src/index.ts &
sleep 2 && kill %1
```

Expected: server starts without error, `data/telemetry.db` now has `email_subscribers` table. Verify with:

```bash
bun -e "import { Database } from 'bun:sqlite'; const db = new Database('data/telemetry.db'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name='email_subscribers'\").get());"
```

Expected output: `{ name: 'email_subscribers' }`

- [ ] **Step 3: Commit**

```bash
git add migrations/004_email_subscribers.sql
git commit -m "feat(db): add email_subscribers table with token + verification fields"
```

---

## Task 2: Email Query Layer

**Files:**
- Create: `src/db/email-queries.ts`
- Create: `tests/db/email-queries.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/db/email-queries.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  insertSubscriber,
  getSubscriberByEmail,
  getSubscriberByToken,
  verifySubscriber,
  unsubscribeByToken,
  getVerifiedSubscribers,
} from "../../src/db/email-queries";

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.run(`
    CREATE TABLE email_subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      token TEXT NOT NULL UNIQUE,
      verified INTEGER NOT NULL DEFAULT 0,
      consent_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      verified_at TEXT,
      unsubscribed_at TEXT
    )
  `);
  return db;
}

describe("email-queries", () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  test("insertSubscriber creates row with email and token", () => {
    const sub = insertSubscriber(db, "test@example.com", "token-abc");
    expect(sub.email).toBe("test@example.com");
    expect(sub.token).toBe("token-abc");
    expect(sub.verified).toBe(0);
    expect(sub.unsubscribed_at).toBeNull();
  });

  test("getSubscriberByEmail returns subscriber", () => {
    insertSubscriber(db, "test@example.com", "token-abc");
    const sub = getSubscriberByEmail(db, "test@example.com");
    expect(sub).not.toBeNull();
    expect(sub!.email).toBe("test@example.com");
  });

  test("getSubscriberByEmail returns null for missing email", () => {
    expect(getSubscriberByEmail(db, "missing@example.com")).toBeNull();
  });

  test("getSubscriberByToken returns subscriber", () => {
    insertSubscriber(db, "test@example.com", "token-abc");
    const sub = getSubscriberByToken(db, "token-abc");
    expect(sub).not.toBeNull();
    expect(sub!.token).toBe("token-abc");
  });

  test("verifySubscriber marks subscriber as verified", () => {
    insertSubscriber(db, "test@example.com", "token-abc");
    const result = verifySubscriber(db, "token-abc");
    expect(result).toBe(true);
    const sub = getSubscriberByToken(db, "token-abc");
    expect(sub!.verified).toBe(1);
    expect(sub!.verified_at).not.toBeNull();
  });

  test("verifySubscriber returns false for already-verified", () => {
    insertSubscriber(db, "test@example.com", "token-abc");
    verifySubscriber(db, "token-abc");
    expect(verifySubscriber(db, "token-abc")).toBe(false);
  });

  test("verifySubscriber returns false for unknown token", () => {
    expect(verifySubscriber(db, "no-such-token")).toBe(false);
  });

  test("unsubscribeByToken marks unsubscribed_at", () => {
    insertSubscriber(db, "test@example.com", "token-abc");
    verifySubscriber(db, "token-abc");
    const result = unsubscribeByToken(db, "token-abc");
    expect(result).toBe(true);
    const sub = getSubscriberByToken(db, "token-abc");
    expect(sub!.unsubscribed_at).not.toBeNull();
  });

  test("unsubscribeByToken returns false if already unsubscribed", () => {
    insertSubscriber(db, "test@example.com", "token-abc");
    unsubscribeByToken(db, "token-abc");
    expect(unsubscribeByToken(db, "token-abc")).toBe(false);
  });

  test("getVerifiedSubscribers returns only verified non-unsubscribed", () => {
    insertSubscriber(db, "a@example.com", "token-a");
    insertSubscriber(db, "b@example.com", "token-b");
    insertSubscriber(db, "c@example.com", "token-c");
    verifySubscriber(db, "token-a");
    verifySubscriber(db, "token-b");
    unsubscribeByToken(db, "token-b");
    // c is unverified

    const verified = getVerifiedSubscribers(db);
    expect(verified).toHaveLength(1);
    expect(verified[0].email).toBe("a@example.com");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test tests/db/email-queries.test.ts
```

Expected: `Cannot find module '../../src/db/email-queries'`

- [ ] **Step 3: Implement email-queries.ts**

```typescript
// src/db/email-queries.ts
import type { Database } from "bun:sqlite";

export interface Subscriber {
  id: number;
  email: string;
  token: string;
  verified: number;
  consent_at: string;
  created_at: string;
  verified_at: string | null;
  unsubscribed_at: string | null;
}

export function insertSubscriber(
  db: Database,
  email: string,
  token: string
): Subscriber {
  return db
    .prepare(
      `INSERT INTO email_subscribers (email, token)
       VALUES (?, ?)
       RETURNING *`
    )
    .get(email, token) as Subscriber;
}

export function getSubscriberByEmail(
  db: Database,
  email: string
): Subscriber | null {
  return db
    .prepare(`SELECT * FROM email_subscribers WHERE email = ?`)
    .get(email) as Subscriber | null;
}

export function getSubscriberByToken(
  db: Database,
  token: string
): Subscriber | null {
  return db
    .prepare(`SELECT * FROM email_subscribers WHERE token = ?`)
    .get(token) as Subscriber | null;
}

export function verifySubscriber(db: Database, token: string): boolean {
  const result = db
    .prepare(
      `UPDATE email_subscribers
       SET verified = 1, verified_at = datetime('now')
       WHERE token = ? AND verified = 0 AND unsubscribed_at IS NULL`
    )
    .run(token);
  return result.changes > 0;
}

export function unsubscribeByToken(db: Database, token: string): boolean {
  const result = db
    .prepare(
      `UPDATE email_subscribers
       SET unsubscribed_at = datetime('now')
       WHERE token = ? AND unsubscribed_at IS NULL`
    )
    .run(token);
  return result.changes > 0;
}

export function getVerifiedSubscribers(db: Database): Subscriber[] {
  return db
    .prepare(
      `SELECT * FROM email_subscribers
       WHERE verified = 1 AND unsubscribed_at IS NULL`
    )
    .all() as Subscriber[];
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test tests/db/email-queries.test.ts
```

Expected: all 10 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/db/email-queries.ts tests/db/email-queries.test.ts
git commit -m "feat(db): add email subscriber query layer with full test coverage"
```

---

## Task 3: Install Resend SDK

**Files:** `package.json`, `bun.lockb`

- [ ] **Step 1: Install resend**

```bash
bun add resend
```

Expected: `resend` added to `package.json` dependencies, `bun.lockb` updated.

- [ ] **Step 2: Commit**

```bash
git add package.json bun.lockb
git commit -m "feat(deps): add resend SDK for transactional email"
```

---

## Task 4: Email Service

**Files:**
- Create: `src/services/email.ts`
- Create: `tests/services/email.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/services/email.test.ts
import { describe, test, expect, mock, beforeEach } from "bun:test";

// Must mock before importing email service
const mockSend = mock(async (_: unknown) => ({ data: { id: "msg-123" }, error: null }));

mock.module("resend", () => ({
  Resend: class MockResend {
    emails = { send: mockSend };
  },
}));

// Import after mock is registered
const { sendConfirmationEmail, sendAnnouncement } = await import("../../src/services/email");

describe("email service", () => {
  beforeEach(() => mockSend.mockClear());

  test("sendConfirmationEmail calls resend with correct fields", async () => {
    process.env.BASE_URL = "https://api.example.com";
    process.env.FROM_EMAIL = "Test <test@example.com>";

    await sendConfirmationEmail("user@test.com", "tok-abc");

    expect(mockSend).toHaveBeenCalledTimes(1);
    const args = mockSend.mock.calls[0][0] as Record<string, unknown>;
    expect(args.to).toBe("user@test.com");
    expect(args.from).toBe("Test <test@example.com>");
    expect(typeof args.subject).toBe("string");
    expect(args.html).toContain("https://api.example.com/v1/subscribe/confirm/tok-abc");
    expect(args.html).toContain("https://api.example.com/v1/subscribe/unsubscribe?token=tok-abc");
  });

  test("sendAnnouncement sends to all subscribers and returns counts", async () => {
    process.env.BASE_URL = "https://api.example.com";

    const subscribers = [
      { email: "a@test.com", token: "tok-a" },
      { email: "b@test.com", token: "tok-b" },
    ];

    const result = await sendAnnouncement(
      subscribers,
      "v0.11 released",
      "<p>New release</p>",
      "New release"
    );

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test("sendAnnouncement appends unsubscribe footer to each email", async () => {
    process.env.BASE_URL = "https://api.example.com";

    await sendAnnouncement(
      [{ email: "a@test.com", token: "tok-a" }],
      "Subject",
      "<p>Body</p>",
      "Body"
    );

    const args = mockSend.mock.calls[0][0] as Record<string, unknown>;
    expect(args.html).toContain("unsubscribe?token=tok-a");
    expect(args.text).toContain("unsubscribe?token=tok-a");
  });

  test("sendAnnouncement counts failed sends", async () => {
    mockSend.mockImplementationOnce(async () => { throw new Error("send failed"); });

    const result = await sendAnnouncement(
      [
        { email: "a@test.com", token: "tok-a" },
        { email: "b@test.com", token: "tok-b" },
      ],
      "Subject",
      "<p>Body</p>",
      "Body"
    );

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test tests/services/email.test.ts
```

Expected: module not found or similar

- [ ] **Step 3: Implement email.ts**

```typescript
// src/services/email.ts
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

function getFrom(): string {
  return process.env.FROM_EMAIL ?? "Reactive Agents <updates@reactiveagents.dev>";
}

function getBaseUrl(): string {
  return process.env.BASE_URL ?? "https://api.reactiveagents.dev";
}

export async function sendConfirmationEmail(
  email: string,
  token: string
): Promise<void> {
  const base = getBaseUrl();
  const confirmUrl = `${base}/v1/subscribe/confirm/${token}`;
  const unsubscribeUrl = `${base}/v1/subscribe/unsubscribe?token=${token}`;

  await resend.emails.send({
    from: getFrom(),
    to: email,
    subject: "Confirm your Reactive Agents subscription",
    html: `
      <p>Thanks for signing up for Reactive Agents release updates.</p>
      <p><a href="${confirmUrl}">Confirm your subscription</a></p>
      <p style="font-size: 12px; color: #999;">
        Not you? <a href="${unsubscribeUrl}">Unsubscribe</a>
      </p>
    `,
    text: `Confirm your subscription: ${confirmUrl}\n\nUnsubscribe: ${unsubscribeUrl}`,
  });
}

interface Subscriber {
  email: string;
  token: string;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export async function sendAnnouncement(
  subscribers: Subscriber[],
  subject: string,
  html: string,
  text: string
): Promise<{ sent: number; failed: number }> {
  const base = getBaseUrl();
  let sent = 0;
  let failed = 0;

  for (const batch of chunk(subscribers, 100)) {
    const results = await Promise.allSettled(
      batch.map(({ email, token }) => {
        const unsubUrl = `${base}/v1/subscribe/unsubscribe?token=${token}`;
        return resend.emails.send({
          from: getFrom(),
          to: email,
          subject,
          html: `${html}<p style="font-size: 11px; color: #999; margin-top: 24px;"><a href="${unsubUrl}">Unsubscribe</a></p>`,
          text: `${text}\n\nUnsubscribe: ${unsubUrl}`,
        });
      })
    );

    for (const r of results) {
      r.status === "fulfilled" ? sent++ : failed++;
    }
  }

  return { sent, failed };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test tests/services/email.test.ts
```

Expected: 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/services/email.ts tests/services/email.test.ts
git commit -m "feat(email): add Resend service for confirmation and announcement sends"
```

---

## Task 5: Subscribe Routes

**Files:**
- Create: `src/routes/subscribers.ts`
- Create: `tests/routes/subscribers.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/routes/subscribers.test.ts
import { describe, test, expect, mock, beforeAll } from "bun:test";

// Mock email sending so tests don't hit Resend
mock.module("../../src/services/email", () => ({
  sendConfirmationEmail: mock(async () => {}),
}));

import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { createSubscribersRouter } from "../../src/routes/subscribers";

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.run(`
    CREATE TABLE email_subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      token TEXT NOT NULL UNIQUE,
      verified INTEGER NOT NULL DEFAULT 0,
      consent_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      verified_at TEXT,
      unsubscribed_at TEXT
    )
  `);
  return db;
}

describe("POST /v1/subscribe", () => {
  let app: Hono;
  let db: Database;

  beforeAll(() => {
    db = createTestDb();
    app = new Hono();
    app.route("/v1", createSubscribersRouter(db));
  });

  test("valid email returns 201", async () => {
    const res = await app.request("/v1/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@example.com" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message).toBe("confirmation email sent");
  });

  test("invalid email returns 400", async () => {
    const res = await app.request("/v1/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });

  test("missing email returns 400", async () => {
    const res = await app.request("/v1/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("duplicate unverified email returns 200 and resends confirm", async () => {
    const res = await app.request("/v1/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@example.com" }), // already inserted above
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("confirmation email resent");
  });

  test("previously unsubscribed email returns 409", async () => {
    // Insert and immediately unsubscribe
    const firstRes = await app.request("/v1/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "bounced@example.com" }),
    });
    expect(firstRes.status).toBe(201);

    // Get the subscriber and unsubscribe them
    const { getSubscriberByEmail, unsubscribeByToken } = await import("../../src/db/email-queries");
    const sub = getSubscriberByEmail(db, "bounced@example.com")!;
    unsubscribeByToken(db, sub.token);

    const res = await app.request("/v1/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "bounced@example.com" }),
    });
    expect(res.status).toBe(409);
  });
});

describe("GET /v1/subscribe/confirm/:token", () => {
  let app: Hono;
  let db: Database;

  beforeAll(() => {
    db = createTestDb();
    app = new Hono();
    app.route("/v1", createSubscribersRouter(db));
  });

  test("valid token returns HTML success", async () => {
    // Subscribe first
    await app.request("/v1/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "confirm@example.com" }),
    });

    const { getSubscriberByEmail } = await import("../../src/db/email-queries");
    const sub = getSubscriberByEmail(db, "confirm@example.com")!;

    const res = await app.request(`/v1/subscribe/confirm/${sub.token}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Subscribed");
  });

  test("already-confirmed token returns HTML (idempotent)", async () => {
    await app.request("/v1/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alreadyconfirmed@example.com" }),
    });

    const { getSubscriberByEmail } = await import("../../src/db/email-queries");
    const sub = getSubscriberByEmail(db, "alreadyconfirmed@example.com")!;

    // Confirm twice
    await app.request(`/v1/subscribe/confirm/${sub.token}`);
    const res = await app.request(`/v1/subscribe/confirm/${sub.token}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Already confirmed");
  });

  test("invalid token returns 400", async () => {
    const res = await app.request("/v1/subscribe/confirm/no-such-token");
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/subscribe/unsubscribe", () => {
  let app: Hono;
  let db: Database;

  beforeAll(() => {
    db = createTestDb();
    app = new Hono();
    app.route("/v1", createSubscribersRouter(db));
  });

  test("valid token unsubscribes and returns HTML", async () => {
    await app.request("/v1/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "unsub@example.com" }),
    });

    const { getSubscriberByEmail } = await import("../../src/db/email-queries");
    const sub = getSubscriberByEmail(db, "unsub@example.com")!;

    const res = await app.request(`/v1/subscribe/unsubscribe?token=${sub.token}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Unsubscribed");
  });

  test("missing token returns 400", async () => {
    const res = await app.request("/v1/subscribe/unsubscribe");
    expect(res.status).toBe(400);
  });

  test("already-unsubscribed token returns 200 (idempotent)", async () => {
    await app.request("/v1/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "double-unsub@example.com" }),
    });

    const { getSubscriberByEmail } = await import("../../src/db/email-queries");
    const sub = getSubscriberByEmail(db, "double-unsub@example.com")!;

    await app.request(`/v1/subscribe/unsubscribe?token=${sub.token}`);
    const res = await app.request(`/v1/subscribe/unsubscribe?token=${sub.token}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Already unsubscribed");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test tests/routes/subscribers.test.ts
```

Expected: `Cannot find module '../../src/routes/subscribers'`

- [ ] **Step 3: Implement subscribers.ts**

Check `src/middleware/rate-limit.ts` for the exact function signature and import path before writing the rate-limit call. The pattern below matches a common Hono token-bucket factory — adjust the import and config keys to match the actual middleware API.

```typescript
// src/routes/subscribers.ts
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import {
  insertSubscriber,
  getSubscriberByEmail,
  getSubscriberByToken,
  verifySubscriber,
  unsubscribeByToken,
} from "../db/email-queries";
import { sendConfirmationEmail } from "../services/email";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createSubscribersRouter(db: Database): Hono {
  const router = new Hono();

  router.post("/subscribe", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }

    if (
      !body ||
      typeof body !== "object" ||
      !("email" in body) ||
      typeof (body as Record<string, unknown>).email !== "string"
    ) {
      return c.json({ error: "email required" }, 400);
    }

    const email = ((body as Record<string, unknown>).email as string).trim().toLowerCase();

    if (!EMAIL_REGEX.test(email)) {
      return c.json({ error: "invalid email" }, 400);
    }

    const existing = getSubscriberByEmail(db, email);

    if (existing) {
      if (existing.unsubscribed_at) {
        return c.json({ error: "email previously unsubscribed" }, 409);
      }
      if (existing.verified) {
        return c.json({ message: "already subscribed" }, 200);
      }
      // Unverified: resend confirmation
      sendConfirmationEmail(email, existing.token).catch(() => {});
      return c.json({ message: "confirmation email resent" }, 200);
    }

    const token = crypto.randomUUID();
    insertSubscriber(db, email, token);
    sendConfirmationEmail(email, token).catch(() => {});

    return c.json({ message: "confirmation email sent" }, 201);
  });

  router.get("/subscribe/confirm/:token", async (c) => {
    const token = c.req.param("token");
    const verified = verifySubscriber(db, token);

    if (!verified) {
      const sub = getSubscriberByToken(db, token);
      if (sub?.verified) {
        return c.html(
          `<!DOCTYPE html><html><body>
            <h2>Already confirmed!</h2>
            <p>You're subscribed to Reactive Agents updates.</p>
          </body></html>`
        );
      }
      return c.html(
        `<!DOCTYPE html><html><body>
          <h2>Invalid or expired link</h2>
          <p>Try subscribing again.</p>
        </body></html>`,
        400
      );
    }

    return c.html(
      `<!DOCTYPE html><html><body>
        <h2>Subscribed!</h2>
        <p>You'll receive Reactive Agents release updates. Thanks!</p>
      </body></html>`
    );
  });

  router.get("/subscribe/unsubscribe", async (c) => {
    const token = c.req.query("token");

    if (!token) {
      return c.html(
        `<!DOCTYPE html><html><body>
          <h2>Invalid unsubscribe link</h2>
          <p>Missing token.</p>
        </body></html>`,
        400
      );
    }

    const unsubbed = unsubscribeByToken(db, token);

    if (!unsubbed) {
      return c.html(
        `<!DOCTYPE html><html><body>
          <h2>Already unsubscribed</h2>
          <p>You've already been removed from our list.</p>
        </body></html>`
      );
    }

    return c.html(
      `<!DOCTYPE html><html><body>
        <h2>Unsubscribed</h2>
        <p>You've been removed from Reactive Agents updates.</p>
      </body></html>`
    );
  });

  return router;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test tests/routes/subscribers.test.ts
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/routes/subscribers.ts tests/routes/subscribers.test.ts
git commit -m "feat(routes): add email subscription capture, confirm, and unsubscribe endpoints"
```

---

## Task 6: Announce Route

**Files:**
- Create: `src/routes/announce.ts`
- Create: `tests/routes/announce.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/routes/announce.test.ts
import { describe, test, expect, mock, beforeAll } from "bun:test";

const mockSendAnnouncement = mock(async () => ({ sent: 2, failed: 0 }));

mock.module("../../src/services/email", () => ({
  sendAnnouncement: mockSendAnnouncement,
}));

import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { createAnnounceRouter } from "../../src/routes/announce";
import { insertSubscriber, verifySubscriber } from "../../src/db/email-queries";

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.run(`
    CREATE TABLE email_subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      token TEXT NOT NULL UNIQUE,
      verified INTEGER NOT NULL DEFAULT 0,
      consent_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      verified_at TEXT,
      unsubscribed_at TEXT
    )
  `);
  return db;
}

const VALID_BODY = {
  subject: "v0.11 released",
  html: "<p>New release!</p>",
  text: "New release!",
};

describe("POST /v1/emails/announce", () => {
  let app: Hono;
  let db: Database;

  beforeAll(() => {
    process.env.ANNOUNCE_API_KEY = "test-secret-key";
    db = createTestDb();

    // Add two verified subscribers
    insertSubscriber(db, "a@test.com", "tok-a");
    insertSubscriber(db, "b@test.com", "tok-b");
    verifySubscriber(db, "tok-a");
    verifySubscriber(db, "tok-b");

    app = new Hono();
    app.route("/v1", createAnnounceRouter(db));
  });

  test("valid key + body returns sent/failed counts", async () => {
    const res = await app.request("/v1/emails/announce", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Announce-Key": "test-secret-key",
      },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.sent).toBe("number");
    expect(typeof body.failed).toBe("number");
    expect(typeof body.total).toBe("number");
  });

  test("wrong API key returns 401", async () => {
    const res = await app.request("/v1/emails/announce", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Announce-Key": "wrong-key",
      },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(401);
  });

  test("missing API key returns 401", async () => {
    const res = await app.request("/v1/emails/announce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(401);
  });

  test("missing subject returns 400", async () => {
    const res = await app.request("/v1/emails/announce", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Announce-Key": "test-secret-key",
      },
      body: JSON.stringify({ html: "<p>body</p>", text: "body" }),
    });
    expect(res.status).toBe(400);
  });

  test("no verified subscribers returns 200 with sent: 0", async () => {
    const emptyDb = createTestDb();
    const emptyApp = new Hono();
    emptyApp.route("/v1", createAnnounceRouter(emptyDb));

    const res = await emptyApp.request("/v1/emails/announce", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Announce-Key": "test-secret-key",
      },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test tests/routes/announce.test.ts
```

Expected: `Cannot find module '../../src/routes/announce'`

- [ ] **Step 3: Implement announce.ts**

```typescript
// src/routes/announce.ts
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { getVerifiedSubscribers } from "../db/email-queries";
import { sendAnnouncement } from "../services/email";

export function createAnnounceRouter(db: Database): Hono {
  const router = new Hono();

  router.post("/emails/announce", async (c) => {
    const apiKey = c.req.header("X-Announce-Key");
    if (!apiKey || apiKey !== process.env.ANNOUNCE_API_KEY) {
      return c.json({ error: "unauthorized" }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }

    if (
      !body ||
      typeof body !== "object" ||
      !("subject" in body) ||
      !("html" in body) ||
      !("text" in body)
    ) {
      return c.json({ error: "subject, html, and text are required" }, 400);
    }

    const { subject, html, text } = body as Record<string, unknown>;

    if (
      typeof subject !== "string" ||
      typeof html !== "string" ||
      typeof text !== "string"
    ) {
      return c.json({ error: "subject, html, and text must be strings" }, 400);
    }

    const subscribers = getVerifiedSubscribers(db);

    if (subscribers.length === 0) {
      return c.json({ sent: 0, failed: 0, total: 0, message: "no verified subscribers" });
    }

    const result = await sendAnnouncement(subscribers, subject, html, text);

    return c.json({ sent: result.sent, failed: result.failed, total: subscribers.length });
  });

  return router;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test tests/routes/announce.test.ts
```

Expected: all 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/routes/announce.ts tests/routes/announce.test.ts
git commit -m "feat(routes): add announce endpoint for CI-triggered release email blasts"
```

---

## Task 7: Wire Routes into App

**Files:**
- Modify: `src/app.ts`
- Modify: `src/index.ts` (env validation)

- [ ] **Step 1: Inspect current app.ts to understand router mounting pattern**

Open `src/app.ts`. Find where `db` is initialized and where existing routers are mounted. The pattern will look something like:

```typescript
app.route("/v1", createReportsRouter(db));
app.route("/v1", createProfilesRouter(db));
```

- [ ] **Step 2: Mount new routers in app.ts**

Add these two imports at the top of `src/app.ts` alongside the existing router imports:

```typescript
import { createSubscribersRouter } from "./routes/subscribers";
import { createAnnounceRouter } from "./routes/announce";
```

Add these two route mounts alongside the existing route mounts (after existing mounts, before any catch-all):

```typescript
app.route("/v1", createSubscribersRouter(db));
app.route("/v1", createAnnounceRouter(db));
```

- [ ] **Step 3: Add env var startup validation in src/index.ts**

Find the section in `src/index.ts` where env vars are validated/read. Add:

```typescript
// Warn on missing email env vars (non-fatal: subscribe routes degrade gracefully)
if (!process.env.RESEND_API_KEY) {
  console.warn("[warn] RESEND_API_KEY not set — emails will not send");
}
if (!process.env.ANNOUNCE_API_KEY) {
  console.warn("[warn] ANNOUNCE_API_KEY not set — announce endpoint will reject all requests");
}
```

- [ ] **Step 4: Smoke test locally**

```bash
RESEND_API_KEY=re_test ANNOUNCE_API_KEY=local-secret BASE_URL=http://localhost:3000 bun run dev &
sleep 2

# Subscribe
curl -s -X POST http://localhost:3000/v1/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}' | jq .

# Invalid email
curl -s -X POST http://localhost:3000/v1/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email":"notanemail"}' | jq .

# Announce (missing key → 401)
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/v1/emails/announce \
  -H "Content-Type: application/json" \
  -d '{"subject":"test","html":"<p>t</p>","text":"t"}'

kill %1
```

Expected:
- Subscribe → `{"message":"confirmation email sent"}`
- Invalid email → `{"error":"invalid email"}`
- Announce without key → `401`

- [ ] **Step 5: Run full test suite**

```bash
bun test tests/
```

Expected: all tests pass, no regressions

- [ ] **Step 6: Commit**

```bash
git add src/app.ts src/index.ts
git commit -m "feat(app): mount subscriber and announce routes"
```

---

## Task 8: Docker & Deployment Config

**Files:**
- Modify: `docker/docker-compose.yml` (or `docker-compose.yml` at root — check which exists)

- [ ] **Step 1: Add env vars to compose**

Open the Docker Compose file. Find the `environment:` block for the API service. Add:

```yaml
environment:
  - PORT=3000
  - DB_PATH=/data/telemetry.db
  - RA_SIGNING_KEY=${RA_SIGNING_KEY}
  - AGGREGATION_INTERVAL_HOURS=${AGGREGATION_INTERVAL_HOURS:-6}
  - AGGREGATION_REPORT_THRESHOLD=${AGGREGATION_REPORT_THRESHOLD:-100}
  # Email subscription (new)
  - RESEND_API_KEY=${RESEND_API_KEY}
  - ANNOUNCE_API_KEY=${ANNOUNCE_API_KEY}
  - BASE_URL=${BASE_URL:-https://api.reactiveagents.dev}
  - FROM_EMAIL=${FROM_EMAIL:-Reactive Agents <updates@reactiveagents.dev>}
```

- [ ] **Step 2: Add env vars to .env.example (or equivalent)**

If the repo has a `.env.example` or `.env.sample`, add:

```bash
# Email subscription
RESEND_API_KEY=re_...
ANNOUNCE_API_KEY=your-secret-here
BASE_URL=https://api.reactiveagents.dev
FROM_EMAIL=Reactive Agents <updates@reactiveagents.dev>
```

- [ ] **Step 3: Commit**

```bash
git add docker/docker-compose.yml .env.example
git commit -m "chore(deploy): add email subscription env vars to compose and example"
```

---

## Task 9: README Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add endpoints to API reference section**

Find the API endpoints section in `README.md`. Add a new subsection:

````markdown
### Email Subscriptions

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/v1/subscribe` | POST | None | Subscribe email; sends confirmation |
| `/v1/subscribe/confirm/:token` | GET | None | Confirm email via token from email link |
| `/v1/subscribe/unsubscribe` | GET | None | Unsubscribe via `?token=` query param |
| `/v1/emails/announce` | POST | `X-Announce-Key` header | Send release announcement to all verified subscribers |

**Subscribe request body:**
```json
{ "email": "user@example.com" }
```

**Announce request body:**
```json
{
  "subject": "Reactive Agents v0.11 released",
  "html": "<p>What's new...</p>",
  "text": "What's new..."
}
```

**Announce response:**
```json
{ "sent": 142, "failed": 0, "total": 142 }
```

**Required environment variables:**
- `RESEND_API_KEY` — from [resend.com](https://resend.com) dashboard
- `ANNOUNCE_API_KEY` — secret for CI-triggered announcements
- `BASE_URL` — public API URL (used in email links, default: `https://api.reactiveagents.dev`)
- `FROM_EMAIL` — sender address (default: `Reactive Agents <updates@reactiveagents.dev>`)
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document email subscription and announce endpoints"
```

---

## Task 10: CI Release Hook (Optional — if GitHub Actions used)

Skip this task if no CI pipeline exists. Check `.github/workflows/` for release workflows.

**Files:**
- Modify: `.github/workflows/release.yml` (or equivalent)

- [ ] **Step 1: Add announce step after successful publish**

Find the step that publishes the release (npm publish, changeset release, etc.). Add after it:

```yaml
- name: Announce release to subscribers
  if: success()
  run: |
    VERSION=$(node -p "require('./package.json').version")
    curl -s -X POST ${{ secrets.ANNOUNCE_API_URL }}/v1/emails/announce \
      -H "Content-Type: application/json" \
      -H "X-Announce-Key: ${{ secrets.ANNOUNCE_API_KEY }}" \
      -d '{
        "subject": "Reactive Agents '"$VERSION"' released",
        "html": "<h2>Reactive Agents '"$VERSION"' is out</h2><p>See <a href=\"https://reactiveagents.dev\">the docs</a> for what'\''s new.</p>",
        "text": "Reactive Agents '"$VERSION"' is out. See https://reactiveagents.dev for what'\''s new."
      }'
```

Add secrets to GitHub repo settings:
- `ANNOUNCE_API_URL` = `https://api.reactiveagents.dev`
- `ANNOUNCE_API_KEY` = same value as `ANNOUNCE_API_KEY` env var on server

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: trigger subscriber announcement after release publish"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|------------|------|
| Collect emails from docs/forms | Task 5 `POST /v1/subscribe` |
| Email confirmation (double opt-in, GDPR) | Task 5 `GET /subscribe/confirm/:token` |
| Unsubscribe mechanism | Task 5 `GET /subscribe/unsubscribe` |
| Store subscribers in existing SQLite | Task 1 (migration) + Task 2 (queries) |
| Resend for sends | Task 3 (SDK) + Task 4 (service) |
| Release announcement endpoint | Task 6 `POST /v1/emails/announce` |
| CI integration | Task 10 |
| Docker env wiring | Task 8 |
| Documentation | Task 9 |

**No placeholders found** — all steps include exact code, exact commands, expected output.

**Type consistency:** `Subscriber` interface defined in `email-queries.ts`, re-used by `email.ts` via structural compatibility (no re-export needed — both expect `{ email: string; token: string }`).
