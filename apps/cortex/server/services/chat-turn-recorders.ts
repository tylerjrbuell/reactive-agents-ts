/**
 * The per-session recorders a chat agent carries: each subscribes to the agent's bus and remembers
 * what one turn needs when it ends (assessments, failed-run causes, skill and recall activity) or
 * while it runs (strategy steps). One attach, one unsubscribe, so a new recorder is added here and
 * the chat session service only reads its log.
 */
import type { SubscribableAgent } from "./chat-ingest.js";
import { recordTurnAssessments, type TurnAssessmentRecorder } from "./turn-assessments.js";
import { recordRunErrors, type RunErrorLog } from "./chat-run-errors.js";
import { recordSkillActivity, type SkillActivityLog } from "./chat-turn-skills.js";
import { recordRecallActivity, type RecallActivityLog } from "./chat-turn-recall.js";
import { recordStrategySteps, type StrategyStepLog } from "./strategy-steps.js";

/** The recorders' logs, under the names `CachedChatSession` carries them. */
export interface TurnRecorderLogs {
  readonly assessments: TurnAssessmentRecorder;
  readonly runErrors: RunErrorLog;
  readonly skillActivity: SkillActivityLog;
  readonly recallActivity: RecallActivityLog;
  readonly strategySteps: StrategyStepLog;
}

/** Subscribe every recorder to `agent`; `unsubscribe` ends them all. */
export async function attachTurnRecorders(agent: SubscribableAgent): Promise<{ readonly logs: TurnRecorderLogs; readonly unsubscribe: () => void }> {
  const a = await recordTurnAssessments(agent);
  const e = await recordRunErrors(agent);
  const s = await recordSkillActivity(agent);
  const r = await recordRecallActivity(agent);
  const t = await recordStrategySteps(agent);
  return {
    logs: { assessments: a.recorder, runErrors: e.log, skillActivity: s.log, recallActivity: r.log, strategySteps: t.log },
    unsubscribe: () => {
      a.unsubscribe();
      e.unsubscribe();
      s.unsubscribe();
      r.unsubscribe();
      t.unsubscribe();
    },
  };
}
