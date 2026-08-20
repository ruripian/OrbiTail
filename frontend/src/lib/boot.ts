/** 앱 최초 진입 시 어느 화면으로 갈지 정하는 판단.
 *
 *  main.tsx 의 effect 안에 두면 테스트하기 어려워 순수 함수로 분리했다.
 *  실제로 여기서 한 번 틀린 적이 있다 — 데모 배포인데 토큰만 있으면 통과시켜,
 *  데모 전환 이전에 로그인해 둔 세션이 랜딩을 건너뛰고 들어가
 *  "참가한 워크스페이스가 없습니다" 화면에 갇혔다. */
export type BootScreen = "setup" | "demo" | "ready";

export interface BootInput {
  /** 초기 설정(슈퍼유저 생성) 완료 여부 */
  setupComplete: boolean;
  /** 이 배포가 공개 데모인지 */
  demoEnabled: boolean;
  /** 저장된 access token 이 있는지 */
  hasToken: boolean;
  /** 그 세션이 데모 세션으로 발급된 것인지 */
  isDemoSession: boolean;
  /** 데모 샌드박스 만료 시각 (ISO8601) */
  expiresAt: string | null;
  /** 테스트에서 고정하기 위한 기준 시각 */
  now?: number;
}

export interface BootDecision {
  screen: BootScreen;
  /** 들고 있던 세션을 버려야 하는지 (남아 있으면 다음 부팅에서 또 걸린다) */
  clearSession: boolean;
}

export function decideBoot(input: BootInput): BootDecision {
  const { setupComplete, demoEnabled, hasToken, isDemoSession, expiresAt } = input;

  if (!setupComplete) return { screen: "setup", clearSession: false };

  // 데모 배포가 아니면 토큰 유무는 라우터/인터셉터가 알아서 처리한다.
  if (!demoEnabled) return { screen: "ready", clearSession: false };

  const now = input.now ?? Date.now();
  const expired = expiresAt !== null && new Date(expiresAt).getTime() <= now;

  // 데모 배포에서는 "살아 있는 데모 세션" 만 통과시킨다.
  // 데모가 아닌 세션(전환 이전 로그인 등)은 들어가 봐야 갈 곳이 없다.
  if (hasToken && isDemoSession && !expired) {
    return { screen: "ready", clearSession: false };
  }

  return { screen: "demo", clearSession: hasToken || isDemoSession };
}
