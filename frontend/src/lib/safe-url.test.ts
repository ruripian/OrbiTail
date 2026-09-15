import { describe, expect, it } from "vitest";
import { safeFrameUrl, safeUrl } from "./safe-url";
import { sanitizeHtml } from "./sanitize-html";

const TAB = String.fromCharCode(9);

describe("safeUrl", () => {
  it("스크립트를 실행하는 주소는 버린다", () => {
    for (const bad of ["javascript:alert(1)", ` JaVa${TAB}Script:alert(1)`, "vbscript:x", "data:text/html,<b>", "data:image/svg+xml,<svg>"]) {
      expect(safeUrl(bad, { allowDataImage: true }), bad).toBeUndefined();
    }
  });

  it("평범한 주소는 그대로", () => {
    for (const ok of ["https://a.io/x", "http://a.io", "mailto:a@b.c", "/media/a.pdf", "#top", "page.md"]) {
      expect(safeUrl(ok)).toBe(ok);
    }
    expect(safeUrl("data:image/png;base64,AAA", { allowDataImage: true })).toBe("data:image/png;base64,AAA");
    expect(safeUrl("data:image/png;base64,AAA")).toBeUndefined();
  });

  it("프레임은 업로드 파일이나 https 만", () => {
    expect(safeFrameUrl("/media/doc.pdf")).toBe("/media/doc.pdf");
    expect(safeFrameUrl("https://files.example.com/a.pdf")).toBe("https://files.example.com/a.pdf");
    expect(safeFrameUrl("/api/admin/users/")).toBeUndefined();
    expect(safeFrameUrl("http://a.io/x.pdf")).toBeUndefined();
  });
});

describe("sanitizeHtml", () => {
  it("이벤트 핸들러·스크립트·위험한 링크를 걷어내고 서식은 남긴다", () => {
    const out = sanitizeHtml('<p class="x"><strong>굵게</strong><img src=x onerror="alert(1)"><a href="javascript:alert(1)">a</a><script>alert(1)</script></p>');
    expect(out).toContain("<strong>굵게</strong>");
    expect(out).toContain('class="x"');
    expect(out).not.toMatch(/onerror|javascript:|<script/i);
  });
});
