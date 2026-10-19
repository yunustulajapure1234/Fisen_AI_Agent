# Multi-stage or optimized production image for FISEN Technologies AI Assistant
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Install dependencies (only production packages)
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy application source code and public assets
COPY . .

# Expose server port
EXPOSE 3000

# Built-in health check using Node 20 native fetch
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the application
CMD ["node", "server.js"]
