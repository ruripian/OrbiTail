FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 개발 전용 도구(오토리로드 등). docker-compose.yml 이 INSTALL_DEV=1 로 켠다.
# 운영 빌드는 이 인자를 주지 않으므로 아무것도 설치되지 않는다.
ARG INSTALL_DEV=0
COPY requirements-dev.txt .
RUN if [ "$INSTALL_DEV" = "1" ]; then pip install --no-cache-dir -r requirements-dev.txt; fi

COPY . .

RUN python manage.py collectstatic --noinput 2>/dev/null || true

# 서버 시작 전 마이그레이션 자동 실행을 위한 entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
