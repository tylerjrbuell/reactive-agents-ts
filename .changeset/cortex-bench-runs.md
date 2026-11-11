---
"@reactive-agents/cortex": minor
"@reactive-agents/ui-core": patch
---

Cortex Runs and the run view in the "Bench" design (step 4 of the modernization plan).

- **Runs** is a real table capped at a readable width: status, the run's name (its label or the chat it came from, never a bare id) with its source, model, strategy, steps, tokens, cost, time and start, with Pinned and Recent groups and live rows marked by an accent edge. A toolbar holds search, a status segment with counts (All, Running, Waiting, Finished, Failed, Stopped), sort and the token and cost totals. With no runs the page shows the neural mark and what to do next.
- **Waiting on you**: approvals and `request_user_input` questions sit in one strip above the list, only while something waits, with Approve / Deny, the answer controls, and Open run or Open chat. The two always-empty panels are gone.
- **Run view**: a header with the run's name, status and a link back to the chat that started it; a vitals line that wraps instead of clipping (`Loops 2 of 3`, `η 0.25` with a small entropy line); the Answer and the Trace (Loops / Timeline tabs) on the left; and an inspector with Summary, Decisions, Signal, Context, Memory, Messages and Events beside them on wide windows and under them below 1360px. The resizable bottom panel is gone. Export and More menus hold the downloads, Replay, Rerun, Rename and Delete.
- **Continue in chat** replaces the run view's Chat tab. It opens the chat that started the run, or creates a chat session with the run's recorded settings, the run as context, and its task and answer as the first exchange.
- Fixed: a run stopped or terminated from the run view read as failed; it now reads Stopped in the run view and in Runs (the server reads the framework's `AgentStopped` / `AgentTerminated`). A stopped run row also read as Finished in the run view.
- Fixed: the Summary said "no entropy data" when the run had one entropy sample; the Events tab labelled different event types with the same word ("Emitted 4" twice) and previewed most events as raw JSON; "Replay (1 events)".
- Fixed: the small entropy line drew nothing for a flat signal (one sample).
- `/run` redirects to `/runs`, and the nav says Runs instead of Trace.
- Run summaries (`GET /api/runs`, `GET /api/runs/:runId`) carry `chatSessionId` and `chatSessionName` for runs a chat session started.
- ui-core: `statusOfRun` labels match the chat turn vocabulary: Running, Finished, Waiting on you (were Live, Done, Paused). Tones are unchanged.
