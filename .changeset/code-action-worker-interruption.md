---
"@reactive-agents/reasoning": patch
---

Fixed — code-action's sandbox Worker now actually stops on run cancellation (#35)

`code-action`'s sandbox runs generated code in a real `node:worker_threads`
Worker; the host-side function bridging it to Effect returned a bare
`Promise`. Interrupting the run's fiber (cancellation, kill switch, a lost
timeout race) abandoned *awaiting* that promise, but the underlying Worker —
a real OS thread — and any tool call it had already dispatched kept running
unsupervised. A cancelled run could leave a side-effecting tool call
(`shell-execute`, `file-write`) completing its work after the run was
supposed to have stopped. The sandbox now returns a proper `Effect` whose
interrupt finalizer terminates the Worker, so cancelling a `code-action` run
actually stops it.
