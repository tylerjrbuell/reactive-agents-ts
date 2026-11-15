---
"@reactive-agents/channels": patch
---

A routed turn that fails after the route accepted it (`turn_timeout` or any other turn error) now sends the sender one short fixed notice instead of staying silent after the ack. The timeout notice names the route's `turnTimeoutMs` in seconds. Not sent for simulations, missing adapters or denied messages; a failed send is swallowed. New optional route field `failureNotice` (default `true`; `false` opts out). `ChannelTurnCompleted` is unchanged.
