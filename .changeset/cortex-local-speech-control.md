---
"@reactive-agents/cortex": minor
---

Settings · Voice now controls the local speech server (Speaches) fully: Start and Stop buttons, a port field and a CPU / GPU (NVIDIA) / Auto hardware choice, and switching "Keep the local speech server running" off now stops the container. Changing the port moves the listening and reading endpoints to it and re-creates the Cortex container there (downloaded models are kept). The model fields list what the speech server has installed and what it can download (searchable, with a free-text option); saving a model that is not installed downloads it. The local server is always called on `127.0.0.1`, so an endpoint saved as `localhost` or `[::1]` no longer fails where `localhost` resolves to IPv6 first.
