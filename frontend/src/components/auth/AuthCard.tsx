import { ReactNode, useEffect } from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/lib/theme-provider";
import { useTranslation } from "react-i18next";

/** 인증 페이지 공통 레이아웃 — L자 코너 + 테마·언어 토글 */
export function AuthCard({
  children,
  wide = false,
  className = "",
}: {
  children: ReactNode;
  /** setup 페이지처럼 필드가 많을 때 true로 넓게 */
  wide?: boolean;
  /** 추가 클래스 */
  className?: string;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const toggleTheme = () => setTheme(resolvedTheme === "dark" ? "light" : "dark");
  const { i18n, t } = useTranslation();

  const toggleLang = () =>
    i18n.changeLanguage(i18n.language === "ko" ? "en" : "ko");

  /* auth 페이지에서는 원근 점 격자 숨기기 */
  useEffect(() => {
    document.body.classList.add("hide-dots");
    return () => { document.body.classList.remove("hide-dots"); };
  }, []);

  return (
    <div className={`relative flex min-h-screen items-center justify-center px-4 py-8 ${className}`}>

      {/* 우상단 — 언어 · 테마 토글 */}
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <button
          onClick={toggleLang}
          className="px-2 py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label={t("lang.toggle")}
        >
          {i18n.language === "ko" ? "EN" : "KO"}
        </button>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label={t("theme.toggle")}
        >
          {resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      {/* 카드 — L자 코너 장식 포함 */}
      <div className={`relative w-full ${wide ? "max-w-md" : "max-w-sm"}`}>
        {/* L자형 모서리 장식 */}
        <span className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-primary" />
        <span className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-primary" />
        <span className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-primary" />
        <span className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-primary" />

        <div className="border glass rounded-sm px-8 py-10">
          {children}
        </div>
      </div>
    </div>
  );
}

/** 카드 내 브랜드 헤더 — 로고 + 타이틀 + 골드 구분선 + 서브타이틀 */
export function AuthCardHeader({ subtitle }: { subtitle: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 mb-7">
      <div className="flex items-center gap-2">
        {/* 육각형 심볼 로고 */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-primary">
          <path
            d="M12 2L21.196 7V17L12 22L2.804 17V7L12 2Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M12 6L17.598 9.25V15.75L12 19L6.402 15.75V9.25L12 6Z"
            fill="currentColor"
            className="opacity-15"
          />
        </svg>
        {/* Phase 3.2 — display serif */}
        <h1 className="font-display text-xl font-semibold tracking-wide text-foreground">
          {t("brand.name")}
        </h1>
      </div>
      <div className="h-px w-full bg-primary opacity-60" />
      <p className="text-xs text-muted-foreground tracking-wide">{subtitle}</p>
    </div>
  );
}
