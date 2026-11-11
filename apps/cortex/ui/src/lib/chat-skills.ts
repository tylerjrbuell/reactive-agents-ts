/**
 * Chat skills: the skills a session's agent can load (`GET /api/skills/session/:id`,
 * the framework's own discovery at the session workspace), and the wording the
 * menu rows and the turn's skill row use. What the chat lists is what the agent sees.
 *
 * Two ways to use one: `/skill <name>` pins it for the next message only (sent as
 * `skills` on the stream request), `/skills` pins it for every turn of the session
 * (`skills.activate`, a name). The agent can also load any listed skill itself.
 */
import type { DiscoveredSkill } from "./chat-config-patch.js";

/** `GET /api/skills/session/:id`. */
export interface SessionSkills {
  /** Discovery root: the session workspace, or the server's launch dir when none is set. */
  readonly root: string;
  readonly skills: readonly DiscoveredSkill[];
  /** Session pins (names). */
  readonly pinned: readonly string[];
}

const EMPTY: SessionSkills = { root: "", skills: [], pinned: [] };

/** Load a session's skills; an empty list when the server cannot list them. */
export async function fetchSessionSkills(baseUrl: string, sessionId: string, fetchImpl: typeof fetch = fetch): Promise<SessionSkills> {
  try {
    const r = await fetchImpl(`${baseUrl}/api/skills/session/${encodeURIComponent(sessionId)}`);
    if (!r.ok) return EMPTY;
    const j = (await r.json()) as Partial<SessionSkills>;
    return { root: j.root ?? "", skills: j.skills ?? [], pinned: j.pinned ?? [] };
  } catch {
    return EMPTY;
  }
}

/** Where a skill was found, in words. */
export function skillSourceLabel(source: DiscoveredSkill["source"]): string {
  switch (source) {
    case "workspace":
      return ".agents/skills";
    case "claude":
      return ".claude/skills";
    case "agent":
      return "this agent's folder";
    case "configured":
      return "configured folder";
    case "global":
      return "your home folder";
    default:
      return "skills folder";
  }
}

/** A skill row's detail line: its description, then where it was found. */
export function skillDetail(skill: DiscoveredSkill): string {
  const where = skillSourceLabel(skill.source);
  return skill.description ? `${skill.description} · ${where}` : where;
}
