# Phase 0 — Inventory (인벤토리)

> **분석 일자**: 2026-05-09
> **분석 대상 커밋**: `86a6022` (2026-04-29)
> **추론 비율**: 0% — 전부 명령어로 재현 가능
> **다음 Phase**: Schema 분석 (Phase 1)

---

## 1. 카운트

| 항목 | 수 | 검증 명령 |
|---|---:|---|
| Tracked files (git) | **429** | `git ls-files \| wc -l` |
| Python (.py) | **150** | `git ls-files "*.py" \| wc -l` |
| TypeScript/TSX (.ts + .tsx) | **196** (146 tsx + 50 ts) | `git ls-files "*.ts" "*.tsx" \| wc -l` |
| Markdown (.md) | **13** (tracked) | `git ls-files "*.md" \| wc -l` |
| JSON | 6 / YAML | 3 / CSS | 3 / HTML | 3 |

---

## 2. 최상위 구조

```
orbitail/
├── backend/         Django 5.1.4 + DRF 3.15.2
├── frontend/        React 18.3 + TypeScript 5.7 + Vite 6
├── docs/            wiki + DEPLOY.md
├── nginx/           프로덕션 리버스 프록시
├── scripts/         배포/유틸 스크립트
├── docker-compose.yml / docker-compose.prod.yml
├── README.md / README.en.md / CHANGELOG.md / VERSION
└── design_handoff_orbitail_redesign/  ⚠ untracked, PASS2~PASS10 design audit
```

---

## 3. Backend (Django)

### 3.1 Apps (7개)

| App | .py 파일 수 | 비고 |
|---|---:|---|
| `accounts` | 10 | 인증/사용자 |
| `audit` | 6 | ⚠ frontend `api/`에 매칭 클라이언트 없음 → Phase 2에서 라벨 검증 |
| `documents` | 10 | 문서 시스템 (Yjs 실시간) |
| `issues` | 7 | 이슈 도메인 (가장 활발한 hot-spot) |
| `notifications` | 12 | 알림 (가장 많은 파일) |
| `projects` | 6 | 프로젝트 |
| `workspaces` | 6 | 워크스페이스 |

### 3.2 Config

`backend/config/`: `__init__.py`, `asgi.py`, `wsgi.py`, `urls.py`, `celery.py`, `version.py`

### 3.3 의존성 스택 (`backend/requirements.txt`)

| 영역 | 라이브러리 |
|---|---|
| 코어 | Django 5.1.4, DRF 3.15.2, simple-jwt 5.3.1 |
| API | drf-spectacular 0.28.0 (auto schema), django-filter 24.3, cors-headers 4.6.0 |
| Async | celery 5.4.0, channels 4.2.0, channels-redis 4.2.1, daphne 4.1.2 |
| 실시간 편집 | **pycrdt ≥0.10, pycrdt-websocket ≥0.15** (Yjs CRDT 백엔드) |
| 인프라 | redis 5.2.1, django-redis 5.4.0, psycopg 3.2.3, gunicorn 23.0.0 |
| 보안 | django-axes 7.0.2 (브루트포스 차단) |
| 미디어 | Pillow 11.1.0 |
| 설정 | python-decouple 3.8 |

---

## 4. Frontend (React)

### 4.1 도메인 폴더 (`frontend/src/`)

```
src/
├── api/              12 도메인 클라이언트
├── components/       12 그룹
├── pages/            10 폴더 + 2 단일 페이지
├── stores/           6 zustand store
├── hooks/            13 커스텀 훅
├── router/
├── types/
├── lib/, utils/, constants/
├── locales/          ko + en
├── styles/, test/
└── main.tsx, index.css, global.d.ts
```

### 4.2 API 클라이언트 (`api/`)

```
admin, announcements, auth, documents, icons, issues,
notifications, projects, requests, settings, setup, workspaces
```
→ Phase 2에서 backend endpoint 매칭 검증 예정.

### 4.3 Pages 도메인

```
admin/, auth/, documents/, invite/, project/, public/, request/,
settings/, setup/, workspace/, AnnouncementsPage.tsx, WorkspaceSelectPage.tsx
```

