---
"@reactive-agents/tools": minor
---

The `todo` tool can manage the list. New actions: `edit` (`{id, text}` renames one item and keeps its status; the title must not be empty), `remove` (`{id}` or `{ids}`; an id not on the list is a `No change` line, not an error), `clear` (every item, or only one status with `status:"completed"`), and `patch` (`ops`, several edits, status changes and removes in order as one result; if any op is invalid, nothing changes). They emit core's `edit` and `remove` checklist ops. `delete`/`rm` heal to `remove`, `rename` to `edit`, `reset` to `clear`, and `clear_completed` to a done-only clear. Every result still renders the list and the next-step line. The tool schema gains `ids`, `text`, `status` and `ops`. `ops` is a JSON string, so OpenAI strict mode keeps the op fields; an array is accepted too.

`applyTodoChecklistAction` takes an optional fourth argument, the checklist op history. When given, `add` issues ids after the highest id ever added, so a removed item's id is never reused. Without it, ids continue after the current items, as before.

The read-only git/gh shell now allows redirects to exactly `/dev/null` (`git log 2>/dev/null`). Output redirects to any other file are still refused. `splitCommandSegments` no longer reads the `|` of a `>|` redirect as a pipe.
