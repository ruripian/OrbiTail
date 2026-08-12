import { describe, it, expect } from "vitest";
import { AxiosError, AxiosHeaders } from "axios";
import { apiErrorMessage, apiErrorStatus } from "./api-error";

/** 실제 axios 에러와 같은 형태를 만든다 — isAxiosError 판별을 통과해야 하므로 AxiosError 인스턴스 사용. */
function axiosErr(status: number, data: unknown): AxiosError {
  const err = new AxiosError("req failed", "ERR_BAD_REQUEST");
  err.response = {
    status,
    statusText: "",
    data,
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
  return err;
}

describe("apiErrorMessage", () => {
  it("DRF 의 detail 문자열을 그대로 쓴다", () => {
    expect(apiErrorMessage(axiosErr(403, { detail: "권한이 없습니다" }), "기본")).toBe("권한이 없습니다");
  });

  it("필드 검증 에러는 첫 메시지를 쓴다 — slug 중복 등이 fallback 에 묻히지 않아야 한다", () => {
    expect(apiErrorMessage(axiosErr(400, { slug: ["이미 사용 중입니다"] }), "기본")).toBe("이미 사용 중입니다");
  });

  it("detail 이 있으면 필드 에러보다 우선한다", () => {
    const e = axiosErr(400, { detail: "우선", slug: ["나중"] });
    expect(apiErrorMessage(e, "기본")).toBe("우선");
  });

  it("detail 이 빈 문자열이면 fallback — 빈 토스트가 뜨지 않게", () => {
    expect(apiErrorMessage(axiosErr(400, { detail: "" }), "기본")).toBe("기본");
  });

  it("응답 본문이 문자열(HTML 에러 페이지 등)이면 fallback", () => {
    expect(apiErrorMessage(axiosErr(500, "<html>500</html>"), "기본")).toBe("기본");
  });

  it("응답 자체가 없는 네트워크 오류는 fallback", () => {
    expect(apiErrorMessage(new AxiosError("Network Error"), "기본")).toBe("기본");
  });

  it("axios 가 아닌 일반 예외도 fallback", () => {
    expect(apiErrorMessage(new Error("boom"), "기본")).toBe("기본");
    expect(apiErrorMessage(undefined, "기본")).toBe("기본");
  });

  it("빈 배열 필드는 건너뛴다", () => {
    expect(apiErrorMessage(axiosErr(400, { slug: [], name: ["이름 필수"] }), "기본")).toBe("이름 필수");
  });
});

describe("apiErrorStatus", () => {
  it("axios 에러의 상태 코드를 반환한다", () => {
    expect(apiErrorStatus(axiosErr(413, {}))).toBe(413);
  });

  it("axios 가 아니거나 응답이 없으면 undefined", () => {
    expect(apiErrorStatus(new Error("boom"))).toBeUndefined();
    expect(apiErrorStatus(new AxiosError("Network Error"))).toBeUndefined();
  });
});
