---
"@reactive-agents/cortex": minor
"@reactive-agents/ui-core": minor
---

Cortex shows how fast the model writes. In chat, a live `~tok/s` estimate appears while a reply streams, then the measured speed and time to first token when the model call completes. The run view shows speed and time to first token on each loop's trace row and the run average in its vitals line. The Model page has a Speed section: median tokens/sec and median time to first token over the model's last 20 recorded runs (`GET /api/model-throughput`). Speed is output tokens over generation time, after the first token (core `outputTokensPerSecond`). A call without a first-token time gives a lower bound, marked `~`, and is never mixed into an exact median.

`@reactive-agents/ui-core` adds `throughputOf`, `throughputOfCalls`, `liveTokensPerSecond`, `formatTokensPerSecond`, `formatFirstToken`, `medianOf` and the `Throughput` / `ThroughputSample` types, so any chat UI can show the same figures. `TokenUsage` and `CallUsage` gain an optional `firstTokenMs`.
