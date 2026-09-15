/**
 * 저장된 HTML 을 dangerouslySetInnerHTML 로 그리기 전에 한 번 더 정리한다.
 *
 * 서버가 저장할 때 정리하지만(apps/core/html_sanitize.py) 그 전에 저장된 값이 남아 있을 수 있다.
 * 공개 공유 링크처럼 로그인하지 않은 사람도 여는 화면이 있어 두 겹으로 막는다.
 */
import DOMPurify from "dompurify";

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["style", "form", "textarea", "select", "button"],
  });
}
