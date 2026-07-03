import * as React from "react";
import type { RunState } from "@reactive-agents/ui-core";
import { CostMeter } from "./CostMeter.js";
import { StepTimeline } from "./StepTimeline.js";

export interface AgentDevtoolsProps {
  readonly state: RunState;
  readonly enabled?: boolean;
  readonly onReplay?: () => void;
  readonly position?: "bottom-right" | "bottom-left";
}

/**
 * Reads `NODE_ENV` from a possible Node-like global without depending on
 * `@types/node` — the react package is client-only and must typecheck without
 * Node built-ins (repo constraint). Returns `undefined` in real browsers.
 */
function readNodeEnv(): string | undefined {
  return (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV;
}

export function AgentDevtools({
  state,
  enabled,
  onReplay,
  position = "bottom-right",
}: AgentDevtoolsProps): React.ReactElement | null {
  const show = enabled ?? readNodeEnv() !== "production";
  const [open, setOpen] = React.useState(true);
  if (!show) return null;
  return (
    <div
      data-ra-devtools
      data-ra-position={position}
      style={{ position: "fixed", [position.endsWith("right") ? "right" : "left"]: 8, bottom: 8, zIndex: 99999 }}
    >
      <button type="button" data-ra-devtools-toggle onClick={() => setOpen((o) => !o)}>
        RA · {state.status}
      </button>
      {open && (
        <div data-ra-devtools-panel>
          <CostMeter state={state} />
          <StepTimeline state={state} />
          <div data-ra-devtools-actions>
            <span data-ra-devtools-runid>{state.runId ?? "(no run)"}</span>
            {onReplay && (
              <button type="button" onClick={onReplay}>
                Replay
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
