<p align="center">
  <img src="frontend/public/logo.svg" width="80" alt="OrbiTail" />
</p>

<h1 align="center">OrbiTail</h1>

<p align="center">
  셀프 호스팅 프로젝트 관리 도구
</p>

<p align="center">
  한국어 · <a href="README.en.md">English</a>
</p>

<p align="center">
  📖 <a href="https://github.com/ruripian/OrbiTail/wiki/한국어">사용자 위키 (한국어)</a> · <a href="https://github.com/ruripian/OrbiTail/wiki">User Wiki (English)</a>
</p>

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프론트엔드 | React 18 + TypeScript + Vite + Tailwind + shadcn/ui + Radix |
| 백엔드 | Django 5 + DRF + Daphne (ASGI / WebSocket) |
| 데이터베이스 | PostgreSQL 16 + Redis 7 |
| 비동기 | Celery + Celery Beat |
| 배포 | Docker Compose + Nginx |

---

## 빠른 시작 (개발 환경)

```bash
git clone https://github.com/ruripian/OrbiTail.git
cd OrbiTail

cp .env.example .env

docker compose up -d
```

접속:
- 프론트엔드: http://localhost:5173
- 백엔드 API: http://localhost:8000/api
- Swagger: http://localhost:8000/api/docs

**최초 접속 시 관리자 계정 + 워크스페이스 생성 셋업 화면이 자동으로 뜹니다.**

---

## 프로덕션 배포

### 요구사항

- Linux (Ubuntu 22.04 권장)
- Docker + Docker Compose v2
- RAM 2GB+ / 디스크 10GB+
- 도메인 (HTTPS용)

### 배포

```bash
git clone https://github.com/ruripian/OrbiTail.git
cd OrbiTail

cp .env.example .env
vi .env
```

**`.env`에서 반드시 변경:**

| 변수 | 값 |
|------|---|
| `SECRET_KEY` | `python3 -c "import secrets; print(secrets.token_urlsafe(50))"` |
| `POSTGRES_PASSWORD` | 강력한 비밀번호 |
| `ALLOWED_HOSTS` | 실제 도메인 (`your-domain.com`) |
| `CORS_ALLOWED_ORIGINS` | 프론트엔드 URL (`https://your-domain.com`) |
| `DEBUG` | `False` |

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### HTTPS 설정 (선택)

```bash
sudo apt install certbot
sudo certbot certonly --standalone -d your-domain.com

# nginx/nginx.conf의 HTTPS 블록 활성화 후:
docker compose -f docker-compose.prod.yml restart nginx
```

---

## 운영

```bash
# 업데이트
git pull && docker compose -f docker-compose.prod.yml up -d --build

# 로그
docker compose -f docker-compose.prod.yml logs -f backend

# DB 백업
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U orbitail orbitail > backup-$(date +%F).sql

# 관리자 생성 (CLI)
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py createsuperuser
```

---

## 프로젝트 구조

```
orbitail/
├── backend/            # Django + DRF
│   └── apps/
│       ├── accounts/     # JWT 인증
│       ├── workspaces/   # 워크스페이스 + 멤버 + 초대
│       ├── projects/     # 프로젝트 + 카테고리 + 스프린트 + 이벤트
│       ├── issues/       # 이슈 + 댓글 + 활동 + 첨부
│       └── notifications/# 실시간 알림
├── frontend/           # React + TypeScript
│   └── src/
│       ├── pages/        # 라우트 페이지
│       ├── components/   # 공용 + 도메인 컴포넌트
│       ├── stores/       # Zustand 클라이언트 상태
│       ├── api/          # API 클라이언트
│       └── locales/      # i18n (ko / en)
├── nginx/              # 리버스 프록시
├── docker-compose.yml        # 개발
└── docker-compose.prod.yml   # 프로덕션
```

---

## AI 기반 개발

이 프로젝트는 AI 코딩 도구(Claude Code)의 도움을 받아 개발되었습니다.
아키텍처 설계, 코드 리뷰, 품질 관리는 메인테이너가 직접 수행했습니다.

---

## 후원

이 프로젝트가 도움이 되셨다면:

- [GitHub Sponsors](https://github.com/sponsors/ruripian)
- [Ko-fi](https://ko-fi.com/ruripian)

---

## 라이선스

Copyright (c) 2026 Sooho Han (ruripian). All Rights Reserved.

자세한 내용은 `LICENSE` 참조. 서드파티 라이선스: `docs/THIRD_PARTY_LICENSES.md`.
