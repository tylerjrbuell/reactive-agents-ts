// `rax diagnose debrief <runId>` — render a structured decision timeline.
//
// Folds every rationale-bearing event in a trace (tool calls, assumptions,
// curator decisions, alternatives considered, termination) into a single
// human-readable timeline that shows *why* the agent made each choice.
//
// Unlike `replay`, which is event-centric, `debrief` is decision-centric: it
// drops events that carry no rationale signal so reviewers see the audit trail,
// not the raw firehose.

import { resolveTracePath } from "../lib/resolve.js";
import { buildDebrief } from "../debrief/build.js";
import { renderDebrief, type DebriefFormat } from "../debrief/renderer.js";

export interface DebriefOpts {
  readonly json?: boolean;
}

export async function debriefCommand(idOrPath: string, opts: DebriefOpts = {}): Promise<void> {
  const path = await resolveTracePath(idOrPath);
  const debrief = await buildDebrief(path);
  const format: DebriefFormat = opts.json ? "json" : "markdown";
  console.log(renderDebrief(debrief, format));
}
