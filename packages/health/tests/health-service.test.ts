// packages/health/tests/health-service.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { Effect } from "effect";
import type { HealthConfig } from "../src/index.js";
import { makeHealthService } from "../src/service.js";

const testConfig: HealthConfig = { port: 0, agentName: "test-agent" };
// port: 0 tells Bun.serve to pick a random available port

let stopFn: (() => Effect.Effect<void, never>) | null = null;

afterEach(async () => {
  if (stopFn) {
    await Effect.runPromise(stopFn());
    stopFn = null;
  }
});

describe("HealthService", () => {
  test("start creates an HTTP server that responds on /health", async () => {
    const service = await Effect.runPromise(makeHealthService(testConfig));
    stopFn = service.stop;
    await Effect.runPromise(service.start());

    const res = await fetch(
      `http://localhost:${(service as any)._port}/health`,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("healthy");
    expect(body.agent).toBe("test-agent");
    expect(typeof body.uptime).toBe("number");
    expect(body.timestamp).toBeDefined();
  });

  test("/ready returns unhealthy when a check fails", async () => {
    const service = await Effect.runPromise(makeHealthService(testConfig));
    stopFn = service.stop;

    // Register a failing check
    await Effect.runPromise(
      service.registerCheck("db", () => Effect.succeed(false)),
    );
    await Effect.runPromise(service.start());

    const res = await fetch(`http://localhost:${(service as any)._port}/ready`);
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe("unhealthy");
    expect(body.checks.length).toBe(1);
    expect(body.checks[0].name).toBe("db");
    expect(body.checks[0].healthy).toBe(false);
  });

  test("/ready returns healthy when all checks pass", async () => {
    const service = await Effect.runPromise(makeHealthService(testConfig));
    stopFn = service.stop;

    await Effect.runPromise(
      service.registerCheck("db", () => Effect.succeed(true)),
    );
    await Effect.runPromise(service.start());

    const res = await fetch(`http://localhost:${(service as any)._port}/ready`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("healthy");
  });

  test("/metrics returns basic agent metrics", async () => {
    const service = await Effect.runPromise(makeHealthService(testConfig));
    stopFn = service.stop;
    await Effect.runPromise(service.start());

    const res = await fetch(
      `http://localhost:${(service as any)._port}/metrics`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");

    const text = await res.text();
    expect(text).toContain("raxd_uptime_seconds");
    expect(text).toContain("raxd_health_status");
  });

  test("stop shuts down the HTTP server", async () => {
    const service = await Effect.runPromise(makeHealthService(testConfig));
    await Effect.runPromise(service.start());
    const port = (service as any)._port;
    await Effect.runPromise(service.stop());
    stopFn = null;

    // Server should be down — fetch should fail
    try {
      await fetch(`http://localhost:${port}/health`);
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeDefined(); // connection refused
    }
  });

  test("check() returns aggregate health without HTTP", async () => {
    const service = await Effect.runPromise(makeHealthService(testConfig));

    await Effect.runPromise(
      service.registerCheck("check1", () => Effect.succeed(true)),
    );
    await Effect.runPromise(
      service.registerCheck("check2", () => Effect.succeed(true)),
    );

    const result = await Effect.runPromise(service.check());
    expect(result.status).toBe("healthy");
    expect(result.checks.length).toBe(2);
  });

  test("unknown routes return 404", async () => {
    const service = await Effect.runPromise(makeHealthService(testConfig));
    stopFn = service.stop;
    await Effect.runPromise(service.start());

    const res = await fetch(
      `http://localhost:${(service as any)._port}/unknown`,
    );
    expect(res.status).toBe(404);
  });
});
