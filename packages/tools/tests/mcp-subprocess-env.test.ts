// Run: bun test packages/tools/tests/mcp-subprocess-env.test.ts --timeout 15000
//
// F12 — MCP subprocesses must NOT inherit the full host environment. Every MCP
// server is frequently `npx <untrusted-pkg>` / `docker run <untrusted-image>`;
// inheriting all provider keys means one malicious package exfiltrates the
// entire secret set. The subprocess env is built from a non-secret allowlist
// plus explicitly-provided vars only.
import { describe, test, expect, afterEach } from "bun:test";

import { buildMcpSubprocessEnv } from "../src/index.js";

const CLEANUP: string[] = [];
afterEach(() => {
  for (const k of CLEANUP) delete process.env[k];
  CLEANUP.length = 0;
});

describe("F12 — buildMcpSubprocessEnv", () => {
  test("does not forward provider API keys from process.env", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-SECRET";
    process.env.OPENAI_API_KEY = "sk-SECRET";
    process.env.GOOGLE_API_KEY = "AIza-SECRET";
    CLEANUP.push("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY");

    const env = buildMcpSubprocessEnv();

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.GOOGLE_API_KEY).toBeUndefined();
  });

  test("does not forward arbitrary secret-looking vars", () => {
    process.env.MY_DB_PASSWORD = "hunter2";
    process.env.STRIPE_SECRET_KEY = "sk_live_x";
    CLEANUP.push("MY_DB_PASSWORD", "STRIPE_SECRET_KEY");

    const env = buildMcpSubprocessEnv();

    expect(env.MY_DB_PASSWORD).toBeUndefined();
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
  });

  test("forwards the non-secret base allowlist (PATH, HOME)", () => {
    const env = buildMcpSubprocessEnv();
    expect(env.PATH).toBe(process.env.PATH ?? "");
    // HOME is present when the host has it
    if (process.env.HOME) expect(env.HOME).toBe(process.env.HOME);
  });

  test("forwards explicitly-provided config.env (opt-in secrets)", () => {
    const env = buildMcpSubprocessEnv({ GITHUB_TOKEN: "ghp_explicit", CUSTOM: "v" });
    expect(env.GITHUB_TOKEN).toBe("ghp_explicit");
    expect(env.CUSTOM).toBe("v");
  });

  test("config.env overrides a base var", () => {
    const env = buildMcpSubprocessEnv({ PATH: "/only/this" });
    expect(env.PATH).toBe("/only/this");
  });
});
