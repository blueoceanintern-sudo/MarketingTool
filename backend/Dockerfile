FROM oven/bun:1
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .
EXPOSE 3001
CMD sh -c "bun run src/migrate.ts && bun run src/db/seed.ts && bun run src/db/seed-emails.ts; bun run src/index.ts"
