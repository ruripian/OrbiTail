#!/usr/bin/env bash
# 배포 후 문서 실시간 협업(collab)이 실제로 닿는지 확인한다.
#
# 이 세 가지는 컨테이너가 "Up" 이어도 따로 깨질 수 있어, 기동 확인만으로는
# 잡히지 않는다. 실제로 그렇게 새어 나간 적이 있다.
#   1. nginx 가 /collab 을 프록시하는가          (템플릿에 블록이 빠지면 404/프론트로 샌다)
#   2. collab → backend 내부 호출이 통하는가      (ALLOWED_HOSTS 에 backend 가 없으면 400)
#   3. /collab 이 WebSocket 으로 업그레이드되는가 (101)
#
# 사용: scripts/smoke-collab.sh [https://your-domain.com]
#       도메인을 안 주면 1·2번만 본다.
set -uo pipefail

COMPOSE="${COMPOSE:-docker compose}"
URL="${1:-}"
fail=0
ok()   { echo "  OK   $*"; }
bad()  { echo "  FAIL $*"; fail=1; }

echo "1) nginx 에 /collab 블록"
if ! $COMPOSE ps --services 2>/dev/null | grep -qx nginx; then
  echo "  --   nginx 서비스 없음 (개발 구성은 vite 프록시를 쓴다) — 건너뜀"
elif $COMPOSE exec -T nginx nginx -T 2>/dev/null | grep -q "location /collab"; then
  ok "nginx -T 에 location /collab 있음"
else
  bad "nginx 설정에 /collab 이 없다 — templates/*.conf.template 확인"
fi

echo "2) collab → backend 내부 호출 (Host 헤더가 backend:8000)"
code=$($COMPOSE exec -T collab sh -c \
  'wget -qS -O /dev/null "$COLLAB_API_BASE/../internal/collab/documents/00000000-0000-0000-0000-000000000000/state/" 2>&1 | awk "/HTTP\//{print \$2; exit}"' \
  2>/dev/null || true)
case "$code" in
  400) bad "400 DisallowedHost — ALLOWED_HOSTS 에 backend 가 없다" ;;
  403) ok  "403 (비밀값 불일치) — 호스트는 통과" ;;
  404) ok  "404 (없는 문서) — 인증·호스트 모두 통과" ;;
  "")  bad "응답 없음 — collab 컨테이너가 떠 있는지 확인" ;;
  *)   ok  "HTTP $code" ;;
esac

if [ -n "$URL" ]; then
  echo "3) $URL/collab WebSocket 업그레이드"
  code=$(curl -sS -o /dev/null -w "%{http_code}" -m 10 \
    -H "Connection: Upgrade" -H "Upgrade: websocket" \
    -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: $(head -c16 /dev/urandom | base64)" \
    "$URL/collab" 2>/dev/null || echo "000")
  [ "$code" = "101" ] && ok "101 Switching Protocols" || bad "101 이 아니라 $code"
else
  echo "3) (도메인 미지정 — 건너뜀)"
fi

echo
[ "$fail" -eq 0 ] && echo "협업 경로 정상" || echo "문제 있음 — 위 FAIL 항목 확인"
exit "$fail"
