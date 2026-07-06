---
"@reactive-agents/cli": patch
---

Declare `@reactive-agents/runtime-shim` as a dependency of the CLI and mark it
`external` in the bundle. The `rax serve` command imports `secureServe` from it;
previously it was inlined into the CLI bundle instead of resolved from
node_modules. Functionally identical for users, but restores the deduplicated
external-dependency packaging the other workspace deps use.
