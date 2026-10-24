FROM denoland/deno:2.6.6

WORKDIR /app

# Copy dependency manifests + server first so Docker caches the dependency
# layer across builds. deno cache takes no permission flags (unlike deno run).
COPY deno.jsonc deno.lock ./
COPY server/ server/
RUN deno cache server/main.ts

COPY . .

# Render (and most hosts) route traffic to the app via $PORT; must bind all
# interfaces to be reachable from outside the container
ENV HOST=0.0.0.0

EXPOSE 10000

CMD ["deno", "run", "-A", "server/main.ts"]
