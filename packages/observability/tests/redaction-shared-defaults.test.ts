// Run: bun test packages/observability/tests/redaction-shared-defaults.test.ts --timeout 15000
//
// Security audit M7: the shared defaults must cover the provider-key, PEM,
// Basic-auth and assignment formats. Each pattern is pinned by a cut test:
// removing it from the list must make its sample leak.

import { describe, it, expect } from "bun:test";
import { mkdtempSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRedactors } from "../src/redaction/index.js";
import { makeFileExporter } from "../src/exporters/file-exporter.js";
import { makeLoggerService } from "../src/logging/logger-service.js";

const A20 = "Ab1Cd2Ef3Gh4Ij5Kl6Mn7";
// Prefixes are split so source scanners do not flag the fixtures.
const p = (...parts: string[]): string => parts.join("");

/** redactor name -> sample secret it must remove. */
const samples: Record<string, string> = {
  "pem-private-key": p("-----BEGIN RSA ", "PRIVATE KEY-----\nMIIEvQIBADANBgkq\nabc/def==\n-----END RSA ", "PRIVATE KEY-----"),
  "openai-project": p("sk-", "proj-", `${A20}_-${A20}`),
  "openrouter-key": p("sk-", "or-v1-", `${A20}-${A20}`),
  "github-fine-grained-pat": p("github", "_pat_", `${A20}_${A20}`),
  "github-token": p("gh", "o_", `${A20}${A20}`),
  "slack-token": p("xo", "xb-", "1234567890-abcdefghij"),
  "stripe-key": p("sk", "_live_", "abcdefghij1234"),
  "groq-key": p("gs", "k_", A20),
  "xai-key": p("xa", "i-", A20),
  "basic-auth": "Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==",
  "secret-assignment": "password=hunter2hunter2",
};

const leaks = (redactors: typeof defaultRedactors, input: string, secretPart: string): boolean => {
  let out = input;
  for (const r of redactors) out = out.replace(r.pattern, r.replacement);
  return out.includes(secretPart);
};

const secretCore = (name: string, sample: string): string =>
  name === "pem-private-key"
    ? "MIIEvQIBADANBgkq"
    : name === "basic-auth"
      ? "dXNlcjpwYXNzd29yZDEyMw"
      : name === "secret-assignment"
        ? "hunter2hunter2"
        : sample.slice(-12);

describe("shared default redactors (M7)", () => {
  for (const [name, sample] of Object.entries(samples)) {
    it(`${name}: redacts the sample`, () => {
      expect(defaultRedactors.some((r) => r.name === name)).toBe(true);
      expect(leaks(defaultRedactors, `x ${sample} y`, secretCore(name, sample))).toBe(false);
    });
    it(`${name}: cutting the pattern leaks (RED-on-cut)`, () => {
      const cut = defaultRedactors.filter((r) => r.name !== name);
      expect(leaks(cut, `x ${sample} y`, secretCore(name, sample))).toBe(true);
    });
  }

  it("sk-proj key with - and _ is redacted whole, not by the shorter rule", () => {
    const key = samples["openai-project"]!;
    let out = `k=${key}`;
    for (const r of defaultRedactors) out = out.replace(r.pattern, r.replacement);
    expect(out).not.toContain(A20);
  });

  it("leaves ordinary prose alone", () => {
    const prose = "Basic understanding of the token budget and a secret garden.";
    let out = prose;
    for (const r of defaultRedactors) out = out.replace(r.pattern, r.replacement);
    expect(out).toBe(prose);
  });

  it("is ReDoS-safe on pathological input", () => {
    const inputs = [
      "-----BEGIN PRIVATE KEY-----" + "a".repeat(200_000),
      "Basic " + "A".repeat(200_000),
      "password=" + "x".repeat(200_000),
      "sk-proj-" + "a-".repeat(100_000),
      "Bearer " + "a".repeat(200_000),
    ];
    const start = performance.now();
    for (const input of inputs) {
      let out = input;
      for (const r of defaultRedactors) out = out.replace(r.pattern, r.replacement);
    }
    expect(performance.now() - start).toBeLessThan(5000);
  });
});

describe("log file permissions (M7)", () => {
  const modeOf = (path: string): number => statSync(path).mode & 0o777;

  it("file exporter creates dir 0700 and file 0600", async () => {
    const root = mkdtempSync(join(tmpdir(), "obs-perm-"));
    try {
      const file = join(root, "nested", "obs.jsonl");
      const exporter = makeFileExporter({ filePath: file });
      await exporter.exportLogs([
        { timestamp: new Date(), level: "info", message: "hi" },
      ]);
      expect(modeOf(join(root, "nested"))).toBe(0o700);
      expect(modeOf(file)).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("logger service creates dir 0700 and file 0600", () => {
    const root = mkdtempSync(join(tmpdir(), "obs-perm-"));
    try {
      const file = join(root, "logs", "app.log");
      const logger = makeLoggerService({ level: "info", format: "text", output: "file", filePath: file });
      logger.info("hello");
      expect(modeOf(join(root, "logs"))).toBe(0o700);
      expect(modeOf(file)).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
