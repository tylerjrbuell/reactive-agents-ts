---
"@reactive-agents/cortex": minor
---

Cortex Beacon in the "Bench" design (step 5 of the modernization plan).

- **Board** is Beacon's default view. *Running now* shows a card per working agent: its name (never a bare id), source, run time, task, what it is doing now (`Calling http-get`, `Thinking after 14 tool calls`), a small entropy line with `η`, a loop meter and steps, tokens and cost. Only running cards glow. The **Agents** grid lists the rest with status, source, the question or approval it waits on, why it failed, or its task, plus model, tokens and time, filtered by All / Needs you / Failed / Idle.
- **Field** keeps the free canvas, restyled: a dot grid, nodes named by agent with a sentence-case status (no more `STATUS: SETTLED`), the glow and one sonar ring on running nodes only, and parent-to-sub-agent links that flow only while both run. Drag and Arrange stay; the stats panel is gone (Board carries the counts).
- Switch views from the page header. The choice is kept in the URL (`/?view=field`) and remembered in the browser; the URL wins.
- First run shows a welcome with the neural mark and Open a chat / Build an agent / Connect an app.
- The prompt bar shows the model (it opens the full agent settings), the prompt library and Run.
- The top bar uses Cortex's own icons (no more icon names flashing as words before a web font loads), marks the current page with an underline, counts live runs on Runs, shows how many agents are running, and has a "Search or run a command" button. Toasts and the command palette use the same icons.
- Fixed: a stopped run read as finished ("settled") on Beacon; it reads Stopped. A late event no longer revives a run that already ended, and a periodic refresh no longer flips a run the socket ended back to running.
- Fixed: a page opened while an agent was running showed a blank card until its next event; Beacon now fills the entropy line, loop and tool calls from the run's stored events.
- Fixed: Arrange on the canvas could lock the page (an update loop).
- Fixed: an agent waiting on an approval counted as running in the top bar.
