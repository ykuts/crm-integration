# Use Node.js 18 on Alpine Linux
FROM node:18-alpine

# Install OpenSSL compatibility library for Prisma
RUN apk add --no-cache openssl1.1-compat libssl1.1

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Copy Prisma schema
COPY prisma ./prisma/

# Install dependencies
RUN npm ci --only=production

# Generate Prisma Client with correct binary target
ENV PRISMA_CLI_BINARY_TARGETS="linux-musl-openssl-1.1.x"
RUN npx prisma generate

# Copy source code
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Start the application
CMD ["node", "src/app.js"]