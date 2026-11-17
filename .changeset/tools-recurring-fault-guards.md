---
"@reactive-agents/tools": patch
---

Built-in tools now absorb three recurring call faults found in recorded runs. A lone string sent under the wrong key heals to the required parameter, including an array one (`crypto-price({symbol:"BTC"})` becomes `{coins:["BTC"]}`), and the missing-parameter example for an array parameter shows real items instead of `[]`. `file-read` and `list-directory` read the file under the working root when the model names a doubled or foreign root that does not exist (`/workspace/a.txt`), report the path used in a `note`, and still refuse real outside paths, `..` segments, credential paths and symlink escapes. `file-write` is unchanged. `todo` with a sentence in `action` and an `items` list is treated as `add`.
