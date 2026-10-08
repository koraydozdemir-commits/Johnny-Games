FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium xvfb x11vnc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
COPY public ./public

ENV DISPLAY=:99
ENV PORT=3000
ENV CHROMIUM_BIN=/usr/bin/chromium

EXPOSE 3000
USER node
CMD ["node", "server.js"]
