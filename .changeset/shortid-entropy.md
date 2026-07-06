---
"@reactive-agents/reasoning": patch
---

Bump plan `shortId()` entropy from 4 to 6 base36 characters. The 4-char id space
(~1.7M) made a 100-id uniqueness draw collide roughly 0.3% of the time — a real
intermittent CI failure in the plan tests. Six characters (~2.2B) makes it
effectively never, and the id stays within its 8-character budget (`p_` + 6).
