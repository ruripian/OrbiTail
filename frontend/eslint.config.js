import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

/**
 * ESLint 9 flat config — Vite + React + TypeScript.
 *
 * 타입 검사(미사용 변수, 타입 오류)는 `npm run build` 의 tsc strict 가 이미 담당한다.
 * 여기서는 tsc 가 못 잡는 것에 집중한다:
 *   - react-hooks: 의존성 배열 누락, 조건부 훅 호출 (런타임 버그로 이어짐)
 *   - react-refresh: HMR 이 깨지는 export 패턴
 */
export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      /* error 로 두는 것 — 실제로 앱을 깨뜨리는 것만.
         rules-of-hooks: early return 뒤 훅 호출 → 권한/로딩 상태가 바뀌는 순간 React 크래시. */
      "react-hooks/rules-of-hooks": "error",

      /* 아래는 전부 warn — 기존 코드에 대량으로 걸려 있어 error 로 두면
         lint 가 항상 실패하고 결국 아무도 안 돌리게 된다. 신규 코드에서 점진적으로 줄인다. */
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/immutability": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-explicit-any": "warn",
      /* `cond && fn()` / `a ? f() : g()` 는 이 코드베이스가 쓰는 의도적 실행문 —
         진짜 무효 표현식(오타로 버려진 식)만 잡도록 이 두 형태는 허용한다. */
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true },
      ],

      /* 미사용 변수는 tsc strict(noUnusedLocals)가 빌드에서 이미 에러로 잡는다 — 중복 경고 제거 */
      "@typescript-eslint/no-unused-vars": "off",
      /* 의도적으로 비운 catch 블록(실패해도 무시하는 로컬 저장 등)이 다수 — 규칙 자체를 끈다 */
      "no-empty": "off",
      /* 프로덕션에 남은 디버그 출력을 잡는다. 의도한 로깅은 disable 주석으로 표시. */
      "no-console": "warn",
    },
  },
  {
    /* 빌드 설정 파일 — tailwind 플러그인 로드는 require() 가 관행 */
    files: ["*.config.{ts,js}"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
