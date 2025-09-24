# Minimal Node image to run sendtx.js and collect.js
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm install --production

# Copy source code
COPY . .

# Ensure scripts are executable
RUN chmod +x sendtx.js collect.js run-sendtx.sh scripts/run-collector.sh 2>/dev/null || true

# Default entrypoint can be overridden by docker-compose service commands
ENTRYPOINT ["node"]
