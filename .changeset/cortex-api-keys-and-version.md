---
"@reactive-agents/cortex": minor
---

Settings · Providers can now add, replace, test and remove an API key per provider. Keys are stored only on the Cortex server, encrypted with AES-256-GCM in `.cortex/` (key file and keys file mode 0600), and never sent back to the browser: rows show `••••` plus the last four characters and whether agents use the saved key or the environment's. An environment key wins unless you choose the saved one. Agents get the saved key through `.withProvider(provider, { apiKey })` on every build path (chat, desk runs, gateway agents); `process.env` is never changed. The model list and key-missing labels count a saved key. Anthropic and Gemini saved keys reach Test and the model list only until the framework adapters accept a passed key; the row says so.

Settings · About now shows the real Cortex version and the framework version. In a source checkout both come from the repo `VERSION` file plus the git commit, instead of the frozen workspace `package.json` baseline (`0.10.6`).
