FROM denoland/deno:debian

WORKDIR /app

COPY package.json package-lock.json deno.json deno.lock ./
RUN deno install --allow-scripts

COPY . .
RUN deno cache src/index.ts

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "deno serve --port ${PORT} -A src/index.ts"]
