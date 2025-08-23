# Use Node.js 18 on Ubuntu for better Prisma compatibility
FROM node:18-slim

# Update package list and install required dependencies
RUN apt-get update && apt-get install -y \
    openssl \
    libssl3 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first for better Docker caching
COPY package.json package-lock.json ./

# Copy Prisma schema
COPY prisma ./prisma/

# Install dependencies
RUN npm ci --only=production

# Generate Prisma Client
RUN npx prisma generate

# Copy the rest of the application code
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Create non-root user for security
RUN useradd -r -s /bin/false nodeuser && chown -R nodeuser:nodeuser /app
USER nodeuser

# Expose port
EXPOSE 8080

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Start the application
CMD ["node", "src/app.js"]