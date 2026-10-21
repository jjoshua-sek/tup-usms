# STARS for the offline LAN copy. Built by lan/docker-compose.stars.yml with
# the repository as context; the online site on Vercel does not use this.
#
# NEXT_PUBLIC_* values are compiled into the browser code, so they are build
# arguments: the LAN address and this install's own anon key.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_CLOUD_APP_URL
# NODE_OPTIONS is capped so the build fits beside a running Supabase in Docker
# Desktop's default memory (about 8 GB): at 4 GB it took the engine down.
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_CLOUD_APP_URL=$NEXT_PUBLIC_CLOUD_APP_URL \
    STARS_OFFLINE=true \
    STARS_STANDALONE=true \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=3072
COPY --from=deps /app/node_modules ./node_modules
# Only what the app is built from, so editing lan/ never forces a rebuild.
COPY package.json package-lock.json next.config.ts tsconfig.json postcss.config.mjs components.json next-env.d.ts ./
COPY public ./public
COPY src ./src
# The typeface is fetched from Google Fonts here, once, while there is
# internet; the running copy serves it itself.
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1 \
    STARS_OFFLINE=true
RUN addgroup -S stars && adduser -S stars -G stars
COPY --from=build --chown=stars:stars /app/.next/standalone ./
COPY --from=build --chown=stars:stars /app/.next/static ./.next/static
COPY --from=build --chown=stars:stars /app/public ./public
COPY --chown=stars:stars lan/scripts/wait-for-file.sh /usr/local/bin/wait-for-file
USER stars
EXPOSE 3000
# Waits for Caddy's local certificate authority, which the server trusts
# (NODE_EXTRA_CA_CERTS) when it calls Supabase at the LAN address.
CMD ["sh", "-c", "wait-for-file \"$NODE_EXTRA_CA_CERTS\" && exec node server.js"]
