# Build stage: install dependencies and build static assets
FROM node:22-slim AS builder

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY package.json package-lock.json ./

# Install dependencies (ci = clean install from lockfile)
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Runtime stage: serve static files with nginx
FROM nginx:1.27-alpine

# Install curl for healthcheck
RUN apk add --no-cache curl

# Create unprivileged user (matching sibling projects)
RUN addgroup --system orion && adduser --system --ingroup orion --no-create-home orion

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy nginx config template (envsubst replaces ${ORION_URL} at startup)
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Copy built static files
COPY --from=builder /app/dist /usr/share/nginx/html

# Adjust permissions for non-root operation
RUN chown -R orion:orion /usr/share/nginx/html \
    && chown -R orion:orion /var/cache/nginx \
    && chown -R orion:orion /var/log/nginx \
    && touch /var/run/nginx.pid && chown orion:orion /var/run/nginx.pid \
    && chown -R orion:orion /etc/nginx/conf.d

USER orion

# Only substitute ORION-prefixed variables (protect nginx $uri, $host, etc.)
ENV NGINX_ENVSUBST_FILTER=ORION

# Default backend URL (override in docker-compose or k8s)
ENV ORION_URL=http://localhost:8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/_health || exit 1

CMD ["nginx", "-g", "daemon off;"]
