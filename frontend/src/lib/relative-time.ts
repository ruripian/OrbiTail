/**
 * 상대 시간 포매터 — "3분 전", "어제", "3일 전" 등
 * i18next와 별개로 간단한 한/영 분기. 날짜가 일주일 이상이면 절대 날짜.
 */

import i18n from "./i18n";

const UNITS: { limit: number; div: number; key: string }[] = [
  { limit: 60,           div: 1,     key: "time.justNow" },       // <1분
  { limit: 3600,         div: 60,    key: "time.minutesAgo" },    // <1시간
  { limit: 86400,        div: 3600,  key: "time.hoursAgo" },      // <1일
  { limit: 7 * 86400,    div: 86400, key: "time.daysAgo" },       // <1주
];

export function formatRelativeTime(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));

  for (const u of UNITS) {
    if (diffSec < u.limit) {
      const n = Math.floor(diffSec / u.div);
      const translated = i18n.t(u.key, { count: n });
      /* 번역 없으면 fallback */
      if (translated === u.key) {
        if (u.key === "time.justNow") return "just now";
        if (u.key === "time.minutesAgo") return `${n}m ago`;
        if (u.key === "time.hoursAgo")   return `${n}h ago`;
        if (u.key === "time.daysAgo")    return `${n}d ago`;
      }
      return translated;
    }
  }

  /* 일주일 이상: 절대 날짜 */
  const lang = i18n.language?.startsWith("ko") ? "ko-KR" : undefined;
  return date.toLocaleDateString(lang, { month: "short", day: "numeric", year: "numeric" });
}

/** 편집됨 — created_at과 updated_at 차이가 임계값(초) 이상이면 true */
export function wasEdited(createdAt: string, updatedAt: string, thresholdSec = 2): boolean {
  return new Date(updatedAt).getTime() - new Date(createdAt).getTime() > thresholdSec * 1000;
}
