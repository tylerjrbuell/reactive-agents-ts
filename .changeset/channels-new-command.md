---
"@reactive-agents/channels": minor
"@reactive-agents/core": patch
---

Channel routes gain `resetCommands` (default `["/new", "/reset"]`, `[]` disables). A route owner who sends one as the whole message ends the conversation's session and starts a fresh one; the command never reaches the agent, and the router replies "Started a new conversation." `RoutedSession` gets an optional `reset` port for resolvers that keep history outside the session, and the router publishes a new `ChannelConversationReset` event.
