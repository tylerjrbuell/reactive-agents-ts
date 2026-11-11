---
"@reactive-agents/tools": patch
---

`find` is easier for small models to use.

- `find` matches a query against loaded document names: `README`, `README.md` and `cortex readme` return the chunks of `apps/cortex/README.md`.
- A query that only names a document (`Cortex README`, `the readme`) also returns that document's `outline` (its markdown headings, or the first line of each chunk; up to 15) and a `hint` to search its content with the words of the needed fact.
- A query that names a document and adds content words (`cortex readme port environment variable`) ranks that document's chunks by the content words, not by the name.
- When `find` returns a preview of a large result set, each preview is the 200-character window that holds the most query words, not the first 200 characters. A fact deep in a chunk (an env-var table row) now reaches the model.
- Document result `identifier`s and the `documents` list use the basename, or the shortest unique path suffix when basenames collide (`cortex/README.md`, `tools/README.md`), instead of the absolute path.
- Every `find` result that searched documents lists the loaded document names in `documents` (first 8, then `and N more`). When no passage matched, a `hint` names the documents and suggests a content keyword.
- The `find` description tells the model to query with the words of the fact it needs, not the document's name.
- `NOISE_KEY`, `isNoiseKey` and `SALIENT_FIELDS` (the result renderer's noise-key and label-field classes) are exported from the package index.
