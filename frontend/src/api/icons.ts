import { api } from "@/lib/axios";

/**
 * 사용자 지정 아이콘 업로드 — 프로젝트/카테고리/스페이스 등에서 공용으로 사용.
 * 반환된 url 을 icon_prop = { type: "image", url } 형태로 저장하면
 * ProjectIcon 컴포넌트가 img 로 렌더함.
 */
export const iconsApi = {
  upload: (file: File | Blob): Promise<{ url: string }> => {
    const fd = new FormData();
    const f = file instanceof File ? file : new File([file], "icon.jpg", { type: "image/jpeg" });
    fd.append("file", f);
    return api.post<{ url: string }>("/icons/upload/", fd).then((r) => r.data);
  },
};
