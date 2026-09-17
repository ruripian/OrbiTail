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

# TLS 를 이 컨테이너에서 종단할지 명시한다.
#   auto (기본) — DOMAIN 이 있으면 HTTPS, 없으면 HTTP. 예전 동작 그대로.
#   off        — 항상 HTTP. 앞단(호스트 nginx·Caddy 등)이 TLS 를 끝내는 경우.
# 예전에는 이 구분이 DOMAIN 하나에 얹혀 있었다. 그래서 앞단에서 TLS 를 끝내려면
# nginx 쪽 DOMAIN 만 비우는 수밖에 없었는데, 같은 변수를 Django 는 "HTTPS 로
# 서비스한다" 는 뜻으로 읽어 두 서비스가 같은 값을 다르게 해석하게 됐다.
: "${NGINX_TLS:=auto}"

case "$NGINX_TLS" in
    auto|off) ;;
    *) echo "[nginx] NGINX_TLS 값이 올바르지 않습니다: '$NGINX_TLS' (auto 또는 off)" >&2; exit 1 ;;
esac

if [ "$NGINX_TLS" = "off" ]; then
    echo "[nginx] NGINX_TLS=off → HTTP 모드 (TLS 는 앞단에서 종단, max upload ${MAX_UPLOAD_SIZE_MB}M)"
    envsubst '${MAX_UPLOAD_SIZE_MB}' < "$TEMPLATE_DIR/http.conf.template" > "$CONF_DIR/default.conf"
elif [ -n "$DOMAIN" ]; then
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
