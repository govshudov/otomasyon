# Derleme aşaması
FROM node:22-slim AS build
WORKDIR /app
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
# Tüm istasyon modelleri. Yeni istasyon eklenince buraya dokunmak gerekmez —
# üretici build/ dizinine yazar, bu satır hepsini alır.
COPY build/*.glb build/*-twin-map.json ./public/models/
RUN npm run build

# Sunum aşaması — Pi'de çalışan tek şey nginx
FROM nginx:alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
