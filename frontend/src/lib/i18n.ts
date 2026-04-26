import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import koCommon from "@/locales/ko/common.json";
import enCommon from "@/locales/en/common.json";

i18n
  .use(LanguageDetector)       // 브라우저 언어 자동 감지
  .use(initReactI18next)       // React 연동
  .init({
    resources: {
      ko: { common: koCommon },
      en: { common: enCommon },
    },
    defaultNS: "common",       // useTranslation() 기본 네임스페이스
    fallbackLng: "ko",         // 감지 실패 시 한국어로 폴백
    supportedLngs: ["ko", "en"],
    interpolation: {
      escapeValue: false,      // React가 XSS를 이미 처리하므로 불필요
    },
    detection: {
      // localStorage → 브라우저 언어 순으로 감지
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
  });

/* PASS8-1 — <html lang> 을 현재 i18n 언어와 동기화. 스크린리더 발음/한자 처리 정확도. */
function syncHtmlLang(lng: string) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng;
  }
}
syncHtmlLang(i18n.language || "ko");
i18n.on("languageChanged", syncHtmlLang);

export default i18n;
