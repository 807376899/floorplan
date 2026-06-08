FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5173

COPY package.json ./
COPY server.js ./
COPY app.js ./
COPY index.html ./
COPY styles.css ./
COPY sample-floors.csv ./
COPY sample-rooms.csv ./
COPY js ./js
COPY server ./server
COPY scripts ./scripts

RUN mkdir -p /app/data/uploads /app/data/backups

EXPOSE 5173
VOLUME ["/app/data"]

CMD ["node", "server.js"]
