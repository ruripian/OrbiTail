#!/usr/bin/env node
/**
 * i18n 회귀 검사.
 *
 * locales.test.ts 의 ko↔en 대칭성만으로는 못 잡는 두 구멍을 막는다.
 *   1. 코드가 쓰는 t() 키가 로케일에 아예 없는 경우
 *      → i18next 가 t(key, "한글") 의 두 번째 인자를 그대로 렌더한다.
 *        ko/en 양쪽에서 똑같이 빠지면 대칭성 검사는 통과한다.
 *   2. t() 를 거치지 않고 소스에 직접 박힌 한글
 *      → 언어 설정과 무관하게 항상 한글로 보인다.
 *
 * 사용: node scripts/check-i18n.mjs        (문제가 있으면 exit 1)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "frontend/src");
const HANGUL = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;

/** 주석만 공백으로 지운다. 문자열 안의 // 나 /* 는 건드리지 않는다. */
function stripComments(src) {
  let out = "";
  let state = "code"; // code | line | block | sq | dq | bt
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1] ?? "";
    if (state === "code") {
      if (c === "/" && n === "/") { state = "line"; out += "  "; i++; continue; }
      if (c === "/" && n === "*") { state = "block"; out += "  "; i++; continue; }
      if (c === "'") state = "sq";
      else if (c === '"') state = "dq";
      else if (c === "`") state = "bt";
      out += c;
      continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; out += "\n"; } else out += " ";
      continue;
    }
    if (state === "block") {
      if (c === "*" && n === "/") { state = "code"; out += "  "; i++; continue; }
      out += c === "\n" ? "\n" : " ";
      continue;
    }
    // 문자열 내부
    if (c === "\\") { out += c + (src[i + 1] ?? ""); i++; continue; }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "bt" && c === "`")) {
      state = "code";
    }
    out += c;
  }
  return out;
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (["node_modules", "dist", ".git"].includes(e.name)) continue;
      walk(path.join(dir, e.name), acc);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      acc.push(path.join(dir, e.name));
    }
  }
  return acc;
}

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const en = flatten(JSON.parse(fs.readFileSync(path.join(SRC, "locales/en/common.json"), "utf8")));
const ko = flatten(JSON.parse(fs.readFileSync(path.join(SRC, "locales/ko/common.json"), "utf8")));

const files = walk(SRC).filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes("/locales/"));

const T_CALL = /\bt\(\s*"([^"]+)"/g;
/** t("key", "기본값") 의 기본값 문자열을 같은 길이의 공백으로 지운다(줄 수 유지).
 *  기본값은 키 누락 검사가 따로 보므로, 하드코딩 검사에서는 세지 않는다. */
const blankDefaults = (code) =>
  code.replace(/\bt\(\s*"[^"]+"\s*,\s*"(?:[^"\\]|\\.)*"/g, (m) =>
    m.replace(/[^\n]/g, " "));
const missing = new Map();   // key -> "file:line"
const hardcoded = [];        // {file, line, text}

for (const file of files) {
  const raw = fs.readFileSync(file, "utf8");
  if (!HANGUL.test(raw) && !raw.includes("t(")) continue;
  const rawLines = raw.split("\n");
  const codeLines = blankDefaults(stripComments(raw)).split("\n");

  codeLines.forEach((line, idx) => {
    for (const m of line.matchAll(T_CALL)) {
      const key = m[1];
      if (!(key in en) || !(key in ko)) {
        if (!missing.has(key)) missing.set(key, `${path.relative(ROOT, file)}:${idx + 1}`);
      }
    }
    // 의도적으로 한글인 줄(저장된 데이터와의 비교 등)은 // i18n-ignore 로 표시한다
    if (/\/\/\s*i18n-ignore/.test(rawLines[idx])) return;
    if (HANGUL.test(line)) {
      hardcoded.push({ file: path.relative(ROOT, file), line: idx + 1, text: rawLines[idx].trim().slice(0, 120) });
    }
  });
}

// en 값에 한글이 남아 있는가 (langKo 처럼 자기 언어 이름은 예외)
const EN_VALUE_ALLOW = new Set(["settings.preferences.langKo"]);
const untranslated = Object.entries(en)
  .filter(([k, v]) => typeof v === "string" && HANGUL.test(v) && !EN_VALUE_ALLOW.has(k));

let failed = false;
const report = (title, items, fmt) => {
  if (!items.length) { console.log(`  OK  ${title}`); return; }
  failed = true;
  console.log(`\n  FAIL  ${title}: ${items.length} 건`);
  items.slice(0, 30).forEach((i) => console.log(`        ${fmt(i)}`));
  if (items.length > 30) console.log(`        ... 외 ${items.length - 30} 건`);
};

console.log("i18n 검사");
report("로케일에 없는 t() 키", [...missing.entries()], ([k, loc]) => `${k}  (${loc})`);
report("en 로케일에 남은 한글", untranslated, ([k, v]) => `${k} = ${JSON.stringify(v)}`);
report("t() 를 거치지 않은 한글", hardcoded, (h) => `${h.file}:${h.line}  ${h.text}`);

process.exit(failed ? 1 : 0);
