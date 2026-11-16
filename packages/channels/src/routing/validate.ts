import { Effect, Either, Schema } from "effect";
import { RouteSpec, RoutingError, type RouteAck, type RouteSpecInput } from "./types.js";

/** `platform:userId` with a non-empty platform and id. */
const SENDER_KEY = /^[^:\s]+:\S+$/;

const invalid = (routeId: string, message: string): RoutingError =>
  new RoutingError({ reason: "invalid_route", message: `route ${routeId}: ${message}`, routeId });

const isPositive = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

const RESET_COMMAND = /^\/[A-Za-z0-9_-]{1,31}$/;
const MAX_RESET_COMMANDS = 5;

const MAX_ACK_AFTER_MS =120_000;
const MAX_BATCH_WINDOW_MS = 30_000;
const MAX_ACK_MODEL_TIMEOUT_MS = 30_000;
const MAX_ACK_TEXT = 200;
const MAX_ACK_TEXTS = 10;

/** Bounds for `ack`: a sane delay and short fixed texts. The text is never templated, so there is nothing to inject into. */
const ackProblem = (ack: RouteAck): string | undefined => {
  if (ack.afterMs !== undefined && !(Number.isInteger(ack.afterMs) && ack.afterMs >= 0 && ack.afterMs <= MAX_ACK_AFTER_MS)) {
    return `ack.afterMs must be an integer from 0 to ${MAX_ACK_AFTER_MS}`;
  }
  if (ack.modelTimeoutMs !== undefined && !(Number.isInteger(ack.modelTimeoutMs) && ack.modelTimeoutMs >= 1 && ack.modelTimeoutMs <= MAX_ACK_MODEL_TIMEOUT_MS)) {
    return `ack.modelTimeoutMs must be an integer from 1 to ${MAX_ACK_MODEL_TIMEOUT_MS}`;
  }
  if (ack.text !== undefined) {
    const texts = typeof ack.text === "string" ? [ack.text] : ack.text;
    if (texts.length === 0 || texts.length > MAX_ACK_TEXTS) return `ack.text must hold 1 to ${MAX_ACK_TEXTS} messages`;
    if (texts.some((t) => t.trim() === "" || t.length > MAX_ACK_TEXT)) {
      return `ack.text entries must be non-empty and at most ${MAX_ACK_TEXT} characters`;
    }
  }
  return undefined;
};

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
  if (route.ack) {
    if (platform === "webhook") return invalid(route.id, "webhook routes reject ack (the reply is the HTTP response)");
    const problem = ackProblem(route.ack);
    if (problem) return invalid(route.id, problem);
  }
  const batch = route.batchWindowMs;
  if (batch !== undefined && !(Number.isInteger(batch) && batch >= 0 && batch <= MAX_BATCH_WINDOW_MS)) {
    return invalid(route.id, `batchWindowMs must be an integer from 0 to ${MAX_BATCH_WINDOW_MS}`);
  }
  if (platform === "webhook" && ((batch ?? 0) > 0 || (route.midRun ?? "queue") !== "queue")) {
    return invalid(route.id, "webhook routes reject batchWindowMs and midRun (the reply is the HTTP response)");
  }
  if (route.resetCommands.length > MAX_RESET_COMMANDS || route.resetCommands.some((c) => !RESET_COMMAND.test(c))) {
    return invalid(route.id, `resetCommands must hold at most ${MAX_RESET_COMMANDS} commands like "/new" (slash, then 1 to 31 letters, digits, _ or -)`);
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
