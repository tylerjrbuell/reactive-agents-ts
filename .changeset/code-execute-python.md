---
"@reactive-agents/tools": minor
---

`code-execute` now runs Python 3 as well as JavaScript/TypeScript. Set `language` to `python` (also `python3`, `py`): the code runs under the host `python3` in the same subprocess model as the Bun path (cwd `/tmp`, minimal environment, process-group kill at the timeout). It is not isolated, like the Bun path. Python has no `return`: print the answer and stdout arrives in `result` and `output`. Failures keep the last 20 traceback lines; a Python syntax error returns a Python retry example. A host without `python3` gets a clear "not found, nothing executed" observation; docker mode routes Python to the sandbox container and never falls back to the host (that Docker path is untested). The tool description and retry guide now state both languages.
