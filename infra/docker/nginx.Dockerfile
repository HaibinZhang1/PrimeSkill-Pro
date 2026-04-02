FROM node:20-alpine AS admin-builder
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @prime/admin-web build

FROM nginx:1.27-alpine
COPY infra/docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=admin-builder /app/apps/admin-web/dist /usr/share/nginx/html
EXPOSE 80
