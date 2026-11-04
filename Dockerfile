FROM denoland/deno:debian

WORKDIR /app

COPY package.json package-lock.json deno.json deno.lock ./
RUN deno install --allow-scripts

COPY . .
RUN deno cache src/index.ts

ENV PORT=8080
EXPOSE 8080

# --quiet: deno serve prints its "Listening" banner to stderr, which Railway
#   logs as an error.
# --unstable-no-legacy-abort: request.signal only aborts on client disconnect,
#   which is what the /mcp cleanup handlers expect (and silences Deno's
#   legacy-abort warning).
CMD ["sh", "-c", "deno serve --quiet --unstable-no-legacy-abort --port ${PORT} -A src/index.ts"]
