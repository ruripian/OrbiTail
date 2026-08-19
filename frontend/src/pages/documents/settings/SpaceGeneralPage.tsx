/**
 * 문서 스페이스 설정 · 일반 — 이름·아이콘·식별자·설명·공개 범위·보관·삭제.
 *
 * 아이콘/식별자/공개 범위는 모델에 이미 있던 필드인데 화면이 없어 손댈 수 없었다.
 * 프로젝트 스페이스는 프로젝트가 원본이라 대부분 읽기 전용으로 둔다.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Globe, Lock, Trash2 } from "lucide-react";
import { documentsApi } from "@/api/documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProjectIconPicker } from "@/components/ui/project-icon-picker";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api-error";
import { useSpaceSettings } from "./DocumentSpaceSettingsLayout";
import type { DocumentSpace } from "@/types";

/** Radix Select 는 빈 문자열을 placeholder 로 예약하므로 "지정 안 함"에 sentinel 이 필요하다 */
const NO_HOME = "__none__";

export default function SpaceGeneralPage() {
  const { space, workspaceSlug, spaceId, isAdmin } = useSpaceSettings();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const isProject = space.space_type === "project";
  const isShared = space.space_type === "shared";

  const [name, setName] = useState(space.name);
  const [identifier, setIdentifier] = useState(space.identifier ?? "");
  const [description, setDescription] = useState(space.description ?? "");
  useEffect(() => {
    setName(space.name);
    setIdentifier(space.identifier ?? "");
    setDescription(space.description ?? "");
  }, [space.id, space.name, space.identifier, space.description]);

  /* 홈 문서 후보 — 폴더를 뺀 이 스페이스의 문서들 */
  const { data: docs = [] } = useQuery({
    queryKey: ["documents", workspaceSlug, spaceId, "all"],
    queryFn: () => documentsApi.list(workspaceSlug, spaceId, { all: "true" }),
  });

  const update = useMutation({
    mutationFn: (data: Partial<DocumentSpace>) => documentsApi.spaces.update(workspaceSlug, spaceId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document-spaces", workspaceSlug] });
      toast.success("저장됨");
    },
    onError: (e) => toast.error(apiErrorMessage(e, "저장 실패")),
  });

  const remove = useMutation({
    mutationFn: () => documentsApi.spaces.delete(workspaceSlug, spaceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document-spaces", workspaceSlug] });
      toast.success("스페이스 삭제됨");
      navigate(`/${workspaceSlug}/documents`);
    },
    onError: (e) => toast.error(apiErrorMessage(e, "삭제 실패")),
  });

  const archived = !!space.archived_at;

  return (
    <div className="max-w-regular space-y-6">
      <div>
        <h1 className="text-lg font-semibold">일반</h1>
        <p className="text-sm text-muted-foreground mt-1">
          스페이스 이름과 표시 방식, 공개 범위를 관리합니다.
        </p>
      </div>

      {!isAdmin && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          읽기 전용입니다 — 스페이스 관리자만 설정을 변경할 수 있습니다.
        </p>
      )}

      <section className="rounded-xl border bg-card p-5 space-y-4">
        {/* 아이콘은 트리거가 정사각(48px)이라 입력창(36px)과 한 줄에 두면 높이가 어긋난다 —
            프로젝트 설정과 같이 독립 필드로 둔다 */}
        <div className="space-y-1.5">
          <Label className="text-xs">아이콘</Label>
          <div className="flex items-center gap-3">
            <ProjectIconPicker
              value={space.icon_prop}
              size="md"
              onChange={(next) => isAdmin && update.mutate({ icon_prop: next as unknown as Record<string, unknown> })}
            />
            <p className="text-xs text-muted-foreground">
              클릭해서 아이콘·색을 바꾸거나 이미지를 올립니다. 선택하면 바로 저장됩니다.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">이름</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={isProject || !isAdmin} />
            {isProject && (
              <p className="text-2xs text-muted-foreground">프로젝트 스페이스 이름은 프로젝트와 동기화됩니다.</p>
            )}
          </div>
          <div className="w-40 space-y-1.5">
            <Label className="text-xs">식별자</Label>
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value.toUpperCase())}
              disabled={isProject || !isAdmin}
              placeholder="DOC"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">설명</Label>
          <textarea
            className="w-full min-h-[72px] rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60"
            value={description}
            disabled={!isAdmin}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!isAdmin || update.isPending}
            onClick={() => update.mutate({ name: name.trim(), identifier: identifier.trim(), description: description.trim() })}
          >
            {update.isPending ? "저장 중..." : "저장"}
          </Button>
        </div>
      </section>

      {/* 홈 문서 — 스페이스에 들어왔을 때 먼저 열 개요 페이지 */}
      <section className="rounded-xl border bg-card p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">홈 문서</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            지정하면 스페이스에 들어올 때 이 문서가 먼저 열립니다. 문서를 삭제하면 자동으로 해제됩니다.
          </p>
        </div>
        <Select
          value={space.home_document ?? NO_HOME}
          disabled={!isAdmin}
          onValueChange={(v) => update.mutate({ home_document: v === NO_HOME ? null : v })}
        >
          <SelectTrigger className="h-9 max-w-sm text-sm">
            <SelectValue placeholder="선택 안 함" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_HOME}>선택 안 함</SelectItem>
            {docs.filter((d) => !d.is_folder).map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      {/* 공개 범위 — 공용 스페이스에서만 의미가 있다.
          프로젝트 스페이스는 프로젝트 network 를, 개인 스페이스는 owner 를 따른다. */}
      <section className="rounded-xl border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">공개 범위</h2>
        {isShared ? (
          <div className="space-y-2">
            {[
              { value: false, icon: Globe, title: "공개", desc: "워크스페이스 멤버 누구나 찾아 들어와 편집할 수 있습니다." },
              { value: true, icon: Lock, title: "비공개", desc: "멤버로 추가된 사람만 접근할 수 있습니다." },
            ].map(({ value, icon: Icon, title, desc }) => (
              <button
                key={title}
                disabled={!isAdmin}
                onClick={() => update.mutate({ is_private: value })}
                className={`w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${
                  !!space.is_private === value ? "border-primary bg-primary/5" : "hover:bg-accent/40"
                }`}
              >
                <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">{title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {isProject
              ? "프로젝트 스페이스는 연결된 프로젝트의 공개 설정을 따릅니다."
              : "개인 스페이스는 본인만 접근할 수 있습니다."}
          </p>
        )}
      </section>

      {/* 보관 / 삭제 */}
      {!isProject && (
        <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-destructive">보관 및 삭제</h2>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{archived ? "보관됨" : "스페이스 보관"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                보관하면 목록에서 감춰지지만 문서는 그대로 남습니다. 언제든 되돌릴 수 있습니다.
              </p>
            </div>
            <Button
              size="sm" variant="outline" disabled={!isAdmin || update.isPending}
              onClick={() => update.mutate({ archived_at: archived ? null : new Date().toISOString() })}
            >
              {archived ? <ArchiveRestore className="h-3.5 w-3.5 mr-1.5" /> : <Archive className="h-3.5 w-3.5 mr-1.5" />}
              {archived ? "보관 해제" : "보관"}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-destructive/20 pt-4">
            <div>
              <p className="text-sm font-medium">스페이스 삭제</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                안의 모든 문서가 함께 삭제됩니다. 되돌릴 수 없습니다.
              </p>
            </div>
            <Button
              size="sm" variant="ghost"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              disabled={!isAdmin || remove.isPending}
              onClick={() => {
                if (window.confirm(`"${space.name}" 스페이스와 안의 모든 문서를 영구 삭제할까요?`)) remove.mutate();
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              삭제
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
