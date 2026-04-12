# Changelog

OrbiTail 의 모든 주요 변경사항 — [SemVer](https://semver.org/lang/ko/) 준수.

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
