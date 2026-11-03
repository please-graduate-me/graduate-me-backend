FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY backend/prisma ./backend/prisma
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @graduate-me/api build
EXPOSE 4000
CMD ["sh", "-c", "pnpm db:migrate && pnpm db:seed && pnpm --filter @graduate-me/api start"]
