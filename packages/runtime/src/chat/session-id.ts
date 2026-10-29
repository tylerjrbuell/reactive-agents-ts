/**
 * Generate a canonical session id: `sess_<scope>_<parts joined by _>-<unique>`.
 *
 * Scopes (spec §1 fix 4): `"agent"` for `agent.chat`'s agent-scoped engine,
 * `"session"` for `agent.session()` ids, `"gateway"` for per-sender gateway
 * engines. The unique suffix is a compressed `crypto.randomUUID()` — dashes
 * stripped, first 12 hex characters — attached after a `-` separator (the pinned
 * `sess_agent_agent-1-…` shape) so ids are collision-safe without extra state.
 * Host facades generate ids through this helper instead of pinning legacy literal
 * formats (`gateway-chat-<agentId>-<sender>`, `chat_<ts>`): those keys remain
 * READABLE through load fallbacks (Tasks 6/7) but are never written.
 *
 * @param scope canonical id scope.
 * @param parts scope-qualifying segments, joined with `_` (e.g. agentId,
 *   gateway agentId + sender). Empty/blank parts are skipped; a session-scope id
 *   with no parts is `sess_session_<unique>`.
 * @returns canonical session id, `sess_<scope>_<parts>-<unique>`.
 */
export function nextSessionId(scope: "agent" | "session" | "gateway", parts: readonly string[]): string {
  const unique = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const joined = parts.filter((part) => part.length > 0).join("_");
  return joined.length > 0 ? `sess_${scope}_${joined}-${unique}` : `sess_${scope}_${unique}`;
}
