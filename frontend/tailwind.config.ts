import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // 우선순위 색상 — tokens.css 기본값, 런타임에서 워크스페이스 설정으로 덮어씀
        priority: {
          urgent: "var(--priority-urgent)",
          high:   "var(--priority-high)",
          medium: "var(--priority-medium)",
          low:    "var(--priority-low)",
          none:   "var(--priority-none)",
        },
        // 상태 그룹 색상 — Phase 2.2: fill / text / border 3쌍.
        // DEFAULT는 fill로 매핑 → 기존 bg-state-started 등은 fill 색을 그대로 받음.
        state: {
          backlog: {
            DEFAULT: "var(--state-backlog-fill)",
            fill:    "var(--state-backlog-fill)",
            text:    "var(--state-backlog-text)",
            border:  "var(--state-backlog-border)",
          },
          unstarted: {
            DEFAULT: "var(--state-unstarted-fill)",
            fill:    "var(--state-unstarted-fill)",
            text:    "var(--state-unstarted-text)",
            border:  "var(--state-unstarted-border)",
          },
          started: {
            DEFAULT: "var(--state-started-fill)",
            fill:    "var(--state-started-fill)",
            text:    "var(--state-started-text)",
            border:  "var(--state-started-border)",
          },
          completed: {
            DEFAULT: "var(--state-completed-fill)",
            fill:    "var(--state-completed-fill)",
            text:    "var(--state-completed-text)",
            border:  "var(--state-completed-border)",
          },
          cancelled: {
            DEFAULT: "var(--state-cancelled-fill)",
            fill:    "var(--state-cancelled-fill)",
            text:    "var(--state-cancelled-text)",
            border:  "var(--state-cancelled-border)",
          },
        },
      },
      borderRadius: {
        "2xl": "calc(var(--radius) + 6px)",
        xl:    "calc(var(--radius) + 2px)",
        lg:    "var(--radius)",
        md:    "calc(var(--radius) - 2px)",
        sm:    "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        /* CSS 변수 → 폰트 추가/교체는 index.css 변수만 바꾸면 됨 */
        sans:    ["var(--font-sans)"],
        mono:    ["var(--font-mono)"],
        heading: ["var(--font-heading)"],
        /* Phase 3.2 — display serif. font-display 클래스로 사용 (auth/dashboard/empty/onboarding hero) */
        display: ["var(--font-display)"],
      },
      fontSize: {
        /*
         * html font-size = clamp(14px, 0.875vw, 19px) 기준
         * FHD(1920)에서 16.8px → rem 값은 이 베이스에 비례
         *
         * 계층:
         *   3xs  ~9px   — 배지 카운트, 알림 숫자
         *   2xs  ~11px  — 타임스탬프, 키보드 힌트
         *   xs   ~13px  — 라벨, 캡션, 피커 항목
         *   sm   ~15px  — 본문, 사이드바 아이템
         *   base ~17px  — 기본 본문, 네비게이션
         *   lg   ~19px  — 섹션 제목
         *   xl   ~21px  — 페이지 소제목
         *   2xl  ~25px  — 페이지 제목
         *   3xl  ~31px  — 대시보드 인사
         *   4xl  ~38px  — 히어로 텍스트
         */
        "3xs": ["0.5625rem", { lineHeight: "0.75rem" }],
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        xs:    ["0.8125rem", { lineHeight: "1.25rem" }],
        sm:    ["0.9375rem", { lineHeight: "1.5rem" }],
        base:  ["1rem",      { lineHeight: "1.5rem" }],
        lg:    ["1.125rem",  { lineHeight: "1.75rem" }],
        xl:    ["1.25rem",   { lineHeight: "1.75rem" }],
        "2xl": ["1.5rem",    { lineHeight: "2rem" }],
        "3xl": ["1.875rem",  { lineHeight: "2.25rem" }],
        "4xl": ["2.25rem",   { lineHeight: "2.5rem" }],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
