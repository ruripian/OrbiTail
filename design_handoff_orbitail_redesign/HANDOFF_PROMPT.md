# HANDOFF_PROMPT.md — Claude Code에 그대로 붙여넣기

아래 블록을 통째로 복사해서 Claude Code (또는 다른 개발 AI) 에게 던지세요.

---

```
당신은 OrbiTail 프론트엔드 리팩토링/품질 작업을 수행할 개발자입니다.

전체 작업 명세는 다음 디렉토리에 있습니다:
  @design_handoff_orbitail_redesign/

먼저 다음 두 문서를 반드시 읽고 시작하세요:
  1. @design_handoff_orbitail_redesign/ROADMAP.md  (전체 그림 + 의존성 + 게이트)
  2. @design_handoff_orbitail_redesign/PASS5.md    (가장 먼저 할 일)

작업 순서는 ROADMAP.md의 "권장 진행 순서"를 그대로 따르세요:

  PASS5-A → PASS5-B → PASS5-C → PASS5-D → PASS6 → PASS7 → PASS8 → PASS9 → PASS10

  PASS7과 PASS8은 병렬 가능. PASS9와 PASS10도 병렬 가능.
  단, 사용자가 한 번에 하나의 PASS만 지시할 것이므로,
  사용자 지시에 따라 해당 PASS의 문서만 깊이 읽고 작업하세요.

각 PASS마다 다음 규칙을 엄격히 지키세요:

  [필수 게이트 — 매 PR 머지 전]
  - pnpm typecheck 통과
  - pnpm lint 통과 (warning 증가 없음)
  - pnpm test 통과 (PASS6 이후 적용)
  - 시각 회귀 없음 — 라이트/다크 모드 둘 다 확인
  - 새 의존성 추가는 사용자 승인 후만
  - PR 단위는 해당 PASS 문서가 정의한 분할을 그대로 따를 것
    (예: PASS5는 A/B/C/D 4개 PR, 한 번에 묶지 말 것)

  [작업 진행 방식]
  1. 각 PASS 시작 전 해당 문서 ({PASSn_xxx}.md)를 읽고 작업 계획 요약을 출력
  2. 코드 변경 → 검증 → 다음 단계 순으로 진행
  3. PR 단위 끝나면 다음 항목 출력:
     - 변경 파일 목록
     - typecheck/lint/test 결과
     - 잠재 회귀 영역
     - 다음 PR 또는 다음 PASS로 진행 여부
  4. 막히거나 결정이 필요한 지점에서만 사용자에게 질문 (게이트 우회 금지)

  [원칙]
  - 시각 변경 금지 (PASS2,3 외에는 순수 리팩토링/품질 작업)
  - i18n 키 변경은 별도 PR
  - PASS 간 작업 섞지 말 것
  - 추측으로 최적화하지 말 것 (PASS7은 측정 후 결정)

지금 시작하세요. PASS5-A부터.
```

---

## 사용 팁

1. **첫 회차**: 위 프롬프트만 던지면 됨. AI가 알아서 PASS5-A부터 진행.
2. **중간 점검**: PR마다 AI가 결과 요약을 출력하므로 그것만 확인.
3. **문제 발생**: AI가 막힌 지점에서 질문하면 답하고, 답이 필요한 게 아니면 "ROADMAP.md 게이트 따라 계속"이라고만 하면 됨.
4. **PASS 사이 중단**: 시간 부족하면 PASS5 끝나는 시점이 자연스러운 중단점. 다음 세션에서 "PASS6부터 계속"이라고 하면 이어짐.
5. **PASS9/10**: 독립적. 사용자가 "PASS9 시작"이라고 하면 `PASS9_onboarding.md`만 읽고 진행. PASS10도 동일.

---

## 비상시

AI가 지시를 무시하고 임의로 작업 범위를 바꾸면:

```
ROADMAP.md의 게이트와 PASS 분리 원칙을 다시 읽으세요.
지금 PASS는 {N}이며, 그 외 변경은 금지입니다.
방금 변경 중 범위를 벗어난 부분이 있으면 되돌리세요.
```

AI가 시각 변경을 시작하면:

```
PASS5~8은 시각 변경 금지입니다. PASS2/3에서 정의한 토큰만 사용하세요.
방금 변경한 색/간격/타이포는 되돌리세요.
```
