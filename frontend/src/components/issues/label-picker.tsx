import { useState } from "react";
import { ChevronDown, Check, Tag, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { issuesApi } from "@/api/issues";
import { cn } from "@/lib/utils";
import type { Label } from "@/types";

/**
 * LabelPicker — 이슈 라벨 다중 선택 드롭다운 (인라인 편집용)
 *
 * 재사용: TableView, IssueDetailPage 등 라벨을 인라인 변경하는 모든 곳
 *
 * 사용:
 *   <LabelPicker
 *     labels={labels}
 *     currentIds={issue.label}
 *     currentDetails={issue.label_details}
 *     onChange={(ids) => updateMutation.mutate({ label: ids })}
 *   />
 */

interface Props {
  labels:          Label[];
  currentIds:      string[];
  /** 표시용 상세 — 없으면 labels에서 조회 */
  currentDetails?: Label[] | null;
  onChange:        (ids: string[]) => void;
  className?:      string;
  /** ws/project 지정 시 드롭다운 하단에 "라벨 추가"가 노출되어 즉석 생성 가능 */
  workspaceSlug?:  string;
  projectId?:      string;
}

export function LabelPicker({ labels, currentIds, currentDetails, onChange, className, workspaceSlug, projectId }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const details: Label[] =
    currentDetails ?? labels.filter((l) => currentIds.includes(l.id));

  /* 즉석 라벨 생성 — 색은 기본값. 생성 후 라벨 목록 갱신 + 새 라벨 자동 선택 */
  const canCreate = !!workspaceSlug && !!projectId;
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const createMutation = useMutation({
    mutationFn: (name: string) =>
      issuesApi.labels.create(workspaceSlug!, projectId!, { name, color: "#5E6AD2" }),
    onSuccess: (label) => {
      qc.invalidateQueries({ queryKey: ["labels"] });
      onChange([...currentIds, label.id]);
      setNewName("");
      setAdding(false);
    },
    onError: () => toast.error(t("labels.createFailed")),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`${t("issues.detail.meta.label")} (${details.length})`}
          aria-haspopup="menu"
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs hover:bg-muted/60 transition-colors w-full min-h-[28px] overflow-hidden",
            className,
          )}
        >
          {details.length === 0 ? (
            <>
              <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
              <span className="text-muted-foreground/40 flex-1 text-left">—</span>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-1 flex-1 overflow-hidden">
              {details.slice(0, 2).map((l) => (
                <span
                  key={l.id}
                  className="rounded-full px-2 py-0.5 text-2xs leading-none shrink-0"
                  style={{ background: l.color + "22", color: l.color }}
                >
                  {l.name}
                </span>
              ))}
              {details.length > 2 && (
                <span className="text-muted-foreground text-2xs shrink-0">
                  +{details.length - 2}
                </span>
              )}
            </div>
          )}
          <ChevronDown className="h-3 w-3 ml-auto text-muted-foreground/60 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48 rounded-xl p-1.5" onClick={(e) => e.stopPropagation()}>
        {labels.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-1.5">{t("issues.picker.noLabels")}</p>
        ) : (
          labels.map((l) => {
            const selected = currentIds.includes(l.id);
            return (
              <DropdownMenuItem
                key={l.id}
                className="gap-2 rounded-lg text-xs cursor-pointer"
                onSelect={(e) => {
                  /* onSelect는 기본으로 닫는데, 다중 선택을 위해 닫힘 방지 */
                  e.preventDefault();
                  const next = selected
                    ? currentIds.filter((id) => id !== l.id)
                    : [...currentIds, l.id];
                  onChange(next);
                }}
              >
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: l.color }} />
                <span className="flex-1 truncate">{l.name}</span>
                {selected && <Check className="h-3 w-3 text-primary shrink-0" />}
              </DropdownMenuItem>
            );
          })
        )}

        {/* 라벨 즉석 추가 — ws/project 가 있을 때만 */}
        {canCreate && (
          <>
            <DropdownMenuSeparator />
            {adding ? (
              <div className="px-1 py-0.5" onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    /* Radix 메뉴 타입어헤드가 입력을 가로채지 않도록 전파 차단 */
                    e.stopPropagation();
                    if (e.key === "Enter" && newName.trim() && !createMutation.isPending) {
                      createMutation.mutate(newName.trim());
                    } else if (e.key === "Escape") {
                      setAdding(false);
                      setNewName("");
                    }
                  }}
                  placeholder={t("labels.namePlaceholder", "라벨 이름 (Enter)")}
                  className="w-full bg-transparent text-xs outline-none border border-border rounded-md px-2 py-1 placeholder:text-muted-foreground"
                />
              </div>
            ) : (
              <DropdownMenuItem
                className="gap-2 rounded-lg text-xs cursor-pointer text-primary"
                onSelect={(e) => { e.preventDefault(); setAdding(true); }}
              >
                <Plus className="h-3 w-3 shrink-0" />
                {t("labels.add", "라벨 추가")}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
