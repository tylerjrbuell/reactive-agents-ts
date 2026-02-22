import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { makePermissionManager } from "../src/authz/permission-manager.js";
import type { Role, Permission } from "../src/types.js";

const run = <A>(effect: Effect.Effect<A, any>) => Effect.runPromise(effect);

const createTestRole = (name: string, permissions: Permission[]): Role => ({
  name,
  permissions,
  description: `Test role: ${name}`,
});

describe("PermissionManager", () => {
  test("assigns and retrieves roles", async () => {
    const pm = await run(makePermissionManager);
    const role = createTestRole("test-role", [
      { resource: "memory/working", actions: ["read", "write"] },
    ]);

    await run(pm.assignRole("agent-1", role));
    const roles = await run(pm.getRoles("agent-1"));

    expect(roles).toHaveLength(1);
    expect(roles[0]?.name).toBe("test-role");
  });

  test("does not duplicate roles", async () => {
    const pm = await run(makePermissionManager);
    const role = createTestRole("test-role", [
      { resource: "memory/working", actions: ["read"] },
    ]);

    await run(pm.assignRole("agent-1", role));
    await run(pm.assignRole("agent-1", role));
    const roles = await run(pm.getRoles("agent-1"));

    expect(roles).toHaveLength(1);
  });

  test("authorizes when permission matches", async () => {
    const pm = await run(makePermissionManager);
    const role = createTestRole("reader", [
      { resource: "memory/*", actions: ["read"] },
    ]);

    await run(pm.assignRole("agent-1", role));
    const result = await run(pm.authorize("agent-1", "memory/working", "read"));

    expect(result.allowed).toBe(true);
    expect(result.resource).toBe("memory/working");
    expect(result.action).toBe("read");
  });

  test("denies when no matching permission", async () => {
    const pm = await run(makePermissionManager);
    const role = createTestRole("reader", [
      { resource: "memory/working", actions: ["read"] },
    ]);

    await run(pm.assignRole("agent-1", role));
    const error = await run(
      pm.authorize("agent-1", "tools/execute", "execute").pipe(Effect.flip),
    );

    expect(error.agentId).toBe("agent-1");
    expect(error.resource).toBe("tools/execute");
  });

  test("wildcard permission matches all resources", async () => {
    const pm = await run(makePermissionManager);
    const role = createTestRole("admin", [
      { resource: "*", actions: ["read", "write", "execute"] },
    ]);

    await run(pm.assignRole("agent-1", role));

    const r1 = await run(pm.authorize("agent-1", "anything", "read"));
    expect(r1.allowed).toBe(true);

    const r2 = await run(pm.authorize("agent-1", "something/else", "write"));
    expect(r2.allowed).toBe(true);
  });

  test("wildcard resource pattern matches", async () => {
    const pm = await run(makePermissionManager);
    const role = createTestRole("tool-user", [
      { resource: "tools/*", actions: ["execute"] },
    ]);

    await run(pm.assignRole("agent-1", role));

    const result = await run(pm.authorize("agent-1", "tools/web-search", "execute"));
    expect(result.allowed).toBe(true);
  });

  test("admin action grants all actions", async () => {
    const pm = await run(makePermissionManager);
    const role = createTestRole("super", [
      { resource: "memory/working", actions: ["admin"] },
    ]);

    await run(pm.assignRole("agent-1", role));

    const read = await run(pm.authorize("agent-1", "memory/working", "read"));
    expect(read.allowed).toBe(true);

    const write = await run(pm.authorize("agent-1", "memory/working", "write"));
    expect(write.allowed).toBe(true);

    const del = await run(pm.authorize("agent-1", "memory/working", "delete"));
    expect(del.allowed).toBe(true);
  });

  test("respects permission expiration", async () => {
    const pm = await run(makePermissionManager);
    const role = createTestRole("temp", [
      { resource: "memory/working", actions: ["read"], expiresAt: new Date(Date.now() - 1000) },
    ]);

    await run(pm.assignRole("agent-1", role));
    const error = await run(
      pm.authorize("agent-1", "memory/working", "read").pipe(Effect.flip),
    );

    expect(error._tag).toBe("AuthorizationError");
  });

  test("delegates permissions successfully", async () => {
    const pm = await run(makePermissionManager);
    const delegatorRole = createTestRole("delegator", [
      { resource: "tools/*", actions: ["execute"] },
    ]);

    await run(pm.assignRole("orch-1", delegatorRole));

    const delegation = await run(
      pm.delegate("orch-1", "worker-1", [{ resource: "tools/web-search", actions: ["execute"] }], "Test delegation", 60000),
    );

    expect(delegation.fromAgentId).toBe("orch-1");
    expect(delegation.toAgentId).toBe("worker-1");
    expect(delegation.status).toBe("active");

    const result = await run(pm.authorize("worker-1", "tools/web-search", "execute"));
    expect(result.allowed).toBe(true);
  });

  test("prevents delegation without sufficient permissions", async () => {
    const pm = await run(makePermissionManager);
    const limitedRole = createTestRole("limited", [
      { resource: "memory/working", actions: ["read"] },
    ]);

    await run(pm.assignRole("agent-1", limitedRole));

    const error = await run(
      pm
        .delegate("agent-1", "agent-2", [{ resource: "tools/execute", actions: ["execute"] }], "Bad delegation", 60000)
        .pipe(Effect.flip),
    );

    expect(error.fromAgentId).toBe("agent-1");
  });

  test("revokes delegation", async () => {
    const pm = await run(makePermissionManager);
    const delegatorRole = createTestRole("delegator", [
      { resource: "tools/*", actions: ["execute"] },
    ]);

    await run(pm.assignRole("orch-1", delegatorRole));

    const delegation = await run(
      pm.delegate("orch-1", "worker-1", [{ resource: "tools/web-search", actions: ["execute"] }], "Test", 60000),
    );

    await run(pm.revokeDelegation(delegation.id));

    const error = await run(
      pm.authorize("worker-1", "tools/web-search", "execute").pipe(Effect.flip),
    );

    expect(error._tag).toBe("AuthorizationError");
  });

  test("role inheritance via multiple roles", async () => {
    const pm = await run(makePermissionManager);
    const role1 = createTestRole("reader", [{ resource: "memory/*", actions: ["read"] }]);
    const role2 = createTestRole("writer", [{ resource: "memory/*", actions: ["write"] }]);

    await run(pm.assignRole("agent-1", role1));
    await run(pm.assignRole("agent-1", role2));

    const readResult = await run(pm.authorize("agent-1", "memory/working", "read"));
    expect(readResult.allowed).toBe(true);

    const writeResult = await run(pm.authorize("agent-1", "memory/semantic", "write"));
    expect(writeResult.allowed).toBe(true);
  });

  test("delegation expires after duration", async () => {
    const pm = await run(makePermissionManager);
    const delegatorRole = createTestRole("delegator", [
      { resource: "tools/*", actions: ["execute"] },
    ]);

    await run(pm.assignRole("orch-1", delegatorRole));

    const delegation = await run(
      pm.delegate("orch-1", "worker-1", [{ resource: "tools/web-search", actions: ["execute"] }], "Short delegation", 10),
    );

    await Effect.runPromise(Effect.sleep("20 millis"));

    const error = await run(
      pm.authorize("worker-1", "tools/web-search", "execute").pipe(Effect.flip),
    );

    expect(error._tag).toBe("AuthorizationError");
  });
});
