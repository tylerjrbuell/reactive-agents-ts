/**
 * The strategy / approval-gate conflict for a config the panel or the chat bar holds. The server decides
 * (`POST /api/strategy-conflict` runs the framework's `codeActionApprovalConflict` on the agent as it
 * would be built, the same call behind the 409 on the run and chat routes); the UI holds no copy of the
 * rule, it asks and renders the answer (ui-core wording, `strategyApprovalConflictOf`).
 */
import type { StrategyApprovalConflict } from "@reactive-agents/ui-core";
import { CORTEX_SERVER_URL } from "../constants.js";

/** Only Code Action has an approval-scope rule: no need to ask the server about any other strategy. */
const hasApprovalScopeRule = (cfg: Readonly<Record<string, unknown>>): boolean => cfg.strategy === "code-action";

/** The slice of `fetch` this module uses (a test passes a stub). */
export type ConflictFetch = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "json">>;

/**
 * The conflict `cfg` would hit, or `undefined` (none, or the server could not say: the framework's own
 * refusal and the run route's 409 still stand). `toolsEnabled: false` (a chat with tools off) builds no
 * tool layer; leave it out for a desk or Lab run.
 */
export async function fetchStrategyConflict(
  cfg: Readonly<Record<string, unknown>>,
  opts: { readonly toolsEnabled?: boolean } = {},
  fetchFn: ConflictFetch = (url, init) => fetch(url, init),
  baseUrl: string = CORTEX_SERVER_URL,
): Promise<StrategyApprovalConflict | undefined> {
  if (!hasApprovalScopeRule(cfg)) return undefined;
  try {
    const res = await fetchFn(`${baseUrl}/api/strategy-conflict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: cfg, ...(opts.toolsEnabled === undefined ? {} : { toolsEnabled: opts.toolsEnabled }) }),
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { conflict?: StrategyApprovalConflict | null };
    return json.conflict ?? undefined;
  } catch {
    return undefined;
  }
}
