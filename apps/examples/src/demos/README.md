# Demo: same code, local 4B → frontier

The proof artifact for the launch copy: one builder, run twice, only the
provider/model line changes — and both a 4B local model and Claude complete the
same tool-using task.

## Files
- `local-vs-frontier.ts` — the runnable demo (clean, GIF-friendly output).
- `local-vs-frontier.tape` — a [VHS](https://github.com/charmbracelet/vhs) script that records it to a GIF.

## Prerequisites
1. **Ollama** running with a small model:
   ```bash
   ollama pull qwen3:4b        # matches the on-screen command; or use gemma4:e4b
   ```
2. **ANTHROPIC_API_KEY** in `.env` (bun auto-loads it).
3. **Free GPU** — don't record during an eval/benchmark sweep; it crawls.

## Run it (no recording)
```bash
LOCAL_MODEL=qwen3:4b bun run apps/examples/src/demos/local-vs-frontier.ts
# only local:    SKIP_FRONTIER=1 ...
# only frontier: SKIP_LOCAL=1 ...
```

## Record the GIF
```bash
# install vhs once: brew install vhs   (or: go install github.com/charmbracelet/vhs@latest)
vhs apps/examples/src/demos/local-vs-frontier.tape
# -> apps/examples/src/demos/local-vs-frontier.gif
```
The tape waits (up to 4 min) for the final "Same code. Two models." line, so it
captures the whole run regardless of LLM latency.

## Post-process (LLM runs are slow → the raw GIF is long)
Speed it up + shrink, or convert to MP4 (smaller, autoplays — better for HN/X):
```bash
# 3x speed, 15fps, ~1100px wide GIF
ffmpeg -i local-vs-frontier.gif -filter_complex "[0:v]setpts=PTS/3,fps=15,scale=1100:-1:flags=lanczos" local-vs-frontier-fast.gif

# or MP4 (preferred for social posts)
ffmpeg -i local-vs-frontier.gif -filter:v "setpts=PTS/3" -movflags +faststart -pix_fmt yuv420p local-vs-frontier.mp4
```

## Tips
- Want the agent's step-by-step "thinking" in the GIF instead of clean output?
  Remove the `REACTIVE_AGENTS_DISABLE_STATUS_MODE` line at the top of the `.ts`.
- For the crispest loop, trim to: command typed → local completes → frontier
  completes → verdict.
