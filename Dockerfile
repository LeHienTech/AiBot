FROM node:22-bookworm

# Install system dependencies (Python 3 and FFmpeg required for yt-dlp/discord.js)
RUN apt-get update && \
    apt-get install -y python3 ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies (patches/ needed for postinstall: patch-package)
COPY package.json package-lock.json ./
COPY patches/ patches/
RUN npm ci

# Copy application files
COPY . .

# Start the application
CMD ["npm", "start"]
