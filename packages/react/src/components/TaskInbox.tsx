import * as React from "react";
import type { InboxRun } from "../hooks/use-task-inbox.js";

export interface TaskInboxProps {
  readonly runs: readonly InboxRun[];
  readonly onSelect?: (runId: string) => void;
  readonly className?: string;
  readonly renderRow?: (run: InboxRun) => React.ReactNode;
}

export function TaskInbox({ runs, onSelect, className, renderRow }: TaskInboxProps): React.ReactElement {
  return (
    <ul className={className} data-ra-inbox>
      {runs.map((run) => (
        <li key={run.runId} data-ra-inbox-row data-ra-status={run.status} onClick={() => onSelect?.(run.runId)}>
          {renderRow ? (
            renderRow(run)
          ) : (
            <>
              <span data-ra-inbox-task>{run.task}</span>
              <span data-ra-inbox-status>{run.status}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
