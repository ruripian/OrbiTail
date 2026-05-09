# ROADMAP — OrbiTail Redesign

전체 PASS의 한눈 그림 + 의존성 + 진행 순서.

---

## 진행 상태

| PASS | 주제 | 상태 | 문서 | 회귀 위험 |
|---|---|---|---|---|
| 1 | Visual Audit (1차) | ✅ 완료 | `OrbiTail Design Audit.html` | — |
| 2 | Visual Quick Wins (token, focus, glass, density, EmptyState) | ✅ 머지됨 | `PASS2.md` | 낮음 |
| 3 | Sprint 2 lane / 모션 정리 | ✅ 머지됨 | `PASS3.md` | 중간 |
| 4 | IA / Templates contextual / URL view 정리 | ✅ 머지됨 | `PASS4.md` | 중간 |
| 5 | 컴포넌트 추출 (4 sub-PR) | 🟡 진행 중 | `PASS5.md` | 낮음~중간 |
| 6 | Storybook + 단위 테스트 | ⏳ 예정 | `PASS6_testing.md` | 없음 |
| 7 | 성능 (가상화, query 정책, lazy) | ⏳ 예정 | `PASS7_performance.md` | 중간 |
| 8 | 접근성 (focus, ARIA, 단축키) | ⏳ 예정 | `PASS8_a11y.md` | 낮음 |
| 9 | Onboarding (Welcome flow / Coachmark / Getting Started) | ⏳ 예정 | `PASS9_onboarding.md` | 낮음 |
| 10 | 알림 / Inbox / Presence / WS Pulse | ⏳ 예정 | `PASS10_realtime.md` | 중간 |

---

## 의존성 그래프

```
PASS2 ──┐
PASS3 ──┼──▶ PASS5 (추출) ──▶ PASS6 (테스트) ──┬──▶ PASS7 (성능)
PASS4 ──┘                                    └──▶ PASS8 (a11y)
                                                          │
                                                          ▼
                                                   ┌─ PASS9 (onboarding)
                                                   └─ PASS10 (실시간)
                                                   ※ 인터뷰 후 결정
```

- **PASS5 → 6**: 추출이 끝나야 테스트 비용이 정상 (큰 컴포넌트 테스트는 비용/효용 안 맞음).
- **PASS6 → 7**: 테스트 있어야 가상화 회귀 감지.
- **PASS6 → 8**: story가 a11y addon 검증 환경.
- **PASS7, 8 병렬 가능**: 서로 다른 영역 (PASS7=런타임, PASS8=마크업).
- **PASS9, 10**: 독립적이며 병렬 가능. PASS8 끝난 후 어느 쪽이든 시작 가능.

---

## 권장 진행 순서

```
PASS5-A  →  PASS5-B  →  PASS5-C  →  PASS5-D  →  PASS6  →  PASS7 ║ PASS8  →  PASS9 ║ PASS10
                                                               병렬                  병렬
```

각 단계마다 머지 후 다음 단계 시작. 한 번에 묶지 말 것.

---

## PR 분할 원칙 (전 PASS 공통)

- **시각 변경과 구조 변경 분리**: 같은 PR에 token 변경 + 컴포넌트 추출 금지
- **i18n 변경 분리**: 키 추가는 별도 PR
- **테스트는 함께 묶기**: 코드 + 테스트는 같은 PR (테스트만 별도 PR은 비효율)
- **회귀 위험 큰 PR은 단독**: dnd 변경, 라우팅 변경, query 정책 변경

---

## 게이트 (각 PASS 끝날 때 통과해야 함)

- [ ] `pnpm typecheck` 통과
- [ ] `pnpm lint` warning 증가 없음
- [ ] `pnpm test` 통과 (PASS6 이후)
- [ ] 시각 회귀 없음 (라이트/다크 둘 다 확인)
- [ ] 새 의존성 추가는 README에 기록
- [ ] PR 머지 메시지에 `Closes PASS{N}-{X}` 형태로 추적

---

## 비목표 (현재 로드맵에 없는 것)

다음은 의도적으로 제외:
- E2E 테스트 (Playwright 도입은 PASS7 이후 검토)
- 시각 회귀 도구 (Chromatic 등 — 베타 사용자 늘어난 후)
- SSR / PWA — 별도 결정 필요
- 모바일 전용 UI — 별도 트랙

---

## 다음 액션

지금 시점에서 할 일은 단 하나:

**`HANDOFF_PROMPT.md`를 Claude Code (또는 다른 개발 AI)에게 그대로 복사 → 붙여넣기.**

그 외 모든 결정은 진행 중 자동으로 풀린다.
