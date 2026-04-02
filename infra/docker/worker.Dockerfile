FROM node:20-alpine
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/search-worker/package.json ./apps/search-worker/package.json
COPY packages ./packages
RUN pnpm install --frozen-lockfile

COPY apps/search-worker ./apps/search-worker
CMD ["pnpm", "--filter", "@prime/search-worker", "start"]
