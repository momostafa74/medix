FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
# Headless Chromium renders the Arabic PDF reports (lab results, later prescriptions/radiology).
RUN apk add --no-cache chromium nss freetype harfbuzz ttf-freefont
WORKDIR /app
RUN addgroup -S medix && adduser -S medix -G medix
COPY --from=build --chown=medix:medix /app/node_modules ./node_modules
COPY --from=build --chown=medix:medix /app/dist ./dist
COPY --from=build --chown=medix:medix /app/assets ./assets
COPY --chown=medix:medix package.json ./
RUN mkdir -p /app/storage && chown medix:medix /app/storage
USER medix
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
# Run pending migrations, then start. synchronize is never used.
CMD ["sh", "-c", "npm run migration:run:prod && node dist/main.js"]
