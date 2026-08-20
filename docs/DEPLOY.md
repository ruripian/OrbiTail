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
docker compose -f docker-compose.prod.yml exec db pg_dump -U orbitail orbitail > backup_$(date +%Y%m%d).sql
```

### DB 복원

```bash
cat backup.sql | docker compose -f docker-compose.prod.yml exec -T db psql -U orbitail orbitail
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

이 방식은 소스 트리를 그대로 빌드해 `:local` 태그로 띄웁니다. 간단한 대신
문제가 생겼을 때 되돌리려면 이전 커밋을 체크아웃해 다시 빌드해야 합니다.
재빌드 없이 되돌리고 싶다면 다음 절을 보세요.

---

## 7. 이미지 태그로 배포 고정하기

`docker-compose.prod.yml` 은 이미지를 `orbitail-backend:${TAG}` 처럼 참조합니다.
`TAG` 에 배포한 커밋 SHA 를 넣어두면

- `docker ps` 만 봐도 운영이 어느 커밋을 돌고 있는지 알 수 있고
- 되돌릴 때 `TAG` 만 이전 값으로 바꿔 재시작하면 됩니다 (재빌드 불필요)

### 빌드

작업 트리가 아니라 **임시 worktree** 에서 빌드하기를 권합니다. 커밋되지 않은
변경이 섞여 들어가면 이미지 내용이 `TAG` 로 붙인 SHA 와 달라집니다.

```bash
SHA=$(git rev-parse --short HEAD)
git worktree add /tmp/build $SHA
cd /tmp/build
TAG=$SHA docker compose -f docker-compose.prod.yml --env-file /path/to/.env build
cd - && git worktree remove /tmp/build
```

### 배포

`.env` 의 `TAG` 를 방금 빌드한 SHA 로 바꾸고 올립니다.

```bash
docker compose -f docker-compose.prod.yml up -d
```

`--build` 를 붙이지 않는 점에 유의하세요. 이미 만들어 둔 이미지를 그대로 씁니다.

### 되돌리기

```bash
# .env 의 TAG 를 이전 SHA 로 바꾼 뒤
docker compose -f docker-compose.prod.yml up -d
```

이미지가 로컬에 없으면 `pull_policy: never` 때문에 그 자리에서 실패합니다.
Docker Hub 에서 동명의 엉뚱한 이미지를 받아오는 사고를 막기 위한 것입니다.

### 운영에 소스 트리를 두지 않기

런타임 마운트는 전부 named volume 이라 컨테이너는 소스 파일을 읽지 않습니다.
빌드 시점에만 필요하므로, 운영 서버에는 다음 세 가지만 두어도 동작합니다.

```
docker-compose.prod.yml
.env
(선택) docker-compose.<환경>.yml   # 앞단 프록시용 오버라이드 등
```

---

## 8. 공개 데모 모드

아무나 들어와 둘러보게 하는 배포용 모드입니다. `.env` 에 다음을 넣습니다.

```env
DEMO_MODE=True
```

켜지면 이렇게 동작합니다.

- 첫 화면이 로그인이 아니라 **데모 안내 화면**이 됩니다. "데모 시작" 을 누르면
  그 방문자만의 워크스페이스 2개(Nimbus Studio, Orbit Labs)가 즉시 만들어지고
  로그인 없이 들어갑니다.
- 방문자끼리 완전히 분리됩니다. 남이 무엇을 바꾸거나 지워도 서로 보이지 않습니다.
- 샌드박스는 `DEMO_SANDBOX_TTL_HOURS`(기본 24) 뒤 celery beat 가 통째로 지웁니다.
- 관리자 콘솔·감사 로그·Django admin, 파일 업로드, 메일 발송이 차단됩니다.

샌드박스는 페이지 진입이 아니라 **버튼 클릭 시점에** 만들어집니다. 진입만으로
만들면 크롤러가 훑을 때마다 워크스페이스가 생성되기 때문입니다.

### 조절 가능한 값

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DEMO_SANDBOX_TTL_HOURS` | `24` | 샌드박스 유지 시간 |
| `DEMO_MAX_SANDBOXES_PER_CLIENT` | `3` | 같은 클라이언트가 만들 수 있는 수 |
| `DEMO_RATE_WINDOW_MINUTES` | `60` | 위 제한의 기준 시간 |
| `DEMO_MAX_ISSUES_PER_SANDBOX` | `500` | 샌드박스당 이슈 상한 |
| `DEMO_MAX_DOCUMENTS_PER_SANDBOX` | `200` | 샌드박스당 문서 상한 |
| `DEMO_MAX_WORKSPACES_PER_SANDBOX` | `5` | 샌드박스당 워크스페이스 상한 |

### 데모용 공지 심기

공지는 워크스페이스가 아니라 서비스 전체에 걸리는 모델이라 샌드박스마다 만들면
다른 방문자에게도 보입니다. 배포 후 한 번만 심습니다.

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py seed_demo_announcements
```

멱등합니다. 다시 돌리면 이 커맨드가 심었던 것만 지우고 새로 만듭니다.

> **실사용 배포에서는 `DEMO_MODE` 를 반드시 `False` 로 두세요.**
> 켜져 있으면 누구나 계정 없이 워크스페이스를 만들 수 있습니다.
