---
"@reactive-agents/cortex": minor
"@reactive-agents/ui-core": minor
---

Cortex shows a tool call's arguments as soon as the call starts, and tool approvals no longer need durable runs.

- **Arguments while running.** `ToolCallStarted` now carries the call's arguments (ui-core `ToolCallStarted.args`; `foldTurnTrace` keeps them on the running call). Chat shows them on the running tool row and in the step detail, the run view lists the calls still running with their arguments, and the Events tab previews them. Credential-shaped values (API keys, bearer tokens, `?key=` query values) are redacted on screen.
- **Live approvals.** A "Pause and ask me" (`detach`) approval policy no longer turns durable runs on. Without durable runs the run waits live in Cortex: chat shows Approve / Deny in the streaming turn, and the run view header, Runs "Waiting on you", Beacon and the app-wide prompt offer the same decision. Approve continues the same run; Deny tells the agent the call was refused. With durable runs on, the pause still survives a restart as before. A live wait in chat ends if the chat page is closed or reloaded while it waits.
- **One approval surface at a time.** The "Approval needed" prompt shows only when the approval's chat or run is not on screen, and goes away when you open it; answering from the prompt, the chat card or the run header clears all of them. Dismiss on a chat approval card now hides the card only; the call stays pending and the run header and "Waiting on you" still answer it. Agents saved while the Lab forced durable runs on keep them until you switch durable execution off.
