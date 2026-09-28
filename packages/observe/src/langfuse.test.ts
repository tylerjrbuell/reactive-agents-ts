import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as otelApi from "@opentelemetry/api";
import { buildLangfuseConfig, setupLangfuseExporter } from "./langfuse.js";

// ─── Env isolation ───
//
// buildLangfuseConfig reads LANGFUSE_* from process.env as a fallback. Snapshot
// and restore the three keys around every test so cases don't leak into each
// other (or into the real environment the suite runs in).

const ENV_KEYS = [
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "LANGFUSE_HOST",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function decodeBasic(header: string | undefined): string {
  expect(header).toBeDefined();
  const [scheme, value] = header!.split(" ");
  expect(scheme).toBe("Basic");
  return Buffer.from(value, "base64").toString("utf-8");
}

describe("buildLangfuseConfig", () => {
  it("builds the OTLP endpoint and Basic auth from explicit config", () => {
    const cfg = buildLangfuseConfig({
      publicKey: "pk-lf-abc",
      secretKey: "sk-lf-xyz",
    });

    // setupOpenInferenceExporter appends /v1/traces, so the endpoint must stop
    // at /api/public/otel.
    expect(cfg.endpoint).toBe("https://cloud.langfuse.com/api/public/otel");
    expect(decodeBasic(cfg.headers?.["Authorization"])).toBe("pk-lf-abc:sk-lf-xyz");
    expect(cfg.serviceName).toBe("reactive-agents");
  });

  it("falls back to LANGFUSE_* env vars", () => {
    process.env["LANGFUSE_PUBLIC_KEY"] = "pk-env";
    process.env["LANGFUSE_SECRET_KEY"] = "sk-env";
    process.env["LANGFUSE_HOST"] = "https://us.cloud.langfuse.com";

    const cfg = buildLangfuseConfig();

    expect(cfg.endpoint).toBe("https://us.cloud.langfuse.com/api/public/otel");
    expect(decodeBasic(cfg.headers?.["Authorization"])).toBe("pk-env:sk-env");
  });

  it("prefers explicit config over env vars", () => {
    process.env["LANGFUSE_PUBLIC_KEY"] = "pk-env";
    process.env["LANGFUSE_SECRET_KEY"] = "sk-env";

    const cfg = buildLangfuseConfig({ publicKey: "pk-arg", secretKey: "sk-arg" });

    expect(decodeBasic(cfg.headers?.["Authorization"])).toBe("pk-arg:sk-arg");
  });

  it("strips a trailing slash from a self-hosted host", () => {
    const cfg = buildLangfuseConfig({
      publicKey: "pk",
      secretKey: "sk",
      host: "https://langfuse.internal.example.com/",
    });

    expect(cfg.endpoint).toBe("https://langfuse.internal.example.com/api/public/otel");
  });

  it("sets the v4 real-time ingestion header by default", () => {
    const cfg = buildLangfuseConfig({ publicKey: "pk", secretKey: "sk" });
    expect(cfg.headers?.["x-langfuse-ingestion-version"]).toBe("4");
  });

  it("merges extra headers but never lets them clobber Authorization", () => {
    const cfg = buildLangfuseConfig({
      publicKey: "pk",
      secretKey: "sk",
      headers: { "x-custom": "1", Authorization: "Basic hijacked" },
    });

    expect(cfg.headers?.["x-custom"]).toBe("1");
    expect(decodeBasic(cfg.headers?.["Authorization"])).toBe("pk:sk");
  });

  it("passes through a custom service name", () => {
    const cfg = buildLangfuseConfig({
      publicKey: "pk",
      secretKey: "sk",
      serviceName: "prod-agent",
    });
    expect(cfg.serviceName).toBe("prod-agent");
  });

  it("throws when the key pair is missing", () => {
    expect(() => buildLangfuseConfig()).toThrow(/public key and secret key/);
    expect(() => buildLangfuseConfig({ publicKey: "pk" })).toThrow(/secret key/);
  });
});

describe("setupLangfuseExporter", () => {
  // setupLangfuseExporter registers a *global* OTel tracer provider (via
  // setupOpenInferenceExporter). OTel only honours the first registration per
  // process, so leaving it set would block later test files (e.g. tracer.test)
  // from registering their own provider. Reset global state after each case,
  // mirroring tracer.test.ts's own afterEach.
  afterEach(() => {
    otelApi.trace.disable();
  });

  it("returns a shutdown handle when credentials are present", async () => {
    const handle = setupLangfuseExporter({ publicKey: "pk", secretKey: "sk" });
    expect(typeof handle.shutdown).toBe("function");
    await handle.shutdown();
  });

  it("throws before any exporter is created when credentials are missing", () => {
    expect(() => setupLangfuseExporter()).toThrow(/public key and secret key/);
  });
});
