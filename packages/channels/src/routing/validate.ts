import { Effect, Either, Schema } from "effect";
import { RouteSpec, RoutingError, type RouteSpecInput } from "./types.js";

/** `platform:userId` with a non-empty platform and id. */
const SENDER_KEY = /^[^:\s]+:\S+$/;

const invalid = (routeId: string, message: string): RoutingError =>
  new RoutingError({ reason: "invalid_route", message: `route ${routeId}: ${message}`, routeId });

const isPositive = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * Check one decoded route. Rules are unconditional (no "strict mode"):
 * - `open` requires positive `maxCostPerDayUsd`, `maxTurnsPerHour` and `maxTurnsPerSenderPerHour`.
 * - `senderTools: AgentDefault` with no owners is rejected.
 * - webhook-platform routes reject user lists, `open` and `senderTools` (access is the signature).
 * - `allow` / `deny` / `owners` entries must be `platform:userId`.
 *
 * `platformOf` maps a `match.channelId` to its platform, when known.
 */
export const validateRoute = (
  route: RouteSpec,
  platformOf: (channelId: string) => string | undefined,
  rawSenderTools: boolean,
): RoutingError | undefined => {
  for (const [field, list] of [["allow", route.allow], ["deny", route.deny], ["owners", route.owners]] as const) {
    const bad = list.find((entry) => !SENDER_KEY.test(entry));
    if (bad !== undefined) return invalid(route.id, `${field} entries must be platform:userId`);
  }
  if (route.open) {
    if (
      !isPositive(route.maxCostPerDayUsd) ||
      !isPositive(route.maxTurnsPerHour) ||
      !isPositive(route.maxTurnsPerSenderPerHour)
    ) {
      return invalid(
        route.id,
        "open requires positive maxCostPerDayUsd, maxTurnsPerHour and maxTurnsPerSenderPerHour",
      );
    }
  }
  if (route.senderTools._tag === "AgentDefault" && route.owners.length === 0) {
    return invalid(route.id, "senderTools AgentDefault requires at least one owner");
  }
  const platform = platformOf(route.match.channelId);
  if (platform === "webhook") {
    if (route.allow.length > 0 || route.deny.length > 0 || route.owners.length > 0 || route.open || rawSenderTools) {
      return invalid(route.id, "webhook routes reject allow, deny, owners, open and senderTools (access is the signing secret)");
    }
  }
  for (const cap of [route.maxTurnsPerHour, route.maxTurnsPerSenderPerHour, route.maxCostPerDayUsd, route.maxIterations]) {
    if (cap !== undefined && !isPositive(cap)) return invalid(route.id, "limits must be positive numbers");
  }
  return undefined;
};

/**
 * Decode and validate routes. Duplicate ids are rejected. Fails with a typed {@link RoutingError}
 * naming the first offending route; the error never echoes message text.
 */
export const validateRoutes = (
  input: ReadonlyArray<RouteSpecInput>,
  platformOf: (channelId: string) => string | undefined,
): Effect.Effect<ReadonlyArray<RouteSpec>, RoutingError> =>
  Effect.suspend(() => {
    const out: RouteSpec[] = [];
    const ids = new Set<string>();
    for (const raw of input) {
      const decoded = Schema.decodeUnknownEither(RouteSpec)(raw);
      if (Either.isLeft(decoded)) {
        return Effect.fail(
          new RoutingError({ reason: "invalid_route", message: "route does not match the RouteSpec schema", routeId: raw.id }),
        );
      }
      const route = decoded.right;
      if (ids.has(route.id)) return Effect.fail(invalid(route.id, "duplicate route id"));
      ids.add(route.id);
      const problem = validateRoute(route, platformOf, raw.senderTools !== undefined);
      if (problem) return Effect.fail(problem);
      out.push(route);
    }
    return Effect.succeed(out);
  });

/**
 * Changes in `next` that widen access relative to `current` and therefore need an explicit
 * confirmation: added owners, `open` turned on, `senderTools` set to `AgentDefault`. Entries look
 * like `owners:<routeId>`, `open:<routeId>`, `agent-default:<routeId>`.
 */
export const wideningChanges = (
  current: ReadonlyArray<RouteSpec>,
  next: ReadonlyArray<RouteSpec>,
): ReadonlyArray<string> => {
  const before = new Map(current.map((r) => [r.id, r]));
  const needed: string[] = [];
  for (const route of next) {
    const prev = before.get(route.id);
    if (route.owners.some((o) => !prev?.owners.includes(o))) needed.push(`owners:${route.id}`);
    if (route.open && !prev?.open) needed.push(`open:${route.id}`);
    if (route.senderTools._tag === "AgentDefault" && prev?.senderTools._tag !== "AgentDefault") {
      needed.push(`agent-default:${route.id}`);
    }
  }
  return needed;
};
