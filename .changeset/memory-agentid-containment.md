---
"@reactive-agents/memory": patch
---

Memory paths are now contained and private. An agent id such as `../x`, `/etc` or `..` can no longer move the per-agent memory directory or `memory.md` outside the memory base directory; the id is percent-encoded into a single path segment (ordinary ids are unchanged). Memory directories are created `0700` and the SQLite file and `memory.md` `0600`. The LIKE-based search fallback (used when FTS5 is absent) now matches `%` and `_` in the query literally instead of as wildcards.
