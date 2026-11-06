---
"@reactive-agents/core": patch
"@reactive-agents/reasoning": patch
"@reactive-agents/tools": patch
"@reactive-agents/llm-provider": patch
---

One spelling for a non-text part shown as text. New core exports `mediaPartLabel(part, why?)` / `mediaLabel(facts, why?)` produce `[<kind>: <media_type>, <size or name>]`, or with a reason `[<kind> omitted: <media_type>, <size or name>; <why>]`, with an audio transcript last (`; transcript: <t>`). Core also exports `sha256Hex`. Text-only runs are byte-identical; only media runs see changed wording:

- Reasoning provider-boundary stubs (`toLLMMessages`): images, audio and files now carry a size or location, and audio keeps its reason next to the transcript. Example: `[image omitted: image/tiff; unsupported image type]` is now `[image omitted: image/tiff, 1 KB; unsupported image type]`, `[audio omitted: audio/wav; transcript: hello]` is now `[audio omitted: audio/wav, 1 KB; no provider input for this part yet; transcript: hello]`, and `[file: report.pdf (application/pdf) at file:///w/report.pdf]` is now `[file omitted: application/pdf, report.pdf at file:///w/report.pdf; no provider input for this part yet]`.
- Tools `toolContentText` / `JSON.stringify(toolContent(...))` markers: `[image: image/png]` is now `[image: image/png, 1 KB]`, `[audio: audio/wav] hello` is now `[audio: audio/wav, 1 KB; transcript: hello]`, and `[file: doc.pdf (application/pdf) https://x/doc.pdf]` is now `[file: application/pdf, doc.pdf at https://x/doc.pdf]`.
- llm-provider degraded-image stubs (`[image omitted: image/png, 41 KB; model has no image input]`) are unchanged; they now come from the core helper. The record stub (`inlineMediaStub`) and replay placeholder (`mediaPlaceholder`) are unchanged.
