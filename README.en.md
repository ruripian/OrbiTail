<p align="center">
  <img src="frontend/public/logo.svg" width="80" alt="OrbiTail" />
</p>

<h1 align="center">OrbiTail</h1>

<p align="center">
  Self-hosted project management tool
</p>

<p align="center">
  <a href="README.md">한국어</a> · English
</p>

<p align="center">
  📖 <a href="https://github.com/ruripian/OrbiTail/wiki">User Wiki (English)</a> · <a href="https://github.com/ruripian/OrbiTail/wiki/한국어">사용자 위키 (한국어)</a>
</p>

---

## Try it in the demo

No install needed — poke at it right now at **[orbitail.ruripian.duckdns.org](https://orbitail.ruripian.duckdns.org)**.
No sign-up, no login. Hit "Start the demo" and you get a workspace pre-filled with
example data, **created just for you**.

- Create issues and change their state, assignee and dates
- Switch between Table, Board, Calendar, Timeline and Sprint views
- Write docs and link them to issues

Change or delete anything — nobody else is affected, and it disappears after a day.
Admin tools, file uploads and outgoing email are disabled in the public demo.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind + shadcn/ui + Radix |
| Backend | Django 5 + DRF + Daphne (ASGI / WebSocket) |
| Database | PostgreSQL 16 + Redis 7 |
| Async | Celery + Celery Beat |
| Deploy | Docker Compose + Nginx |

---

## Quick Start (Development)

```bash
git clone https://github.com/ruripian/OrbiTail.git
cd OrbiTail

cp .env.example .env

docker compose up -d
```

Access:
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000/api
- Swagger: http://localhost:8000/api/docs

**First visit opens the admin + workspace setup wizard automatically.**

---

## Production Deployment

### Requirements

- Linux (Ubuntu 22.04 recommended)
- Docker + Docker Compose v2
- RAM 2GB+ / Disk 10GB+
- Domain (for HTTPS)

### Deploy

```bash
git clone https://github.com/ruripian/OrbiTail.git
cd OrbiTail

cp .env.example .env
vi .env
```

**Must change in `.env`:**

| Variable | Value |
|----------|-------|
| `SECRET_KEY` | `python3 -c "import secrets; print(secrets.token_urlsafe(50))"` |
| `POSTGRES_PASSWORD` | Strong password |
| `ALLOWED_HOSTS` | Your domain (`your-domain.com`) |
| `CORS_ALLOWED_ORIGINS` | Frontend URL (`https://your-domain.com`) |
| `DEBUG` | `False` |

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Images are tagged with the value of `TAG`. Left unset it is `local`, so the command
above builds in place and uses the result. To make production **rollback-able without
a rebuild**, pin it to the deployed commit SHA — see the
[deployment guide](docs/DEPLOY.md#7-이미지-태그로-배포-고정하기).

### HTTPS (optional)

```bash
sudo apt install certbot
sudo certbot certonly --standalone -d your-domain.com

# Enable HTTPS block in nginx/nginx.conf, then:
docker compose -f docker-compose.prod.yml restart nginx
```

---

## Operations

```bash
# Update
git pull && docker compose -f docker-compose.prod.yml up -d --build

# Logs
docker compose -f docker-compose.prod.yml logs -f backend

# DB Backup
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U orbitail orbitail > backup-$(date +%F).sql

# Create admin (CLI)
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py createsuperuser
```

### Running it as a public demo

Set `DEMO_MODE=True` in `.env` to let anyone walk in and look around. Each visitor gets
their own isolated workspace (invisible to everyone else) that is deleted after a day.
Admin console, file uploads and outgoing email are blocked. See the
[deployment guide](docs/DEPLOY.md#8-공개-데모-모드).

---

## Built with AI

This project was developed with the assistance of AI coding tools (Claude Code).
Architecture decisions, code review, and quality control were done by the maintainer.

---

## Support

If you find this project useful:

- [GitHub Sponsors](https://github.com/sponsors/ruripian)
- [Ko-fi](https://ko-fi.com/ruripian)

---

## License

Copyright (c) 2026 Sooho Han (ruripian). All Rights Reserved.

See `LICENSE` for details. Third-party licenses: `docs/THIRD_PARTY_LICENSES.md`.
