---
"@reactive-agents/gateway": patch
"@reactive-agents/channels": patch
---

Gateway schedules and ingress are safer to run unattended. A schedule fire that was handed out but never settled (the process died mid-run) is now re-offered after restart under the same fire id, following the schedule's catch-up policy, instead of being lost; each fire keeps its own result in a bounded `runs` history (`lastRun` is still the newest). Config-declared schedules re-read `priority` and `enabled` from the config on restart while a runtime pause is kept. Webhook ingress answers 408 to a sender that stalls the body (`bodyTimeoutMs`, default 10 s) and 503 beyond `maxInFlight` concurrent requests (default 64). The Signal transport caps line length (1 MiB) and the unread notification backlog (1000) with a typed `too_large` error, keeps only `{ name, code }` of spawn errors (they carried the account number), and holds a bounded, account-masked stderr tail on `transport.diagnostics()`. `ScheduleDeliveryRecord` now also carries `adapterId`, `receiptStatus`, `errorKind` and `retryable` using the channel vocabulary; existing records stay readable.