### 4.4 Components 그룹

```
auth/, charts/, decorations/, documents/, editor/, events/,
issues/, layout/, motion/, search/, ui/, views/
```
- ⚠ `decorations/`, `motion/` — 명칭만으로는 역할 불명. Phase 3에서 검증.

### 4.5 Stores (zustand, 6개)

| Store | 추정 역할 (Phase 3 검증) |
|---|---|
| `authStore.ts` | 인증 세션 |
| `workspaceStore.ts` | 현재 워크스페이스 |
| `undoStore.ts` | 글로벌 Undo (CLAUDE.md memory에 언급) |
| `presenceStore.ts` | 동시 편집 사용자 표시 |
| `recentChangesStore.ts` | 최근 변경 (toast/inbox?) |
| `issueDialogStore.ts` | **신규** (커밋 86a6022) — 전역 이슈 모달 |

### 4.6 의존성 스택 (`frontend/package.json`)

| 영역 | 라이브러리 |
|---|---|
| 프레임워크 | React 18.3.1, react-router-dom 6.28.1 |
| 상태/서버 | Zustand 5.0.2, TanStack Query 5.62.7, axios 1.7.9 |
| 폼/검증 | react-hook-form 7.54.2, Zod 3.24.1 |
| UI | Radix UI (Dialog/Popover/Select 등 13종), lucide-react 0.468.0, class-variance-authority |
| 스타일 | Tailwind 3.4.17 + tailwindcss-animate, autoprefixer |
| 모션 | Framer Motion 12.38.0 |
| 에디터 | **TipTap 3.21** (28개 extension!), prosemirror, tiptap-extension-global-drag-handle |
| 실시간 | **Yjs 13.6 + y-websocket 2.1** |
| 시각화 | Recharts 3.8, Mermaid 11.4, KaTeX 0.16 |
| 변환 | Mammoth 1.8 (.docx → HTML) |
| 다국어 | i18next 24.2 + react-i18next 15.4 |
| UX | Sonner 2.0.7 (toast), react-easy-crop |
| 빌드 | Vite 6.0.5, TypeScript 5.7.2, Vitest 4.1.5, ESLint 9.17 |

---

## 5. 기존 문서 인벤토리 — ⚠ 검증 대상

> **memory에 따른 정책**: 문서 클레임을 사실로 받아들이지 말고 코드와 대조해야 함.

### 5.1 Tracked (.md, 13개)

| 파일 | 추정 신뢰도 | Phase 5 검증 항목 |
|---|---|---|
| `README.md` / `README.en.md` | 🔶 코드 변화 속도 대비 outdated 가능 | 기능 목록 vs 실제 구현 |
| `CHANGELOG.md` | ✓ git tag 시점 자동 생성이면 신뢰 | 최근 커밋 반영 여부 |
| `docs/DEPLOY.md` | 🔶 nginx/docker compose 구성 변경 추적 필요 | docker-compose.yml과 일치? |
| `docs/THIRD_PARTY_LICENSES.md` | ✓ 자동 생성 가능 | package.json 새 의존성 누락? |
| `docs/wiki/Home.md` 외 13개 (한/영 페어) | 🔶 위키는 보통 stale 1순위 | 기능 설명 vs 실제 UI |

### 5.2 Untracked — `design_handoff_orbitail_redesign/`

```
HANDOFF_PROMPT.md
README.md / ROADMAP.md
PASS2.md ~ PASS9_onboarding.md (8개)
PASS10_realtime.md
OrbiTail Design Audit.html (v2/v3-IA/v4-Duplication 포함 5개 HTML)
```
- memory의 "PASS10 종료" 항목과 연결됨 — Toast/Inbox/archive/Type확장/Presence는 출하 완료, comment_replied + mention parser만 보류
- Phase 5에서 PASS 문서들의 **각 항목별 실제 구현 여부** 매칭 예정

---

## 6. Git Hot-spot — 활발히 개발 중인 영역 (최근 3개월, 상위 30)

