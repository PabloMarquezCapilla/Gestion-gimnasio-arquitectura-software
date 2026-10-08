FROM node:22-alpine AS build
WORKDIR /app
ARG SERVICE

COPY package.json package-lock.json tsconfig.base.json ./
COPY services/socios-membresias/package.json services/socios-membresias/package.json
COPY services/clases-reservas/package.json services/clases-reservas/package.json
COPY services/accesos-ocupacion/package.json services/accesos-ocupacion/package.json
RUN npm ci --workspace=@gimnasio/${SERVICE} --include-workspace-root --ignore-scripts
COPY services/${SERVICE}/ services/${SERVICE}/
RUN npm run build --workspace=@gimnasio/${SERVICE} \
    && npm prune --omit=dev --workspace=@gimnasio/${SERVICE} --include-workspace-root --ignore-scripts

FROM node:22-alpine AS runtime
WORKDIR /app
ARG SERVICE
ENV NODE_ENV=production
ENV SERVICE_NAME=${SERVICE}
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/services/${SERVICE}/package.json ./services/${SERVICE}/package.json
COPY --from=build --chown=node:node /app/services/${SERVICE}/dist ./services/${SERVICE}/dist
COPY --chown=node:node docs/contracts/openapi-v1.yaml ./docs/contracts/openapi-v1.yaml
USER node
EXPOSE 3000
CMD ["sh", "-c", "exec node services/$SERVICE_NAME/dist/server.js"]
