/**
 * Lifecycle deletes for `chat_proposals`: proposals are part of the chat thread, so they leave
 * with the transcript (clear, rewind, compact) and can be removed one by one. Pure SQL; the
 * proposal service owns creation and Apply.
 */
import type { Database } from "bun:sqlite";

/** Delete every proposal of a session (the conversation was cleared). Returns how many went. */
export function clearProposals(db: Database, sessionId: string): number {
  return db.prepare("DELETE FROM chat_proposals WHERE session_id = ?").run(sessionId).changes;
}

/**
 * Delete proposals made after `afterMs` (a rewind removed the turns they came from; `afterMs` is
 * the last surviving transcript row). Returns how many went.
 */
export function deleteProposalsAfter(db: Database, sessionId: string, afterMs: number): number {
  return db.prepare("DELETE FROM chat_proposals WHERE session_id = ? AND created_at > ?").run(sessionId, afterMs).changes;
}

/**
 * Delete settled (applied or dismissed) proposals; pending ones stay because they still need an
 * answer (compaction folded the turns they were made in). Returns how many went.
 */
export function deleteSettledProposals(db: Database, sessionId: string): number {
  return db.prepare("DELETE FROM chat_proposals WHERE session_id = ? AND status != 'proposed'").run(sessionId).changes;
}

/** Delete one proposal. False when it does not exist in that session. */
export function deleteProposal(db: Database, sessionId: string, id: string): boolean {
  return db.prepare("DELETE FROM chat_proposals WHERE id = ? AND session_id = ?").run(id, sessionId).changes === 1;
}
