#!/bin/sh
# ═══════════════════════════════════════════════════
# Nginx 진입점 — DOMAIN 환경변수 유무에 따라 HTTP/HTTPS 분기
# ═══════════════════════════════════════════════════
set -e

CONF_DIR="/etc/nginx/conf.d"
TEMPLATE_DIR="/etc/nginx/templates"

# 업로드 크기 기본값 (compose env 미주입 시)
: "${MAX_UPLOAD_SIZE_MB:=10}"
export MAX_UPLOAD_SIZE_MB

if [ -n "$DOMAIN" ]; then
    echo "[nginx] DOMAIN=$DOMAIN 감지 → HTTPS 모드 (max upload ${MAX_UPLOAD_SIZE_MB}M)"

    # 인증서가 아직 없으면 임시 self-signed 생성 (certbot 발급 전 nginx 기동용)
    CERT_PATH="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
    KEY_PATH="/etc/letsencrypt/live/$DOMAIN/privkey.pem"

    if [ ! -f "$CERT_PATH" ]; then
        echo "[nginx] 인증서 미발견 → 임시 self-signed 인증서 생성"
        mkdir -p "/etc/letsencrypt/live/$DOMAIN"
        openssl req -x509 -nodes -days 1 \
            -newkey rsa:2048 \
            -keyout "$KEY_PATH" \
            -out "$CERT_PATH" \
            -subj "/CN=$DOMAIN" 2>/dev/null
    fi

    # HTTPS 템플릿 — 도메인 + 업로드 크기 치환
    envsubst '${DOMAIN} ${MAX_UPLOAD_SIZE_MB}' < "$TEMPLATE_DIR/https.conf.template" > "$CONF_DIR/default.conf"
else
    echo "[nginx] DOMAIN 미설정 → HTTP 모드 (max upload ${MAX_UPLOAD_SIZE_MB}M)"
    envsubst '${MAX_UPLOAD_SIZE_MB}' < "$TEMPLATE_DIR/http.conf.template" > "$CONF_DIR/default.conf"
fi

# nginx 실행
exec nginx -g "daemon off;"
