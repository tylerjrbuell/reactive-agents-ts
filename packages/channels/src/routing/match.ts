import { Effect } from "effect";
import {
  channelSenderKey,
  createAccessControlPolicy,
  initialGatewayState,
  type ChannelAccessConfig,
  type GatewayEvent,
} from "@reactive-agents/gateway";
import type { InboundMessage } from "../types.js";
import type { RouteExplanation, RouteRole, RouteSpec, ToolExposure } from "./types.js";

/** What a route matches on, read from a normalized inbound message. */
export interface MatchInput {
  readonly adapterId: string;
  readonly conversationId: string;
  readonly isGroup: boolean;
  readonly mentionsSelf: boolean;
  readonly text: string;
}

/** Read the match fields from a normalized message (canonical adapters put them in `metadata`). */
export const matchInputOf = (adapterId: string, msg: InboundMessage): MatchInput => ({
  adapterId,
  conversationId: msg.channelId,
  isGroup: msg.metadata["isGroup"] === true,
  mentionsSelf: msg.metadata["mentionsSelf"] === true,
  text: msg.content,
});

/** Enabled routes in evaluation order: priority ascending, then declaration order. */
export const orderedRoutes = (routes: ReadonlyArray<RouteSpec>): ReadonlyArray<RouteSpec> =>
  routes
    .map((route, index) => ({ route, index }))
    .filter(({ route }) => route.enabled)
    .sort((a, b) => a.route.priority - b.route.priority || a.index - b.index)
    .map(({ route }) => route);

const isCommand = (text: string, name: string): boolean => {
  const t = text.trimStart();
  const cmd = `/${name}`;
  if (!t.startsWith(cmd)) return false;
  const next = t.charAt(cmd.length);
  return next === "" || next === "@" || /\s/.test(next);
};

/** True when `route` claims this message. */
export const routeMatches = (route: RouteSpec, input: MatchInput): boolean => {
  const m = route.match;
  if (m.channelId !== "*" && m.channelId !== input.adapterId) return false;
  if (m.conversation === "dm" && input.isGroup) return false;
  if (m.conversation === "group" && !input.isGroup) return false;
  if (m.conversationIds && !m.conversationIds.includes(input.conversationId)) return false;
  const when = m.when;
  if (!when) return true;
  switch (when._tag) {
    case "Mention":
      return input.mentionsSelf;
    case "Command":
      return isCommand(input.text, when.name);
    case "Keyword": {
      const lower = input.text.toLowerCase();
      return when.patterns.some((p) => p !== "" && lower.includes(p.toLowerCase()));
    }
  }
};

/** First matching route, or undefined (the message is unrouted). */
export const matchRoute = (routes: ReadonlyArray<RouteSpec>, input: MatchInput): RouteSpec | undefined =>
  orderedRoutes(routes).find((route) => routeMatches(route, input));

/**
 * In groups the agent answers only when addressed (`mention-only`) or not at all (`off`).
 * A route matched by a `Command` is addressed by definition.
 */
export const groupAllowed = (route: RouteSpec, input: MatchInput): boolean => {
  if (!input.isGroup) return true;
  if (route.groups === "off") return false;
  return input.mentionsSelf || route.match.when?._tag === "Command";
};

// ── Access ────────────────────────────────────────────────────────────────

/** Outcome of the access step. */
export type AccessVerdict =
  | { readonly allowed: true; readonly role: RouteRole }
  | { readonly allowed: false; readonly reason: string; readonly reply?: string };

const asGatewayEvent = (platform: string, userId: string): GatewayEvent => ({
  id: "route-access",
  source: "channel",
  timestamp: new Date(),
  priority: "normal",
  payload: "",
  metadata: { sender: userId, platform },
});

const evaluates = (config: ChannelAccessConfig, platform: string, userId: string): Effect.Effect<string | null> =>
  createAccessControlPolicy(config)
    .evaluate(asGatewayEvent(platform, userId), initialGatewayState())
    .pipe(
      Effect.map((decision) => {
        if (decision === null) return null;
        return "reason" in decision && typeof decision.reason === "string" ? decision.reason : "denied";
      }),
    );

/**
 * Decide whether a sender may talk on a route, through `createAccessControlPolicy` semantics (not
 * a copy): deny first, then `owners` plus `allow` (or `open`). Fail-closed: an empty sender id is
 * always denied. A webhook platform has no users: the signature was already checked by the
 * adapter, so the caller is allowed as a `sender` (never an owner).
 */
export const decideRouteAccess = (
  route: RouteSpec,
  platform: string,
  userId: string,
): Effect.Effect<AccessVerdict> =>
  Effect.gen(function* () {
    if (platform === "webhook") return { allowed: true, role: "sender" } as const;
    const denied = yield* evaluates({ policy: "blocklist", blockedSenders: route.deny }, platform, userId);
    if (denied !== null) return { allowed: false, reason: denied } as const;
    const config: ChannelAccessConfig = route.open
      ? { policy: "open" }
      : { policy: "allowlist", allowedSenders: [...route.owners, ...route.allow] };
    const refused = yield* evaluates(config, platform, userId);
    if (refused !== null) {
      return {
        allowed: false,
        reason: refused,
        ...(route.deniedReply !== undefined ? { reply: route.deniedReply } : {}),
      } as const;
    }
    const key = channelSenderKey(platform, userId.trim());
    return { allowed: true, role: route.owners.includes(key) ? "owner" : "sender" } as const;
  });

/** Tool surface for a role: owners run the agent's own tools, others get `senderTools`. */
export const toolExposureFor = (route: RouteSpec, role: RouteRole): ToolExposure =>
  role === "owner" ? { _tag: "AgentDefault" } : route.senderTools;

/**
 * Dry run: which route would take this message, who the sender is on it and what the agent could
 * do. No resolver call, no send, no counter touched.
 */
export const explainRoute = (
  routes: ReadonlyArray<RouteSpec>,
  adapterId: string,
  platform: string,
  msg: InboundMessage,
): Effect.Effect<RouteExplanation> =>
  Effect.gen(function* () {
    const input = matchInputOf(adapterId, msg);
    const route = matchRoute(routes, input);
    if (!route) return { decision: "unrouted", reason: "no enabled route matches this channel and conversation" } as const;
    const verdict = yield* decideRouteAccess(route, platform, msg.senderId);
    if (!verdict.allowed) {
      return { decision: "denied", routeId: route.id, reason: verdict.reason } as const;
    }
    if (!groupAllowed(route, input)) {
      return {
        decision: "dropped-group",
        routeId: route.id,
        role: verdict.role,
        reason: "group message does not address the bot",
      } as const;
    }
    return {
      decision: "allowed",
      routeId: route.id,
      role: verdict.role,
      toolExposure: toolExposureFor(route, verdict.role),
      reason: `route ${route.id} matched; sender is ${verdict.role}`,
    } as const;
  });
