# syntax=docker/dockerfile:1.7

FROM oven/bun:1.1.34 AS base
WORKDIR /app

ARG JUDGE_MODEL_SHA=unknown
ARG JUDGE_CODE_SHA=unknown
ENV JUDGE_MODEL_SHA=${JUDGE_MODEL_SHA}
ENV JUDGE_CODE_SHA=${JUDGE_CODE_SHA}
ENV JUDGE_LAYER=live
ENV PORT=8910

# Copy workspace manifests first for cache efficiency
COPY package.json bun.lock turbo.json ./
COPY packages/judge-server/package.json packages/judge-server/
COPY packages/eval/package.json packages/eval/
COPY packages/llm-provider/package.json packages/llm-provider/
COPY packages/memory/package.json packages/memory/
COPY packages/core/package.json packages/core/

RUN bun install --frozen-lockfile

# Copy sources (workspace deps + judge-server itself)
COPY packages/judge-server packages/judge-server
COPY packages/eval packages/eval
COPY packages/llm-provider packages/llm-provider
COPY packages/memory packages/memory
COPY packages/core packages/core

EXPOSE 8910

CMD ["bun", "run", "packages/judge-server/src/index.ts"]
