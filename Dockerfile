FROM node:22-alpine AS deps
WORKDIR /app
# build-base/python3 are needed to compile better-sqlite3's native addon on alpine
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# su-exec drops from root to the node user after entrypoint.sh has adjusted
# its uid/gid and fixed ownership of the data volume, mirroring the
# PUID/PGID pattern used by linuxserver.io-style images.
RUN apk add --no-cache su-exec
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY views ./views
COPY public ./public
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
# Deliberately no USER directive here: the container must start as root so
# entrypoint.sh can create the node user at the requested PUID/PGID and
# chown /app/data, then it drops to that user via su-exec before running node.
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "src/server.js"]
