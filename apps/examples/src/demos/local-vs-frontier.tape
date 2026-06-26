# VHS tape — records the "same code, local 4B -> frontier" demo to a GIF.
# https://github.com/charmbracelet/vhs   (install: brew install vhs / go install / docker)
#
# Prereqs before recording:
#   - Ollama running with a small model:  ollama pull qwen3:4b   (or use gemma4:e4b)
#   - ANTHROPIC_API_KEY in .env (bun auto-loads it)
#   - GPU free (don't record during an eval sweep — it crawls)
#
# Record:   vhs apps/examples/src/demos/local-vs-frontier.tape
# Output:   apps/examples/src/demos/local-vs-frontier.gif

Output apps/examples/src/demos/local-vs-frontier.gif

Set Shell bash
Set FontSize 15
Set Width 1180
Set Height 760
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms

# Show the command, then run it.
Type "LOCAL_MODEL=qwen3:4b bun run apps/examples/src/demos/local-vs-frontier.ts"
Sleep 600ms
Enter

# Wait until the final verdict line appears (up to 4 min — LLM latency varies),
# then hold a beat so the ending is readable in the loop.
Wait+Screen@240s /Same code. Two models/
Sleep 2500ms
