FROM oven/bun:1
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .
EXPOSE 3001
CMD sh -c "bun run db:migrate 2>&1; echo EXIT=$?; bun run src/index.ts"
