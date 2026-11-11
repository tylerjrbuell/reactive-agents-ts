---
"@reactive-agents/reasoning": patch
---

Tool-result previews of objects that wrap a list of records (`find`, web search, `gh --json`, HTTP APIs) now show each record's salient text and fields instead of `Array(n)`. Previously a small model saw `results: Array(3)` from `find` and concluded nothing was found.

Flat object previews (for example `gh api repos/<owner>/<repo>`) that cannot show every key now drop navigation keys (`*_url`, `url`, `node_id`, `gravatar_id`, `avatar`) and list salient keys first (`name`, `title`, `description`, ...), followed by other scalar fields, with a `(N url/id fields omitted)` note. Previously `description` and `stargazers_count` sat behind ~40 `*_url` keys and the model reported the wrong description. Objects whose keys all fit, or that have no such keys, preview as before.

Guidance strings in a tool result (`hint`, `note`, `warning`, `error`, `message`) are no longer cut at about 80 characters: they get at least 300 characters when the preview budget allows, and in a record-list preview they come first. Small nested values in a record-list preview now show their items: a string list renders as `[a, b, …+N]`, and an object of string lists (such as `find`'s `outline`) renders as `README.md: # Cortex · ## Prerequisites · ## Environment …+N`, up to the preview budget. Previously `find` showed `outline={README.md}` and a cut hint, and the model answered that no document was loaded.
