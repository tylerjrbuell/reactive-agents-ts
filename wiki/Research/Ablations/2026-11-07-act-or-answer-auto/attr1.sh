#!/usr/bin/env bash
f=$1; out=$(timeout 60 bun /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/diagnose/src/cli.ts attribute "$f" --json 2>/dev/null | tr -d '\n'); echo "{\"file\":\"$f\",\"attr\":${out:-null}}"
