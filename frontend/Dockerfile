FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# vite.config.ts의 loadEnv envDir = repo 루트(../).
# docker build context가 ./frontend라 루트 .env가 안 따라옴 → compose build args로 주입받아
# 빌드 컨테이너 내 envDir(=/)에 생성. 추가 VITE_* 변수가 생기면 여기에 늘려라.
ARG VITE_SHOW_SPONSOR=true
ARG VITE_MAX_UPLOAD_SIZE_MB=100
RUN printf "VITE_SHOW_SPONSOR=%s\nVITE_MAX_UPLOAD_SIZE_MB=%s\n" \
      "$VITE_SHOW_SPONSOR" "$VITE_MAX_UPLOAD_SIZE_MB" > /.env

RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
