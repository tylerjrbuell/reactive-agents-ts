---
"@reactive-agents/channels": minor
"@reactive-agents/core": patch
---

Channel routes can acknowledge a slow turn before the final reply. New optional `RouteSpec.ack` (`{ afterMs?, text?, typing? } | false`, off by default): the router shows a typing indicator when the turn starts and, if the turn is still running after `afterMs` (default 4000), sends one fixed acknowledgement message (default "On it..."), then the final reply. It is deterministic and costs no tokens; the ack is not agent history, is skipped for quick, denied, dropped and meter-refused turns, and a failed ack never fails the turn. New optional `ChannelAdapter.sendTyping`, implemented by the Telegram adapter via `sendChatAction`. Core adds the `ChannelTurnAcknowledged` event.
