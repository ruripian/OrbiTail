import { describe, it, expect } from "vitest";
import { matchMentionTrigger, mentionDeleteLength, triggerIncludesLabels, MENTION_TRIGGER_RE } from "./mention-trigger";

describe("matchMentionTrigger", () => {
  it("`[[` 로 문서 멘션을 연다", () => {
    expect(matchMentionTrigger("[[")).toMatchObject({ trigger: "[[", kind: "doc", query: "" });
    expect(matchMentionTrigger("앞말 [[회의")).toMatchObject({ trigger: "[[", kind: "doc", query: "회의" });
  });

  it("기존 `#` 트리거는 그대로 동작한다", () => {
    expect(matchMentionTrigger("#회의")).toMatchObject({ trigger: "#", kind: "doc", query: "회의" });
  });

  it("`@`는 사용자, `$`는 이슈", () => {
    expect(matchMentionTrigger("@김")).toMatchObject({ trigger: "@", kind: "user" });
    expect(matchMentionTrigger("$ORB-1")).toMatchObject({ trigger: "$", kind: "issue" });
  });

  it("`[[` 뒤에 `#`을 이어 쳐도 여는 괄호가 본문에 남지 않는다", () => {
    // `#`가 트리거로 잡히는 건 맞다. 중요한 건 지울 때 `[[`까지 함께 지우는 것.
    const m = matchMentionTrigger("[[#회의")!;
    expect(m.kind).toBe("doc");
    expect(mentionDeleteLength("[[#회의", m.trigger)).toBe("[[#회의".length);
  });

  it("트리거 앞의 구분자는 지우지 않는다", () => {
    // 매치 문자열 길이로 세면 `(`까지 물고 들어가 멀쩡한 글자가 지워진다
    expect(mentionDeleteLength("(@김", "@")).toBe("@김".length);
    expect(mentionDeleteLength("앞말 [[회의", "[[")).toBe("[[회의".length);
  });

  it("여는 문자가 없으면 아무것도 열지 않는다", () => {
    expect(matchMentionTrigger("그냥 글")).toBeNull();
    expect(matchMentionTrigger("")).toBeNull();
    expect(matchMentionTrigger("[")).toBeNull();
  });

  it("이메일 주소로는 사용자 멘션이 열리지 않는다", () => {
    // `@` 앞이 단어 문자면 트리거로 보지 않는다
    expect(matchMentionTrigger("kim@orbitail")).toBeNull();
  });

  it("고를 때 지울 범위가 트리거 길이만큼 다르다", () => {
    // 같은 질의라도 `[[회의`(2글자 트리거)와 `#회의`(1글자)의 매치 길이가 달라야 한다
    const bracket = "[[회의".match(MENTION_TRIGGER_RE["[["])![0];
    const hash = "#회의".match(MENTION_TRIGGER_RE["#"])![0];
    expect(bracket).toBe("[[회의");
    expect(hash).toBe("#회의");
  });
});

describe("triggerIncludesLabels", () => {
  it("`#` 팝업만 태그를 함께 보여준다", () => {
    expect(triggerIncludesLabels("#")).toBe(true);
    expect(triggerIncludesLabels("[[")).toBe(false);
    expect(triggerIncludesLabels("@")).toBe(false);
  });
});
