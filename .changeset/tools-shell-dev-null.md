---
"@reactive-agents/tools": patch
---

`shell-execute` now allows a redirect whose target is exactly `/dev/null`: `2>/dev/null`, `>/dev/null`, `1>/dev/null`, `&>/dev/null`, `>>/dev/null`, `2>>/dev/null`, `>&/dev/null` and `</dev/null`, with the target quoted or not. Before, the "writes to /dev/ are blocked" rule and the sandbox path check refused them, and models lost turns retrying. Every other `/dev/` target is still refused (`>/dev/sda`, `>/dev/tcp/host/1`, `>/dev/null2`, `>/dev/null/x`, `>/dev/./sda`). The target word ends at the next operator, so `2>/dev/null>/etc/x` is still refused. A custom `blockedPatterns` list still sees the command as written. The read-only git/gh shell is unchanged: it still refuses every output redirect except a descriptor dup.
