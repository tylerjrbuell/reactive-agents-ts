import * as React from "react";
import type { RunState } from "@reactive-agents/ui-core";
import { useRunSteps } from "../hooks/use-run-steps.js";

export interface StepTimelineProps {
  readonly state: RunState;
  readonly className?: string;
}

export function StepTimeline({ state, className }: StepTimelineProps): React.ReactElement {
  const steps = useRunSteps(state);
  return (
    <ol className={className} data-ra-timeline>
      {steps.map((s, i) => (
        <li key={`${s.seq ?? i}-${s.kind}`} data-ra-step={s.kind} data-ra-success={s.success}>
          {s.label}
          {s.durationMs !== undefined ? ` (${s.durationMs}ms)` : ""}
        </li>
      ))}
    </ol>
  );
}
