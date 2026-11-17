---
"@reactive-agents/cortex": patch
---

Gateway and Channels keep their numbers across a restart. Channel received, sent and failed counts and the last received and sent times are read from the durable inbox and outbox, and the route counters and the recent activity feed are saved in the Cortex database and loaded when the hub starts. Counts that cannot be recovered are labelled "since restart" instead of showing 0.
