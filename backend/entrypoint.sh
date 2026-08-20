#!/bin/sh
# ── DB 연결 대기 ──
# depends_on: service_healthy로 DB 시작은 보장되지만,
# Docker 네트워크 초기화 타이밍에 따라 DNS 해석이 지연될 수 있음.
# Python으로 직접 연결 시도하여 안정적으로 대기.

echo "Waiting for database..."
MAX_RETRIES=15
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
  python -c "
import django, sys
import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.development')
django.setup()
from django.db import connection
connection.ensure_connection()
" 2>/dev/null && break
  RETRY=$((RETRY + 1))
  echo "  DB not ready (attempt $RETRY/$MAX_RETRIES)..."
  sleep 2
done

if [ $RETRY -eq $MAX_RETRIES ]; then
  echo "ERROR: Could not connect to database after $MAX_RETRIES attempts"
  exit 1
fi

echo "Database ready!"

# ── 마이그레이션 ──
# 이 이미지는 backend / celery / celery-beat 세 컨테이너가 함께 쓴다.
# 셋이 동시에 뜨면서 각자 migrate 를 돌리면 같은 테이블을 서로 만들다
#   IntegrityError: duplicate key ... pg_type_typname_nsp_index
# 가 나고, operation 이 여럿인 마이그레이션이었다면 절반만 적용된 채 남는다.
#
# 그래서 적용은 backend 한 곳에서만 한다(RUN_MIGRATIONS 미지정 = 적용).
# 나머지는 RUN_MIGRATIONS=0 으로 두고, 적용이 끝날 때까지 기다렸다 시작한다.
# compose 의 depends_on 으로 풀지 않은 이유는 개발 compose 의 backend 에
# 헬스체크가 없어 service_healthy 를 쓸 수 없기 때문이다. 이 방식은 두 환경에서
# 똑같이 동작한다.
if [ "${RUN_MIGRATIONS:-1}" = "0" ]; then
  echo "Waiting for migrations (applied by the backend container)..."
  MIGRATE_MAX_RETRIES=60
  MIGRATE_RETRY=0
  # migrate --check 는 미적용 마이그레이션이 있으면 non-zero 로 끝난다.
  while [ $MIGRATE_RETRY -lt $MIGRATE_MAX_RETRIES ]; do
    python manage.py migrate --check >/dev/null 2>&1 && break
    MIGRATE_RETRY=$((MIGRATE_RETRY + 1))
    sleep 2
  done
  if [ $MIGRATE_RETRY -eq $MIGRATE_MAX_RETRIES ]; then
    echo "ERROR: migrations still pending after $((MIGRATE_MAX_RETRIES * 2))s"
    exit 1
  fi
  echo "Migrations up to date."
else
  python manage.py migrate --noinput
fi

exec "$@"
