# ---- build ----
FROM node:22-alpine AS build

WORKDIR /app
# git is needed to install the p2f-lib dependency from GitHub.
RUN apk add --no-cache git
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build
# Drop the dev dependencies so the node_modules copied below is production-only.
RUN npm prune --omit=dev

# ---- run ----
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# Reuse the pruned, already-built node_modules from the build stage. This
# avoids a second install (and needing git) in the runtime image, and keeps
# the compiled p2f-lib that its install step built.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
