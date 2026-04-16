import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchCommunityProfile,
  resolveDefaultProfileEndpoint,
  type CommunityProfileClientOptions,
} from "../../src/calibration/community-profile-client.js";

let testRoot: string;
beforeEach(() => { testRoot = mkdtempSync(join(tmpdir(), "ra-comm-")); });
afterEach(() => { rmSync(testRoot, { recursive: true, force: true }); });

describe("fetchCommunityProfile", () => {
  it("returns undefined when offline (fetch rejects)", async () => {
    const result = await fetchCommunityProfile("cogito", {
      endpoint: "http://localhost:1/nonexistent",
      cacheDir: testRoot,
      cacheTtlMs: 60_000,
      fetchImpl: async () => { throw new Error("offline"); },
    });
    expect(result).toBeUndefined();
  });

  it("returns cached value when fresh", async () => {
    const slug = "cogito";
    const cachedPath = join(testRoot, `${slug}.json`);
    writeFileSync(cachedPath, JSON.stringify({
      fetchedAt: new Date().toISOString(),
      profile: { parallelCallCapability: "reliable" },
    }));
    let fetchCalls = 0;
    const result = await fetchCommunityProfile("cogito", {
      endpoint: "http://example.invalid",
      cacheDir: testRoot,
      cacheTtlMs: 60_000,
      fetchImpl: async () => { fetchCalls++; throw new Error("should not fetch"); },
    });
    expect(result?.parallelCallCapability).toBe("reliable");
    expect(fetchCalls).toBe(0);
  });

  it("fetches when cache is stale and updates the cache", async () => {
    const staleDate = new Date(Date.now() - 90_000).toISOString();
    writeFileSync(join(testRoot, "cogito.json"), JSON.stringify({
      fetchedAt: staleDate,
      profile: { parallelCallCapability: "sequential-only" },
    }));
    const result = await fetchCommunityProfile("cogito", {
      endpoint: "http://example.invalid",
      cacheDir: testRoot,
      cacheTtlMs: 60_000,
      fetchImpl: async () => new Response(
        JSON.stringify({ parallelCallCapability: "reliable" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    expect(result?.parallelCallCapability).toBe("reliable");
  });

  it("returns undefined on 404", async () => {
    const result = await fetchCommunityProfile("unknown", {
      endpoint: "http://example.invalid",
      cacheDir: testRoot,
      cacheTtlMs: 60_000,
      fetchImpl: async () => new Response("not found", { status: 404 }),
    });
    expect(result).toBeUndefined();
  });

  it("returns stale cache on non-404 error", async () => {
    const staleDate = new Date(Date.now() - 90_000).toISOString();
    writeFileSync(join(testRoot, "cogito.json"), JSON.stringify({
      fetchedAt: staleDate,
      profile: { parallelCallCapability: "partial" },
    }));
    const result = await fetchCommunityProfile("cogito", {
      endpoint: "http://example.invalid",
      cacheDir: testRoot,
      cacheTtlMs: 60_000,
      fetchImpl: async () => new Response("server error", { status: 500 }),
    });
    // Stale cache served on non-404 errors
    expect(result?.parallelCallCapability).toBe("partial");
  });
});

describe("resolveDefaultProfileEndpoint", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    for (const [key, val] of Object.entries(originalEnv)) {
      process.env[key] = val;
    }
  });

  it("uses REACTIVE_AGENTS_TELEMETRY_PROFILES_URL when set (highest precedence)", () => {
    process.env["REACTIVE_AGENTS_TELEMETRY_PROFILES_URL"] = "https://override.example/v1/profiles";
    process.env["REACTIVE_AGENTS_TELEMETRY_BASE_URL"] = "https://should-be-ignored.example";
    expect(resolveDefaultProfileEndpoint()).toBe("https://override.example/v1/profiles");
  });

  it("derives from REACTIVE_AGENTS_TELEMETRY_BASE_URL when no explicit profiles URL", () => {
    delete process.env["REACTIVE_AGENTS_TELEMETRY_PROFILES_URL"];
    process.env["REACTIVE_AGENTS_TELEMETRY_BASE_URL"] = "https://pi.home.example.com";
    expect(resolveDefaultProfileEndpoint()).toBe("https://pi.home.example.com/v1/profiles");
  });

  it("trims trailing slash from base URL", () => {
    delete process.env["REACTIVE_AGENTS_TELEMETRY_PROFILES_URL"];
    process.env["REACTIVE_AGENTS_TELEMETRY_BASE_URL"] = "https://pi.home.example.com/";
    expect(resolveDefaultProfileEndpoint()).toBe("https://pi.home.example.com/v1/profiles");
  });

  it("falls back to hardcoded production default when no env vars set", () => {
    delete process.env["REACTIVE_AGENTS_TELEMETRY_PROFILES_URL"];
    delete process.env["REACTIVE_AGENTS_TELEMETRY_BASE_URL"];
    expect(resolveDefaultProfileEndpoint()).toContain("reactiveagents.dev");
  });
});
