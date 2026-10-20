FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM nginx:1.28-alpine AS runtime
COPY infra/gateway/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY infra/gateway/index.html /usr/share/nginx/html/consola.html
EXPOSE 80
