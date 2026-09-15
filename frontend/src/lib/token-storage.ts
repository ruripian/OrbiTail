/* 로그인 유지(Remember me) — 토큰을 어디에 보관할지 한 곳에서 결정한다.
 *
 *   체크함(기본)  → localStorage   : 브라우저를 닫았다 열어도 로그인 유지
 *   체크 해제     → sessionStorage : 탭을 닫으면 사라짐 (공용 PC 대비)
 *
 * remember 플래그 자체는 항상 localStorage 에 둔다. sessionStorage 에 두면
 * 새 탭에서 플래그를 읽지 못해 어느 저장소를 봐야 할지 알 수 없게 된다.
 */

const REMEMBER_KEY = "auth_remember";
const ACCESS_KEY = "access_token";
const REFRESH_KEY = "refresh_token";
/** zustand persist 저장 키 — user 스냅샷도 토큰과 같은 저장소를 따라가야 한다 */
export const AUTH_PERSIST_KEY = "auth-storage";

/** 기본값 true — 기존 사용자의 로그인이 이 기능 배포만으로 끊기지 않도록 */
export function getRemember(): boolean {
  return localStorage.getItem(REMEMBER_KEY) !== "0";
}

export function setRemember(remember: boolean) {
  localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
}

/** 현재 설정에서 토큰이 들어가야 할 저장소 */
export function getActiveStorage(): Storage {
  return getRemember() ? localStorage : sessionStorage;
}

const getIdleStorage = (): Storage => (getRemember() ? sessionStorage : localStorage);

export const getAccessToken = () => getActiveStorage().getItem(ACCESS_KEY);
export const getRefreshToken = () => getActiveStorage().getItem(REFRESH_KEY);

/** 활성 저장소에 기록하고, 반대편에 남아 있던 값은 지운다 (설정을 바꿔 로그인한 경우) */
export function setTokens(access: string, refresh?: string) {
  const active = getActiveStorage();
  const idle = getIdleStorage();
  active.setItem(ACCESS_KEY, access);
  idle.removeItem(ACCESS_KEY);
  if (refresh) {
    active.setItem(REFRESH_KEY, refresh);
    idle.removeItem(REFRESH_KEY);
  }
}

/** 로그아웃 — 양쪽 저장소를 모두 비운다. remember 설정은 다음 로그인 폼에 남겨 둔다 */
export function clearTokens() {
  for (const storage of [localStorage, sessionStorage]) {
    storage.removeItem(ACCESS_KEY);
    storage.removeItem(REFRESH_KEY);
    storage.removeItem(AUTH_PERSIST_KEY);
  }
}
