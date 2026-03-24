# Build stage
FROM node:18-slim AS builder

WORKDIR /app

# Enable legacy peer deps if needed for specific packages
COPY package*.json ./
RUN npm install

COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:18-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy only necessary files
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules

# Expose port
EXPOSE 3000

# Start command
CMD ["npm", "start"]
