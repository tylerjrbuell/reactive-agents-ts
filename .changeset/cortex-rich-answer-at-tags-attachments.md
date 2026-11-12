---
"@reactive-agents/cortex": minor
"@reactive-agents/ui-core": minor
---

Cortex chat: richer final answers, `@` file tags and attachments.

- The final answer (chat turn and run view) has a toolbar (copy rich, copy as Markdown, save as `.md` or a standalone web page, outline of headings), renders callouts, task lists and code language labels, and opens links only as safe external pages. A **Deliverables** strip lists the files, edits and typed result the run produced, read from its tool calls and receipt, each with preview, copy and download.
- `@` in the composer searches the chat's workspace and tags files as removable chips with a preview of exactly what is sent (long files say `64 KB of 340 KB, cut`). The list never leaves the workspace root and never shows secrets, VCS data or dependencies.
- The paperclip, drag and drop and paste attach pictures, audio and text files. Pictures and audio are sent to the model as typed content parts; kinds the chat's model cannot take are disabled with the reason, and a refusal reads as a plain message before anything runs.
- ui-core adds `deliverablesOf`, `deliverableCallsOf`, `outlineOf`, `calloutKindOf`, `rankPaths`, and the attachment rules (`ATTACHMENT_CAPS`, `classifyAttachment`, `gateAttachmentKind`, `fileContextBlock`); `connectRunStream` now reports the server's own `error` text for a refused request.
