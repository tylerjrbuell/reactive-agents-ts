import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { IdentityService, IdentityServiceLive } from "../src/identity-service.js";
import { DefaultRoles } from "../src/types.js";

const TestLayer = IdentityServiceLive;

const run = <A>(effect: Effect.Effect<A, any, IdentityService>) =>
  Effect.runPromise(Effect.provide(effect, TestLayer));

describe("IdentityService", () => {
  test("issues and authenticates certificates", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* IdentityService;
        const cert = yield* svc.issueCertificate("agent-1");
        return yield* svc.authenticate(cert);
      }),
    );
    expect(result.authenticated).toBe(true);
    expect(result.agentId).toBe("agent-1");
  });

  test("rejects expired certificates", async () => {
    const error = await run(
      Effect.gen(function* () {
        const svc = yield* IdentityService;
        const cert = yield* svc.issueCertificate("agent-1", 0);
        // Wait a tick for expiry
        yield* Effect.sleep("5 millis");
        return yield* svc.authenticate(cert).pipe(Effect.flip);
      }),
    );
    expect(error._tag).toBe("AuthenticationError");
  });

  test("rotates certificates and revokes old ones", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* IdentityService;
        const cert1 = yield* svc.issueCertificate("agent-1");
        const cert2 = yield* svc.rotateCertificate("agent-1");

        expect(cert2.serialNumber).not.toBe(cert1.serialNumber);

        // Old cert should be revoked
        const oldResult = yield* svc.authenticate(cert1).pipe(Effect.flip);
        expect(oldResult._tag).toBe("AuthenticationError");

        // New cert should work
        return yield* svc.authenticate(cert2);
      }),
    );
    expect(result.authenticated).toBe(true);
  });

  test("enforces RBAC authorization", async () => {
    await run(
      Effect.gen(function* () {
        const svc = yield* IdentityService;

        // Assign basic role
        yield* svc.assignRole("basic-agent", DefaultRoles["agent-basic"]!);

        // Should be able to read working memory
        const allowed = yield* svc.authorize("basic-agent", "memory/working", "read");
        expect(allowed.allowed).toBe(true);

        // Should NOT be able to access opus
        const denied = yield* svc.authorize("basic-agent", "llm/opus", "execute").pipe(Effect.flip);
        expect(denied._tag).toBe("AuthorizationError");
      }),
    );
  });

  test("supports wildcard permissions", async () => {
    await run(
      Effect.gen(function* () {
        const svc = yield* IdentityService;
        yield* svc.assignRole("std-agent", DefaultRoles["agent-standard"]!);

        // memory/* should match memory/semantic
        const allowed = yield* svc.authorize("std-agent", "memory/semantic", "read");
        expect(allowed.allowed).toBe(true);
      }),
    );
  });

  test("maintains audit log", async () => {
    const entries = await run(
      Effect.gen(function* () {
        const svc = yield* IdentityService;

        yield* svc.audit({
          agentId: "agent-1",
          sessionId: "sess-1",
          action: "tool.execute",
          resource: "tools/web-search",
          result: "success",
        });

        yield* svc.audit({
          agentId: "agent-1",
          sessionId: "sess-1",
          action: "llm.complete",
          resource: "llm/sonnet",
          result: "success",
        });

        return yield* svc.queryAudit("agent-1");
      }),
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]!.action).toBe("tool.execute");
    expect(entries[1]!.action).toBe("llm.complete");
  });

  test("supports permission delegation", async () => {
    await run(
      Effect.gen(function* () {
        const svc = yield* IdentityService;

        // Give orchestrator full permissions
        yield* svc.assignRole("orch-1", DefaultRoles["orchestrator"]!);

        // Delegate tool access to worker
        const delegation = yield* svc.delegate(
          "orch-1",
          "worker-1",
          [{ resource: "tools/web-search", actions: ["execute"] }],
          "Research task delegation",
          60_000,
        );

        expect(delegation.status).toBe("active");
        expect(delegation.fromAgentId).toBe("orch-1");

        // Worker should now have access
        const allowed = yield* svc.authorize("worker-1", "tools/web-search", "execute");
        expect(allowed.allowed).toBe(true);

        // Revoke delegation
        yield* svc.revokeDelegation(delegation.id);
      }),
    );
  });

  test("gets agent identity with roles", async () => {
    const identity = await run(
      Effect.gen(function* () {
        const svc = yield* IdentityService;
        yield* svc.assignRole("my-agent", DefaultRoles["agent-standard"]!);
        return yield* svc.getIdentity("my-agent");
      }),
    );
    expect(identity.agentId).toBe("my-agent");
    expect(identity.roles.length).toBeGreaterThan(0);
  });
});
