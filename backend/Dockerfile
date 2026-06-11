FROM oven/bun:1
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .
EXPOSE 3001
CMD bun run db:generate && bun run db:migrate && bun run db:seed && bun run src/index.ts
