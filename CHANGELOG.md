# Changelog

OrbiTail 의 모든 주요 변경사항 — [SemVer](https://semver.org/lang/ko/) 준수.

## [Unreleased]

### Added
- 공개 데모 모드 (`DEMO_MODE`) — 방문자마다 격리된 샌드박스를 발급한다.
  로그인 없이 들어와 자유롭게 만질 수 있고 24시간 뒤 자동 삭제된다.
  관리자 콘솔·파일 업로드·메일 발송은 차단되며, 생성량 상한과 IP 기준
  세션 발급 제한이 걸린다. (`docs/DEPLOY.md` 8절)
- `docker-compose.prod.yml` 이미지에 `TAG` 태그 부여 — 커밋 SHA 로 고정하면
  재빌드 없이 되돌릴 수 있다. 미지정 시 `local` 이라 기존 절차는 그대로 동작한다.
  (`docs/DEPLOY.md` 7절)
- `seed_demo_announcements` — 데모 배포용 전역 공지를 심는 멱등 커맨드

### Fixed
- **이슈 기능이 신규 설치에서 전혀 동작하지 않던 문제.** `issues.0010` 이
  `SeparateDatabaseAndState` 로 Django 상태만 바꾸고 `database_operations` 를
  비워둬, 마이그레이션만으로 만든 DB 에는 `module_id`/`cycle_id` 가 남고
  Django 는 `category_id`/`sprint_id` 를 조회했다. 이슈를 한 건만 읽어도
  `ProgrammingError` 가 났다. 컬럼 존재를 확인한 뒤 바꾸는 마이그레이션 추가.
- nginx: 리버스 프록시 뒤에서 `X-Forwarded-Proto` 가 덮어써져 발생하던
  무한 리디렉션. 앞단이 준 값이 있으면 그것을 보존한다.

### Changed
- backend 이미지 738MB → 436MB. `psycopg[binary]` 등 모든 의존성이 미리
  컴파일된 wheel 로 제공돼 `gcc`·`libpq-dev` 가 필요 없었다.
- `backend/.dockerignore`, `frontend/.dockerignore` 추가. 프론트 빌드 컨텍스트가
  461MB → 9.7MB 로 줄었고, 호스트 `node_modules` 가 이미지 안 설치본을
  덮어써 플랫폼이 어긋나던 문제도 함께 막았다.
- `seed_demo` 커맨드 본문을 `apps/workspaces/seeding.DemoSeeder` 로 분리.
  데모 샌드박스가 같은 생성기를 쓴다. 커맨드 동작은 그대로다.

## [0.1.0] — 2026-04-13

첫 버전 태그. 단일 source of truth 도입(`/VERSION`).

### Added
- 루트 `VERSION` 파일 — 백엔드/프론트가 동일하게 참조
- `GET /api/version/` — 현재 버전 + git 커밋 해시 노출
- 설정 페이지 좌측 하단에 버전 표시 + GitHub 링크
- `scripts/bump-version.sh` — 버전 bump + git tag + CHANGELOG 항목 자동화
- 사용자별 알림 환경설정(이메일 발송 toggle 포함)

### Fixed
- 타임라인: 날짜 없는 부모 이슈가 숨겨지며 dated 자식까지 함께 사라지던 버그
- 테이블: 마지막 컬럼 리사이즈 불가 + 잉여 가로 공간 미할당
