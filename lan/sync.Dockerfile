# The five-minute copy and the nightly backup (lan/scripts/sync.mjs,
# backup.mjs): Node, PostgreSQL 17's pg_dump and psql (at least as new as the
# cloud database), and openssl to encrypt backups.
FROM node:24-alpine
RUN apk add --no-cache postgresql17-client openssl tzdata
WORKDIR /app
COPY lan/scripts ./lan/scripts
USER node
CMD ["node", "lan/scripts/sync.mjs", "--loop"]
