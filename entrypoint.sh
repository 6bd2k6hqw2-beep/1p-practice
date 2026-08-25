#!/bin/sh
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# The base node:alpine image ships a "node" user/group at 1000:1000. Only
# rebuild it if the requested PUID/PGID differ, so the common case (leaving
# PUID/PGID unset) does no extra work.
if [ "$(id -u node)" != "$PUID" ] || [ "$(id -g node)" != "$PGID" ]; then
  deluser node 2>/dev/null || true
  delgroup node 2>/dev/null || true
  addgroup -g "$PGID" node
  adduser -D -H -G node -u "$PUID" node
fi

mkdir -p /app/data
chown -R node:node /app/data

echo "Starting as PUID=$PUID PGID=$PGID"
exec su-exec node "$@"
