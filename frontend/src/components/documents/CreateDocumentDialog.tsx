/**
 * 새 문서 만들기 다이얼로그 — 스페이스/부모/제목 선택.
 *
 * 만든 후 onCreated(doc) 호출. 호출자가 후속 처리(이슈에 link, navigate 등) 담당.
 */
import { useEffect, useState, useMemo } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { documentsApi } from "@/api/documents";
import { toast } from "sonner";
import type { Document } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  /** 기본 선택할 스페이스 (있으면 dropdown 잠금) */
  defaultSpaceId?: string;
  /** 기본 제목 */
  defaultTitle?: string;
  onCreated: (doc: Document) => void | Promise<void>;
}

export function CreateDocumentDialog({
  open, onOpenChange, workspaceSlug, defaultSpaceId, defaultTitle = "", onCreated,
}: Props) {
  const [title, setTitle] = useState(defaultTitle);
  const [spaceId, setSpaceId] = useState<string>(defaultSpaceId ?? "");
  const [parentId, setParentId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(defaultTitle);
      setSpaceId(defaultSpaceId ?? "");
      setParentId("");
    }
  }, [open, defaultTitle, defaultSpaceId]);

  const { data: spaces = [] } = useQuery({
    queryKey: ["document-spaces", workspaceSlug],
    queryFn: () => documentsApi.spaces.list(workspaceSlug),
    enabled: open && !!workspaceSlug,
  });

  /* 선택된 스페이스의 모든 문서 — 부모 후보 (folder만) */
  const { data: docs = [] } = useQuery({
    queryKey: ["docs-flat", workspaceSlug, spaceId],
    queryFn: () => documentsApi.list(workspaceSlug, spaceId, { all: "true" }),
    enabled: open && !!workspaceSlug && !!spaceId,
  });
  const parentOptions = useMemo(
    () => [{ id: "", title: "최상위" }, ...docs.filter((d) => d.is_folder).map((d) => ({ id: d.id, title: d.title || "제목 없음" }))],
    [docs],
  );

  const handleCreate = async () => {
    if (!spaceId) { toast.error("스페이스를 선택하세요."); return; }
    if (!title.trim()) { toast.error("제목을 입력하세요."); return; }
    setBusy(true);
    try {
      const doc = await documentsApi.create(workspaceSlug, spaceId, {
        title: title.trim(),
        parent: parentId || null,
      });
      await onCreated(doc);
      onOpenChange(false);
    } catch {
      toast.error("문서 생성 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-xl p-5 space-y-4">
        <h2 className="text-base font-semibold">새 문서 만들기</h2>

        <div className="space-y-1.5">
          <Label className="text-xs">제목</Label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="문서 제목"
            className="w-full h-9 px-3 text-sm rounded-md border bg-background outline-none focus:border-primary"
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">스페이스</Label>
          <Select value={spaceId} onValueChange={(v) => { setSpaceId(v); setParentId(""); }} disabled={!!defaultSpaceId}>
            <SelectTrigger className="w-full h-9 text-sm">
              <SelectValue placeholder="스페이스 선택" />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {spaces.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-sm">{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">부모 폴더 (선택)</Label>
          <Select value={parentId || "_root"} onValueChange={(v) => setParentId(v === "_root" ? "" : v)} disabled={!spaceId}>
            <SelectTrigger className="w-full h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {parentOptions.map((p) => (
                <SelectItem key={p.id || "_root"} value={p.id || "_root"} className="text-sm">{p.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>취소</Button>
          <Button size="sm" onClick={handleCreate} disabled={busy || !title.trim() || !spaceId}>
            {busy ? "생성 중..." : "만들기"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
