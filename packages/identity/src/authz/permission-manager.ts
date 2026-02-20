import { Effect, Ref } from "effect";
import type { Role, Permission, AuthzDecision, Delegation } from "../types.js";
import { AuthorizationError, DelegationError } from "../errors.js";

export interface PermissionManager {
  readonly assignRole: (agentId: string, role: Role) => Effect.Effect<void, never>;
  readonly getRoles: (agentId: string) => Effect.Effect<readonly Role[], never>;
  readonly authorize: (agentId: string, resource: string, action: "read" | "write" | "execute" | "delete" | "admin") => Effect.Effect<AuthzDecision, AuthorizationError>;
  readonly delegate: (fromAgentId: string, toAgentId: string, permissions: readonly Permission[], reason: string, durationMs: number) => Effect.Effect<Delegation, DelegationError>;
  readonly revokeDelegation: (delegationId: string) => Effect.Effect<void, DelegationError>;
}

export const makePermissionManager = Effect.gen(function* () {
  const agentRolesRef = yield* Ref.make<Map<string, Role[]>>(new Map());
  const delegationsRef = yield* Ref.make<Delegation[]>([]);

  const assignRole = (agentId: string, role: Role): Effect.Effect<void, never> =>
    Ref.update(agentRolesRef, (map) => {
      const newMap = new Map(map);
      const existing = newMap.get(agentId) ?? [];
      // Don't add duplicate roles
      if (!existing.find((r) => r.name === role.name)) {
        newMap.set(agentId, [...existing, role]);
      }
      return newMap;
    });

  const getRoles = (agentId: string): Effect.Effect<readonly Role[], never> =>
    Ref.get(agentRolesRef).pipe(Effect.map((map) => map.get(agentId) ?? []));

  const authorize = (
    agentId: string,
    resource: string,
    action: "read" | "write" | "execute" | "delete" | "admin",
  ): Effect.Effect<AuthzDecision, AuthorizationError> =>
    Effect.gen(function* () {
      const roles = yield* Ref.get(agentRolesRef).pipe(
        Effect.map((map) => map.get(agentId) ?? []),
      );

      const delegations = yield* Ref.get(delegationsRef).pipe(
        Effect.map((dels) =>
          dels.filter(
            (d) => d.toAgentId === agentId && d.status === "active" && d.expiresAt > new Date(),
          ),
        ),
      );

      const allPermissions: Permission[] = [
        ...roles.flatMap((r) => r.permissions),
        ...delegations.flatMap((d) => [...d.permissions]),
      ];

      const matched = allPermissions.find((p) => {
        const resourceMatch = matchWildcard(p.resource, resource);
        const actionMatch = p.actions.includes(action) || p.actions.includes("admin");
        const notExpired = !p.expiresAt || p.expiresAt > new Date();
        return resourceMatch && actionMatch && notExpired;
      });

      if (matched) {
        return { allowed: true, resource, action, matchedPermission: matched };
      }

      return yield* Effect.fail(
        new AuthorizationError({
          message: `Agent ${agentId} not authorized for ${action} on ${resource}`,
          agentId,
          resource,
          action,
        }),
      );
    });

  const delegate = (
    fromAgentId: string,
    toAgentId: string,
    permissions: readonly Permission[],
    reason: string,
    durationMs: number,
  ): Effect.Effect<Delegation, DelegationError> =>
    Effect.gen(function* () {
      // Verify delegator has the permissions they're delegating
      for (const perm of permissions) {
        for (const action of perm.actions) {
          yield* authorize(fromAgentId, perm.resource, action).pipe(
            Effect.mapError(
              () =>
                new DelegationError({
                  message: `Cannot delegate ${action} on ${perm.resource}: delegator lacks permission`,
                  fromAgentId,
                  toAgentId,
                }),
            ),
          );
        }
      }

      const now = new Date();
      const delegation: Delegation = {
        id: crypto.randomUUID(),
        fromAgentId,
        toAgentId,
        permissions: [...permissions],
        issuedAt: now,
        expiresAt: new Date(now.getTime() + durationMs),
        reason,
        status: "active",
      };

      yield* Ref.update(delegationsRef, (dels) => [...dels, delegation]);
      return delegation;
    });

  const revokeDelegation = (delegationId: string): Effect.Effect<void, DelegationError> =>
    Ref.update(delegationsRef, (dels) =>
      dels.map((d) => (d.id === delegationId ? { ...d, status: "revoked" as const } : d)),
    ).pipe(
      Effect.mapError(
        () => new DelegationError({ message: "Revocation failed", fromAgentId: "", toAgentId: "" }),
      ),
    );

  return { assignRole, getRoles, authorize, delegate, revokeDelegation } satisfies PermissionManager;
});

function matchWildcard(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return regex.test(value);
}
