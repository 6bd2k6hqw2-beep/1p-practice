FROM node:22-alpine AS deps
WORKDIR /app
# build-base/python3 are needed to compile better-sqlite3's native addon on alpine
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY views ./views
COPY public ./public
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
