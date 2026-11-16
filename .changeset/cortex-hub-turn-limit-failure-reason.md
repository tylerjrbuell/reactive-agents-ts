---
"@reactive-agents/cortex": patch
---

Cortex Lab Channels: the route editor edits the turn limit (`turnTimeoutMs`, shown in seconds) and the failure notice (`failureNotice`, on by default). A failed turn in the activity feed and the test panel now says why in words, for example `turn timed out after 120s (the route's turn limit)`, instead of the bare `turn_timeout`. The docs page now states the real model-ack wait bounds (1 to 30000 ms, default 12000).
