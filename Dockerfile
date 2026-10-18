FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN mkdir -p /data && chown node:node /data

ENV PORT=3000 \
    DB_FILE=/data/codebattle.db
VOLUME /data
EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/leaderboard > /dev/null || exit 1

CMD ["node", "server.js"]
