import { createContext, useContext, useEffect, useState } from "react";

export type ThemeValue = "light" | "dark" | "system";

// system 테마일 때 OS 설정을 읽어 실제 적용할 테마 결정
function resolveTheme(theme: ThemeValue): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

const ThemeContext = createContext<{
  theme: ThemeValue;
  /** 실제 화면에 적용된 테마 — system 인 경우 OS 설정을 풀어 light/dark 로 노출.
      토글 버튼이 "현재 보이는" 테마 기준으로 반전하려면 이 값을 써야 한다. */
  resolvedTheme: "light" | "dark";
  setTheme: (t: ThemeValue) => void;
}>({ theme: "system", resolvedTheme: "light", setTheme: () => {} });

/** 앱 최상단을 감싸는 테마 프로바이더. localStorage에 테마를 저장한다. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeValue>(
    () => (localStorage.getItem("theme") as ThemeValue) ?? "system"
  );
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => resolveTheme(theme));

  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    // html 요소에 dark 클래스를 붙이고 떼는 것으로 Tailwind dark: 변수 전환
    document.documentElement.classList.toggle("dark", resolved === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  /* OS 테마 변경 라이브 반영 — theme === "system" 일 때만 따라간다. */
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const resolved = mq.matches ? "dark" : "light";
      setResolvedTheme(resolved);
      document.documentElement.classList.toggle("dark", resolved === "dark");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = (t: ThemeValue) => setThemeState(t);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
