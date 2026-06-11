/**
 * Lifecycle webhook dispatch.
 *
 * Per-agent webhook URLs fire server-side on a small set of lifecycle events
 * (run start / completion / failure) — NOT on every reasoning step, to keep
 * overhead to a few POSTs per run. Dispatch is fire-and-forget; a failing
 * endpoint never blocks or fails ingest.
 *
 * Security: URLs are user-configured and called from the server. Cortex is a
 * local dev tool (loopback-bound by default); treat configured URLs as trusted.
 */

/** Lifecycle event tags eligible for webhook dispatch. */
export const LIFECYCLE_WEBHOOK_EVENTS = [
  "AgentStarted",
  "AgentCompleted",
  "TaskFailed",
  "DebriefCompleted",
] as const;

export type LifecycleWebhookEvent = (typeof LIFECYCLE_WEBHOOK_EVENTS)[number];

export interface WebhookConfig {
  readonly url: string;
  /** Event tags this hook fires on. Empty or `["all"]` = every lifecycle event. */
  readonly events?: readonly string[];
}

export function isLifecycleEvent(tag: string): tag is LifecycleWebhookEvent {
  return (LIFECYCLE_WEBHOOK_EVENTS as readonly string[]).includes(tag);
}

/**
 * Parse a raw agent-config value into webhook configs. Tolerates missing /
 * malformed input (returns []). Accepts either an array of `{url, events}` or
 * an array of bare URL strings.
 */
export function parseWebhookConfigs(raw: unknown): WebhookConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: WebhookConfig[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim()) out.push({ url: item.trim() });
    } else if (item && typeof item === "object" && typeof (item as { url?: unknown }).url === "string") {
      const url = (item as { url: string }).url.trim();
      if (!url) continue;
      const evRaw = (item as { events?: unknown }).events;
      const events = Array.isArray(evRaw)
        ? evRaw.filter((e): e is string => typeof e === "string")
        : undefined;
      out.push(events ? { url, events } : { url });
    }
  }
  return out;
}

/**
 * Select the webhook URLs that should fire for a given event tag.
 * A hook with no `events` (or containing `"all"`) matches every lifecycle event.
 */
export function selectWebhookTargets(webhooks: readonly WebhookConfig[], eventTag: string): string[] {
  if (!isLifecycleEvent(eventTag)) return [];
  const urls: string[] = [];
  for (const wh of webhooks) {
    const filter = wh.events;
    const matches =
      !filter || filter.length === 0 || filter.includes("all") || filter.includes(eventTag);
    if (matches) urls.push(wh.url);
  }
  return urls;
}

/**
 * Build the JSON payload POSTed to a webhook for a lifecycle event.
 */
export function buildWebhookPayload(args: {
  agentId: string;
  runId: string;
  eventTag: string;
  event: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    type: args.eventTag,
    agentId: args.agentId,
    runId: args.runId,
    timestamp: Date.now(),
    event: args.event,
  };
}

/**
 * Fire-and-forget POST to every target URL. Never throws; failures are swallowed
 * (best-effort delivery). Returns immediately without awaiting responses.
 */
export function dispatchWebhooks(
  targets: readonly string[],
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): void {
  if (targets.length === 0) return;
  const body = JSON.stringify(payload);
  for (const url of targets) {
    void fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "cortex-webhook/1" },
      body,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      // best-effort: a failing endpoint must not affect ingest
    });
  }
}
