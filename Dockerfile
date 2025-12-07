FROM node:20-bullseye-slim

# Install Chromium and required libraries for puppeteer/puppeteer-core
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    wget \
    gnupg \
    xdg-utils \
    chromium \
    gconf-service \
    libasound2 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
  && rm -rf /var/lib/apt/lists/*

# Puppeteer env: don't try to download chromium during npm install
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# Point to system chromium installed via apt
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 5000
CMD ["node", "server.js"]