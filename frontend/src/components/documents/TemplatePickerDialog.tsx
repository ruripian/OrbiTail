/**
 * 템플릿 선택 다이얼로그 — 새 문서를 만들 때 내장/워크스페이스/내 템플릿 중 고르기.
 * 선택 시 onPick(template | null) 호출. null = 빈 문서.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Sparkles, Users, User as UserIcon, Trash2 } from "lucide-react";
import { documentsApi } from "@/api/documents";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import type { DocumentTemplate } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceSlug: string;
  onPick: (template: DocumentTemplate | null) => void;
}

type Tab = "all" | "built_in" | "workspace" | "user";

export function TemplatePickerDialog({ open, onOpenChange, workspaceSlug, onPick }: Props) {
  const [tab, setTab] = useState<Tab>("all");
  const currentUser = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["doc-templates", workspaceSlug],
    queryFn: () => documentsApi.templates.list(workspaceSlug),
    enabled: open,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.templates.delete(workspaceSlug, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doc-templates", workspaceSlug] }),
  });

  const templates = q.data ?? [];
  const filtered = tab === "all" ? templates : templates.filter((t) => t.scope === tab);

  const canDelete = (tpl: DocumentTemplate): boolean => {
    if (tpl.scope === "user") return tpl.owner === currentUser?.id;
    if (tpl.scope === "built_in") return !!currentUser?.is_superuser;
    if (tpl.scope === "workspace") return false; // 관리자 판별은 서버에서 enforce — UI는 보수적으로 숨김
    return false;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[calc(100vw-2rem)] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>새 문서 만들기</DialogTitle>
        </DialogHeader>

        {/* 탭 */}
        <div className="flex items-center gap-1 border-b -mt-2 pb-2">
          <TabBtn active={tab === "all"} onClick={() => setTab("all")}>전체</TabBtn>
          <TabBtn active={tab === "built_in"} onClick={() => setTab("built_in")}>
            <Sparkles className="h-3 w-3 mr-1 inline" />기본
          </TabBtn>
          <TabBtn active={tab === "workspace"} onClick={() => setTab("workspace")}>
            <Users className="h-3 w-3 mr-1 inline" />공유
          </TabBtn>
          <TabBtn active={tab === "user"} onClick={() => setTab("user")}>
            <UserIcon className="h-3 w-3 mr-1 inline" />내 템플릿
          </TabBtn>
        </div>

        <div className="flex-1 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
          {/* '빈 문서'는 전체/기본 탭일 때 항상 맨 처음에 노출 */}
          {(tab === "all" || tab === "built_in") && (
            <button
              type="button"
              onClick={() => { onPick(null); onOpenChange(false); }}
              className="text-left rounded-xl border border-dashed hover:border-primary/50 hover:bg-accent/30 transition-colors p-4 flex gap-3"
            >
              <div className="shrink-0 w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-xl">
                📄
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm">빈 문서</p>
                <p className="text-xs text-muted-foreground mt-0.5">처음부터 직접 작성</p>
              </div>
            </button>
          )}

          {q.isLoading ? (
            <p className="col-span-full p-6 text-sm text-muted-foreground text-center">로딩 중...</p>
          ) : filtered.length === 0 ? (
            <p className="col-span-full p-6 text-sm text-muted-foreground text-center">
              {tab === "user" ? "아직 저장된 템플릿이 없습니다. 기존 문서 설정 메뉴에서 '템플릿으로 저장' 가능." : "템플릿 없음"}
            </p>
          ) : (
            filtered
              // 빈 문서는 시드에 built_in으로 들어있는데 위에서 별도 처리 — 중복 방지
              .filter((t) => !(t.scope === "built_in" && t.name === "빈 페이지"))
              .map((tpl) => {
                const icon = (tpl.icon_prop as any)?.emoji ?? "📄";
                return (
                  <div
                    key={tpl.id}
                    className="group relative rounded-xl border hover:border-primary/50 hover:bg-accent/30 transition-colors p-4 cursor-pointer flex gap-3"
                    onClick={() => { onPick(tpl); onOpenChange(false); }}
                  >
                    <div className="shrink-0 w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-xl">
                      {icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{tpl.name}</p>
                        <ScopeBadge scope={tpl.scope} />
                      </div>
                      {tpl.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{tpl.description}</p>
                      )}
                    </div>
                    {canDelete(tpl) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`"${tpl.name}" 템플릿을 삭제하시겠습니까?`)) deleteMutation.mutate(tpl.id);
                        }}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 h-6 w-6 rounded-md hover:bg-destructive/10 hover:text-destructive flex items-center justify-center transition-opacity"
                        title="템플릿 삭제"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-xs px-2.5 py-1 rounded-md transition-colors",
        active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/50",
      )}
    >
      {children}
    </button>
  );
}

function ScopeBadge({ scope }: { scope: DocumentTemplate["scope"] }) {
  const cfg = {
    built_in: { label: "기본", cls: "bg-primary/10 text-primary", Icon: Sparkles },
    workspace: { label: "공유", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", Icon: Users },
    user: { label: "내 것", cls: "bg-muted text-muted-foreground", Icon: UserIcon },
  }[scope];
  const Icon = cfg.Icon;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-2xs px-1.5 py-0.5 rounded-full font-medium", cfg.cls)}>
      <Icon className="h-2.5 w-2.5" />
      {cfg.label}
    </span>
  );
}

/* "템플릿으로 저장" 다이얼로그 */
export function SaveAsTemplateDialog({
  open, onOpenChange, workspaceSlug, contentHtml, defaultName = "", isWorkspaceAdmin = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceSlug: string;
  contentHtml: string;
  defaultName?: string;
  isWorkspaceAdmin?: boolean;
}) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"user" | "workspace">("user");
  const qc = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: () => documentsApi.templates.create(workspaceSlug, {
      name: name.trim(), description: description.trim(), content_html: contentHtml, scope,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["doc-templates", workspaceSlug] });
      onOpenChange(false);
      setName(""); setDescription("");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>템플릿으로 저장</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">이름</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 주간 회고"
              className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">설명 (선택)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">범위</label>
            <div className="flex gap-2">
              <ScopeOption active={scope === "user"} onClick={() => setScope("user")} Icon={UserIcon} label="내 템플릿" hint="나만 사용" />
              <ScopeOption
                active={scope === "workspace"}
                onClick={() => isWorkspaceAdmin && setScope("workspace")}
                Icon={Users}
                label="워크스페이스 공유"
                hint={isWorkspaceAdmin ? "멤버 모두 사용" : "관리자만 생성 가능"}
                disabled={!isWorkspaceAdmin}
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button disabled={!name.trim() || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            <FileText className="h-4 w-4 mr-1" />
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ScopeOption({
  active, onClick, Icon, label, hint, disabled,
}: {
  active: boolean; onClick: () => void;
  Icon: React.ElementType;
  label: string; hint: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex-1 text-left rounded-lg border p-2.5 transition-colors",
        active ? "border-primary/60 bg-primary/5" : "border-border hover:bg-muted/40",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="text-2xs text-muted-foreground mt-0.5">{hint}</p>
    </button>
  );
}
