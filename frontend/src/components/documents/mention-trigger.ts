/**
 * 멘션 팝업을 여는 입력 트리거 판정.
 *
 * 에디터에서 떼어낸 이유는 두 가지다. 트리거가 넷이고 우선순위가 있어 규칙이 눈으로만은
 * 확인되지 않고, DocumentEditor 는 통째로 불러오면 katex·mermaid 까지 딸려 와 테스트가 무겁다.
 */

/** 멘션 항목의 종류. `label` 은 본문에 박는 인라인 태그 — 고르면 문서에 라벨이 붙는다. */
export type MentionKind = "user" | "doc" | "issue" | "label";

/** 멘션을 여는 입력 문자. 문서는 `#`(기존)와 `[[`(Obsidian 관습) 둘 다 받는다. */
export type MentionTrigger = "@" | "#" | "$" | "[[";

/** 트리거 → 커서 앞 텍스트를 잡는 정규식. 팝업을 여는 판정과, 항목을 고를 때
 *  지울 범위를 정하는 계산이 같은 정의를 써야 어긋나지 않는다. */
export const MENTION_TRIGGER_RE: Record<MentionTrigger, RegExp> = {
  "@":  /(?:^|[^\w])@([\w가-힣ㄱ-ㅎㅏ-ㅣ\- ]*)$/,   // i18n-ignore — 한글 이름 매칭용 정규식
  "#":  /(?:^|[^\w])#([\w가-힣ㄱ-ㅎㅏ-ㅣ\- ]*)$/,   // i18n-ignore
  "$":  /(?:^|[^\w])\$([\w-]*)$/,
  "[[": /\[\[([\w가-힣ㄱ-ㅎㅏ-ㅣ\- ]*)$/,          // i18n-ignore
};

/* 트리거가 여는 "검색 모드". `#` 은 문서와 태그를 함께 찾는다 —
   기존 사용자는 `#` 으로 문서를 부르던 손버릇이 있고, Obsidian 사용자는 `#` 을 태그로 친다.
   둘 중 하나를 빼앗는 대신 한 팝업에 같이 담는다. `[[` 는 문서만 — 정확히 문서를 걸고 싶을 때. */
const KIND_OF: Record<MentionTrigger, MentionKind> = {
  "@": "user", "#": "doc", "$": "issue", "[[": "doc",
};

/** 그 트리거의 팝업이 태그도 함께 보여주는가 */
export function triggerIncludesLabels(trigger: MentionTrigger): boolean {
  return trigger === "#";
}

/* 두 글자짜리 `[[` 를 먼저 본다 — 한 글자 트리거가 먼저 잡히면 여는 괄호가 판정에서 빠진다. */
const ORDER: MentionTrigger[] = ["[[", "@", "#", "$"];

/** 커서 앞 텍스트에서 열려 있는 트리거를 찾는다. 없으면 null. */
export function matchMentionTrigger(
  textBeforeCursor: string,
): { trigger: MentionTrigger; kind: MentionKind; query: string } | null {
  for (const trigger of ORDER) {
    const m = textBeforeCursor.match(MENTION_TRIGGER_RE[trigger]);
    if (m) return { trigger, kind: KIND_OF[trigger], query: m[1] };
  }
  return null;
}

/**
 * 항목을 골랐을 때 커서 앞에서 지워야 할 글자 수.
 *
 * 트리거 길이 + 질의 길이로 센다. 매치 문자열 길이를 쓰면 정규식이 트리거 앞의
 * 구분자 한 글자(`(`, 공백 등)까지 물고 있어 멀쩡한 글자가 같이 지워진다.
 *
 * `[[` 뒤에 `#`을 이어 친 경우(`[[#회의` — Obsidian 에서 제목 링크를 쓰던 손버릇)는
 * 트리거가 `#`로 잡힌다. 그대로 두면 멘션 앞에 `[[`가 남으므로 여는 괄호까지 함께 지운다.
 */
export function mentionDeleteLength(textBeforeCursor: string, trigger: MentionTrigger): number {
  const m = textBeforeCursor.match(MENTION_TRIGGER_RE[trigger]);
  if (!m) return 0;
  let len = trigger.length + m[1].length;
  if (trigger !== "[[" && textBeforeCursor.slice(0, textBeforeCursor.length - len).endsWith("[[")) {
    len += 2;
  }
  return len;
}
