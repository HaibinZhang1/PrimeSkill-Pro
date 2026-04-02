FROM node:20-alpine
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/search-worker/package.json ./apps/search-worker/package.json
COPY packages ./packages
RUN pnpm install --frozen-lockfile

COPY apps/backend ./apps/backend
EXPOSE 3000
CMD ["pnpm", "--filter", "@prime/backend", "start"]
