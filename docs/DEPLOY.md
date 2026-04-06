# OrbiTail — 프로덕션 배포 가이드

## 사전 요구사항

- Docker + Docker Compose
- 도메인 (HTTPS 적용 시)
- SMTP 서비스 (이메일 발송 시, 선택)

---

## 1. 환경 변수 설정

```bash
cp .env.example .env
```

`.env` 파일에서 **반드시** 수정해야 할 항목:

| 변수 | 설명 | 예시 |
|------|------|------|
| `SECRET_KEY` | Django 시크릿 키 (유니크 랜덤 문자열) | `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"` |
| `DEBUG` | **반드시 `False`** | `False` |
| `ALLOWED_HOSTS` | 서버 도메인/IP | `your-domain.com,www.your-domain.com` |
| `CORS_ALLOWED_ORIGINS` | 프론트엔드 URL | `https://your-domain.com` |
| `POSTGRES_PASSWORD` | DB 비밀번호 (강력한 값) | `super-strong-password-123!` |
| `FRONTEND_URL` | 프론트엔드 URL (이메일 링크용) | `https://your-domain.com` |

---

## 2. 프로덕션 실행

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

서비스 구성:
- `db` — PostgreSQL 16
- `redis` — Redis 7
- `backend` — Django (Daphne ASGI, HTTP + WebSocket)
- `celery` — Celery Worker (비동기 작업)
- `celery-beat` — Celery Beat (스케줄 작업: 이슈 자동 아카이브, 알림 정리)
- `frontend` — React (Nginx 정적 서빙)
- `nginx` — 리버스 프록시 (80/443 포트)

---

## 3. HTTPS 설정 (Let's Encrypt)

### 3-1. Certbot 설치 및 인증서 발급

```bash
# 서버에서 직접 실행
sudo apt install certbot
sudo certbot certonly --standalone -d your-domain.com
```

### 3-2. docker-compose.prod.yml에 인증서 볼륨 추가

```yaml
nginx:
  volumes:
    - static_files:/app/staticfiles
    - media_files:/app/mediafiles
    - /etc/letsencrypt:/etc/letsencrypt:ro  # 추가
```

### 3-3. nginx.conf 수정

`nginx/nginx.conf` 파일 하단의 HTTPS 서버 블록 주석을 해제하고,
HTTP 서버 블록에서 `return 301 https://$host$request_uri;` 주석을 해제합니다.

### 3-4. 인증서 자동 갱신

```bash
# crontab -e
0 3 1 * * certbot renew --quiet && docker compose -f docker-compose.prod.yml restart nginx
```

---

## 4. SMTP 설정 (이메일 발송)

`.env` 파일에서 이메일 관련 변수를 설정합니다.

### SendGrid 예시

```env
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=apikey
EMAIL_HOST_PASSWORD=SG.xxxxxxxxxxxxxxxx
DEFAULT_FROM_EMAIL=noreply@your-domain.com
```

### AWS SES 예시

```env
EMAIL_HOST=email-smtp.us-east-1.amazonaws.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=AKIA...
EMAIL_HOST_PASSWORD=...
DEFAULT_FROM_EMAIL=noreply@your-domain.com
```

> SMTP 미설정 시 이메일 인증은 자동 승인으로 동작합니다.

---

## 5. 운영 관리

### 로그 확인

```bash
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f celery
```

### DB 백업

```bash
docker compose -f docker-compose.prod.yml exec db pg_dump -U ouroboros ouroboros > backup_$(date +%Y%m%d).sql
```

### DB 복원

```bash
cat backup.sql | docker compose -f docker-compose.prod.yml exec -T db psql -U ouroboros ouroboros
```

### Django 관리 명령어

```bash
docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser
docker compose -f docker-compose.prod.yml exec backend python manage.py shell
```

---

## 6. 업데이트 배포

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

마이그레이션은 `entrypoint.sh`에서 자동 실행됩니다.