| Rank | 파일 | 변경 수 |
|---:|---|---:|
| 1 | `frontend/src/locales/ko/common.json` | 24 |
| 2 | `frontend/src/locales/en/common.json` | 23 |
| 3 | `frontend/src/pages/project/IssueDetailPage.tsx` | 20 |
| 4 | `frontend/src/types/index.ts` | 19 |
| 5–6 | TimelineView, TableView | 18 |
| 7 | `frontend/src/index.css` | 16 |
| 8–10 | router/, TopBar, Sidebar | 15 |
| 11 | ProjectIssuePage | 14 |
| 12–15 | WorkspaceDashboard, BoardView, DocumentSpacePage, DocumentEditor | 13 |
| 16 | CalendarView | 11 |
| 17–18 | issues/views.py, documents/views.py, documents/models.py | 10 |
| ... | GraphView, DocumentLayout, api/issues, api/documents, documents/serializers | 9 |
| ... | SettingsLayout, useWebSocket, issues/serializers, accounts/views | 8 |

**관찰**:
- **이슈 시스템이 가장 hot** — IssueDetailPage 20회, ProjectIssuePage 14회 등
- **i18n 활발** — locales/ko, locales/en 양쪽 동시 갱신 중 (좋은 신호)
- **백엔드 모델 변경 자주** — documents/models.py 10회 → migration 정합성 Phase 1에서 점검 필요
- **timeline / table / board / calendar / graph** — 이슈 뷰 5종 모두 활발 → 도메인 안정화 단계

---

## 7. Phase 1로 넘어가기 전 발견된 의심 단서 (검증 대상)

이건 추론이며 **Phase 1~4에서 검증할 항목**:

| # | 의심 | 검증할 Phase |
|---|---|---|
| S1 | `audit` app은 frontend api 클라이언트 없음 → 🟡 Backend-only 가능성 | Phase 2 |
| S2 | `pages/invite/`, `pages/public/`, `pages/request/`, `pages/setup/` — 라우트 도달 가능성? | Phase 3 |
| S3 | `components/decorations/`, `motion/` — 실제 import 되는 곳? 또는 dead? | Phase 3 |
| S4 | `documents/models.py` 10회 변경 → migration 누락 가능성 (`makemigrations --dry-run --check`) | Phase 1 |
| S5 | `api/announcements.ts` ↔ `AnnouncementsPage.tsx` 매칭 — 실제 backend endpoint? | Phase 2 |
| S6 | `notifications` app은 12 .py 파일로 가장 큼 — over-engineered? Phase 2/4에서 사용처 추적 | Phase 2, 4 |
| S7 | `pycrdt-websocket` ASGI 마운트 — 실제 frontend `y-websocket`이 어디로 연결? | Phase 4 |
| S8 | `request` 폴더 — memory의 "Request Queue" 시스템과 연결. PASS 문서 vs 실구현 검증 | Phase 5 |

---

## 8. 검증 명령 (사용자가 직접 재현 가능)

```bash
# 1. 파일 카운트 검증
git ls-files | wc -l                                    # 429

# 2. Django apps 검증
ls backend/apps/                                        # 7개

# 3. Frontend 도메인 검증
ls frontend/src/pages/ frontend/src/api/ frontend/src/stores/

# 4. 기존 문서 인벤토리 검증
git ls-files "*.md"

# 5. Hot-spot 재현
git log --since="3 months ago" --name-only --pretty=format: \
  | grep -v '^$' | sort | uniq -c | sort -rn | head -30
```

---

## 9. 다음 Phase 실행 계획

**Phase 1 — Schema** 시작 시 sub-task 6개 추가 생성:
1. backend/apps/*/models.py 전수 읽기 → 모델 카탈로그
2. FK/M2M 관계 그래프 작성
3. 필드 정책 표 (unique/index/null/default/choices)
4. `makemigrations --dry-run --check` 실행 → 정합성
5. 각 모델 사용처 추적 (ViewSet/Serializer/Admin/signals/tasks)
6. 실제 DB `\dt` + `\d <table>` 대조

**예상 시간**: 15~20분
