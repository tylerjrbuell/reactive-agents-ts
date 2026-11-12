---
"@reactive-agents/runtime-shim": patch
---

`assertPublicUrl` egress guard closes SSRF bypasses: IPv6 literals are now parsed to bytes and the embedded IPv4 in IPv4-mapped (`::ffff:a.b.c.d`, including hex-normalised `[::ffff:a9fe:a9fe]`), IPv4-compatible (`::a.b.c.d`), NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`) forms gets the same private/loopback/link-local/metadata rules as plain IPv4. Trailing-dot hostnames (`localhost.`) and `*.localhost` are blocked, and metadata addresses (169.254.0.0/16, fe80::/10, `fd00:ec2::254`, `100.100.100.200`) stay blocked under `allowPrivate`.
