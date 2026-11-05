---
"@reactive-agents/reasoning": minor
---

A templated output path in a task ("for each notes-N.txt, write out-N.txt") now becomes one required file deliverable per item (`out-1.txt` … `out-6.txt`) when the task names the items explicitly, for example "notes-1.txt through notes-6.txt" or a list, with relative or absolute paths. The run can no longer finish as done after writing only some of them, and the refusal names the missing files. A template whose items the task does not enumerate is still not treated as a file to produce.
