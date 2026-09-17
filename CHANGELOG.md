# Changelog

OrbiTail 의 모든 주요 변경사항 — [SemVer](https://semver.org/lang/ko/) 준수.

## [Unreleased]

### 업그레이드 시 필수 조치

기존 배포를 이 버전으로 올릴 때 다음을 먼저 하세요. 빠뜨리면 문서 실시간
협업이 동작하지 않습니다.

1. **`.env` 에 `COLLAB_SHARED_SECRET` 추가.** collab(Hocuspocus) 서버가
   백엔드 내부 엔드포인트를 부를 때 쓰는 공유 비밀입니다. 없으면 collab
   컨테이너가 시작하지 않습니다.

   ```bash
   python3 -c "import secrets;print(secrets.token_urlsafe(48))"
   ```

2. **`docker-compose.prod.yml` 을 이 버전의 것으로 교체.** `collab` 서비스가
   새로 생겼습니다. 예전 파일을 그대로 쓰면 컨테이너 자체가 뜨지 않습니다.

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
- **서버가 보내는 문장이 화면 언어를 따르지 않던 문제.** API 오류, 메일, 알림 약 380개
  문장이 한국어로 고정돼 영어 화면에도 한국어가 섞였다. 원문을 영어로 두고 한국어를
  `backend/locale/ko` 번역으로 옮겼다. 응답은 요청 언어로, 메일·알림은 받는 사람의
  계정 언어로 나간다. 가입·데모 계정은 가입한 화면의 언어를 계정 언어로 저장한다
  (전에는 모두 "ko"). 운영 반영 시 백엔드 이미지 재빌드가 필요하다(gettext 추가).
- **클라이언트 IP 를 곳마다 다르게, 일부는 위조 가능하게 읽던 문제.**
  로그인 기록(axes)은 프록시 주소만 남겼고, 비로그인 스로틀과 데모 세션 발급
  제한은 X-Forwarded-For 를 그대로 믿어 nginx 단독 배포에서는 헤더를 바꿔
  보내는 것만으로 우회할 수 있었다. `TRUSTED_PROXY_COUNT` 하나로 세 곳이 같은
  규칙(오른쪽에서 N 번째)을 쓰게 했다. 효과가 없던 `AXES_IPWARE_PROXY_COUNT` 는
  지웠다. compose 파일이 기본값을 주므로 기존 배포는 `.env` 수정이 필요 없다.
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
