// Run: bun run repo test packages/trace/tests/trace-redaction-patterns.test.ts
//
// Security audit M7: trace redaction covers modern provider keys, PEM blocks,
// Basic/Bearer headers and secret assignments; trace files/dirs are owner-only.
import { describe, test, expect, afterAll } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactSecrets } from "@reactive-agents/observability";

import { traceRedactors } from "../src/redaction.js";
import { TraceRecorderService, TraceRecorderServiceLive } from "../src/recorder.js";
import type { TraceEvent } from "../src/events.js";

const A = (n: number) => "A1b2C3d4E5".repeat(Math.ceil(n / 10)).slice(0, n);

interface Case {
  readonly redactor: string;
  readonly secret: string;
  readonly label: string;
}

const CASES: readonly Case[] = [
  { redactor: "openai-project-key", secret: `sk-proj-${A(30)}-${A(30)}_${A(20)}`, label: "sk-proj with - and _" },
  { redactor: "github-fine-grained-pat", secret: `github_pat_${A(22)}_${A(40)}`, label: "github_pat_" },
  { redactor: "github-token", secret: `gho_${A(36)}`, label: "gho_" },
  { redactor: "github-token", secret: `ghp_${A(36)}`, label: "ghp_" },
  { redactor: "github-token", secret: `ghs_${A(36)}`, label: "ghs_" },
  { redactor: "slack-token", secret: "xoxb-1234567890-0987654321-AbCdEfGhIjKl", label: "slack xoxb" },
  { redactor: "slack-token", secret: "xoxp-1234567890-0987654321-AbCdEfGhIjKl", label: "slack xoxp" },
  { redactor: "stripe-key", secret: `sk_live_${A(24)}`, label: "stripe sk_live_" },
  { redactor: "stripe-key", secret: `rk_test_${A(24)}`, label: "stripe rk_test_" },
  { redactor: "openrouter-key", secret: `sk-or-v1-${A(40)}`, label: "openrouter" },
  { redactor: "groq-key", secret: `gsk_${A(40)}`, label: "groq" },
  { redactor: "xai-key", secret: `xai-${A(40)}`, label: "xai" },
  {
    redactor: "pem-private-key",
    secret: "-----BEGIN RSA PRIVATE KEY-----\\nMIIEowIBAAKCAQEAxyz123\\nabcdef==\\n-----END RSA PRIVATE KEY-----",
    label: "PEM RSA",
  },
  {
    redactor: "pem-private-key",
    secret: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEF\n-----END PRIVATE KEY-----",
    label: "PEM PKCS8",
  },
  { redactor: "basic-auth", secret: "Basic YWRtaW46cGFzc3dvcmQ=", label: "Basic with =" },
  { redactor: "basic-auth", secret: "Basic dXNlcjpQYXNzMTIz", label: "Basic mixed case" },
  { redactor: "bearer-token", secret: "Bearer abcdEFGH12345678", label: "Bearer" },
  { redactor: "secret-assignment", secret: "hunter2hunter2", label: "password=" },
  { redactor: "secret-assignment", secret: "s3cr3tvalue", label: "secret=" },
  { redactor: "secret-assignment", secret: "tok3nvalue99", label: "token=" },
];

const OVERLAP: Readonly<Record<string, readonly string[]>> = {
  "ghp_": ["github-pat"],
  "ghs_": ["github-actions"],
};

const ASSIGN: Readonly<Record<string, string>> = {
  "password=": "password=",
  "secret=": "secret=",
  "token=": "GITHUB_TOKEN=",
};

const wrap = (c: Case): string =>
  c.redactor === "secret-assignment" ? `${ASSIGN[c.label]}${c.secret}` : `x ${c.secret} y`;

const secretCore = (c: Case): string =>
  c.redactor === "pem-private-key" ? "MIIE" : c.redactor === "secret-assignment" ? c.secret : c.secret.split(/[ -]/).pop() ?? c.secret;

describe("trace redaction patterns", () => {
  for (const c of CASES) {
    test(`redacts ${c.label}`, () => {
      const out = redactSecrets(wrap(c), traceRedactors);
      expect(out).not.toContain(secretCore(c));
      expect(out).toContain("[redacted");
    });

    test(`cutting ${c.redactor} lets ${c.label} through`, () => {
      // ghp_/ghs_ are also covered by the shared defaults: cut those too.
      const names = new Set([c.redactor, ...(OVERLAP[c.label] ?? [])]);
      const cut = traceRedactors.filter((r) => !names.has(r.name));
      expect(cut.length).toBe(traceRedactors.length - names.size);
      const out = redactSecrets(wrap(c), cut);
      expect(out).toContain(secretCore(c));
    });
  }

  test("redacted names are unique", () => {
    const names = traceRedactors.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("leaves ordinary text alone", () => {
    const text =
      "Basic understanding of the task-runner; the sk-learn skeleton, ask_user tool, risk_level=3, " +
      "maxTokens=100, xaid-less, Bearer of bad news, password policy, token budget, " +
      "ghost_writer, github_page, gsk_short, sk_live_x";
    expect(redactSecrets(text, traceRedactors)).toBe(text);
  });

  test("scans adversarial input in linear-ish time", () => {
    const inputs = [
      "-----BEGIN PRIVATE KEY-----".repeat(5000),
      "Basic " + "A".repeat(200000),
      "Bearer " + "a".repeat(200000),
      "token=" + "x".repeat(200000),
      "sk-proj-" + "a".repeat(200000),
      "Basic     ".repeat(20000),
    ];
    for (const i of inputs) {
      const t = performance.now();
      redactSecrets(i, traceRedactors);
      expect(performance.now() - t).toBeLessThan(2000);
    }
  });
});

describe("trace file permissions", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const d of roots) rmSync(d, { recursive: true, force: true });
  });

  test("creates trace dir 0700 and file 0600", async () => {
    const root = mkdtempSync(join(tmpdir(), "rax-trace-perm-"));
    roots.push(root);
    const dir = join(root, "nested", "traces");
    const runId = "run-perm-1";
    const ev: TraceEvent = {
      runId,
      timestamp: 1,
      iter: -1,
      seq: 0,
      kind: "run-started",
      task: "hi",
      model: "m",
      provider: "p",
      config: {},
    };
    await Effect.gen(function* () {
      const rec = yield* TraceRecorderService;
      yield* rec.emit(ev);
      yield* rec.flush(runId);
    }).pipe(Effect.provide(TraceRecorderServiceLive({ dir })), Effect.runPromise);

    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, `${runId}.jsonl`)).mode & 0o777).toBe(0o600);
  }, 15000);
});
