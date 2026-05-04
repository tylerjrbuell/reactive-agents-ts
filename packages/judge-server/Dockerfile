# syntax=docker/dockerfile:1.7

FROM oven/bun:1.1.34 AS base
WORKDIR /app

ARG JUDGE_MODEL_SHA=unknown
ARG JUDGE_CODE_SHA=unknown
ENV JUDGE_MODEL_SHA=${JUDGE_MODEL_SHA}
ENV JUDGE_CODE_SHA=${JUDGE_CODE_SHA}
ENV JUDGE_LAYER=live
ENV PORT=8910

# Copy workspace manifests first for cache efficiency.
# Bun's --frozen-lockfile walks every workspace pattern in the root
# package.json, so EVERY workspace's package.json must exist in the build
# context — even ones the judge-server doesn't depend on directly.
COPY package.json bun.lock turbo.json ./
COPY packages/ packages/
COPY apps/ apps/

# --ignore-scripts skips native postinstall (tree-sitter needs python+g++);
# the judge-server runtime path doesn't touch any package whose install
# script is required, so skipping is safe and keeps the image slim.
RUN bun install --frozen-lockfile --ignore-scripts

# Sources are already copied above (one-shot to satisfy workspace resolver).
# Judge-server entrypoint reads from packages/judge-server/src/index.ts.

EXPOSE 8910

CMD ["bun", "run", "packages/judge-server/src/index.ts"]
