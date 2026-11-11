FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# Swagger UI estático (versión fija, sin CDN) para /docs/.
FROM node:22-alpine AS swagger
WORKDIR /swagger
COPY infra/gateway/swagger/package.json ./
RUN npm install --no-audit --no-fund --omit=dev

FROM nginx:1.28-alpine AS runtime
COPY infra/gateway/nginx.conf /etc/nginx/nginx.conf
COPY infra/gateway/requiere-jwt.conf /etc/nginx/requiere-jwt.conf
COPY infra/gateway/auth.js /etc/nginx/njs/auth.js
COPY --from=build /app/dist /usr/share/nginx/html
COPY infra/gateway/index.html /usr/share/nginx/html/consola.html
COPY --from=swagger /swagger/node_modules/swagger-ui-dist/swagger-ui.css \
     /swagger/node_modules/swagger-ui-dist/swagger-ui-bundle.js \
     /swagger/node_modules/swagger-ui-dist/swagger-ui-standalone-preset.js \
     /swagger/node_modules/swagger-ui-dist/favicon-32x32.png \
     /swagger/node_modules/swagger-ui-dist/favicon-16x16.png \
     /usr/share/nginx/html/docs/
COPY infra/gateway/swagger/index.html infra/gateway/swagger/contratos.js /usr/share/nginx/html/docs/
COPY docs/contracts/openapi-fav-v1.yaml docs/contracts/openapi-empleados-v1.yaml /usr/share/nginx/html/docs/contracts/
EXPOSE 80
