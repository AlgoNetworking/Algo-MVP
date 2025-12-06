FROM node:20-bullseye-slim

# Install Chromium and required libraries for puppeteer/puppeteer-core
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    wget \
    gnupg \
    chromium \
    libasound2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libxss1 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxkbfile1 \
    libgbm1 \
    libpango-1.0-0 \
    libgobject-2.0-0 \
    libnss3 \
    libx11-6 \
    libxcb1 \
    libxext6 \
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
