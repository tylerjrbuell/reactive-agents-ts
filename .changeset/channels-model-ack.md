---
"@reactive-agents/channels": minor
"@reactive-agents/core": patch
---

Route acks can be written by the agent instead of fixed text. Set `ack: { source: "model" }` on a route and the router sends, when the ack delay passes, the agent's own pre-tool narration if the turn already produced any (pushed through the new optional `RoutedTurn.onProgress`), else a one-line text from the new optional `RoutedSession.acknowledge(turn)` (bounded by `ack.modelTimeoutMs`, default 3000, 1 to 10 000), else the canned text. Still one ack per turn, never agent history, never after the final reply, and a failing or slow port never fails the turn. Model text is sanitized (markdown stripped, one line, 300 characters). The default stays `source: "canned"`. `ChannelTurnAcknowledged` gains an optional `source` (`"canned" | "narration" | "model"`).
