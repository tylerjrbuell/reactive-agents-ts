---
"@reactive-agents/cortex": minor
---

Cortex Chat in the "Bench" design (step 3 of the modernization plan).

- A chat opens at its latest turn. Before, it could land mid-thread with "Jump to latest" showing, because the answers finished rendering after the first scroll.
- Answers read as 15px prose at a comfortable line length instead of 12px monospace. Your messages are quiet bubbles on the right. The agent's turns sit on the canvas with a thin rail on the left: it moves while the turn runs and turns red when the turn did not finish.
- Turn headers show the model, the strategy chip and token usage (`2.8k in · 560 out`). A finished turn's estimated token split no longer says "estimated while streaming".
- Sub-agent cards use a wider grid, and names keep a minimum width, so a failed agent's name no longer collapses to "s". The sub-agent drawer has a scrim and traps focus, and Escape or a click outside closes it.
- Turns that did not finish (failed, stopped, interrupted, abstained, or older turns saved with no outcome) end with a note that gives the cause and a Retry button.
- The chats rail has search, Today and Earlier groups, the model and the time of last use, a running dot, and a "More actions" menu. Rows no longer nest buttons inside a button.
- The composer is one panel: quick-bar chips, the message box, and a hint row. A queued message shows as a strip above it. An empty chat shows the neural mark, starter prompts and the ambient orbs.
- Chat icons are bundled SVGs, so no icon name ends up in screen-reader labels or copied text. Markdown in chat and in run deliverables follows the theme tokens, including tables and code.
- Fixed: the chat settings dialog from the rail now opens centred as a modal (a missing space in its class list had dropped its layer and layout).
