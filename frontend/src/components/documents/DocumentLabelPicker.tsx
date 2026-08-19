/**
 * 문서 라벨 칩 + 선택기 — 라벨을 다루는 모든 곳의 단일 컴포넌트.
 *
 * 문서 편집 화면(부착), 검색 필터(선택), 설정의 라벨 관리(목록)가 같은 시각을 쓰도록
 * 칩 렌더(LabelChip)와 선택 팝오버(DocumentLabelPicker)를 여기서 함께 제공한다.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Tag, X } from "lucide-react";
import { documentsApi } from "@/api/documents";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DocumentLabel } from "@/types";

/** 새 라벨에 돌아가며 배정할 색 — 사용자가 매번 색을 고르지 않아도 서로 구분되게 */
export const LABEL_COLORS = [
  "#6b7280", "#ef4444", "#f59e0b", "#10b981",
  "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6",
];

export function LabelChip({
  label, onRemove, className,
}: { label: DocumentLabel; onRemove?: () => void; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium",
        className,
      )}
      style={{ backgroundColor: `${label.color}1a`, color: label.color }}
    >
      {label.name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
          className="hover:opacity-70"
          aria-label={`${label.name} 제거`}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

interface Props {
  workspaceSlug: string;
  /** 선택된 라벨 id */
  value: string[];
  onChange: (ids: string[]) => void;
  /** 없는 라벨을 그 자리에서 만들 수 있게 할지 — 검색 필터에서는 끈다 */
  allowCreate?: boolean;
  disabled?: boolean;
  triggerLabel?: string;
}

export function DocumentLabelPicker({
  workspaceSlug, value, onChange, allowCreate = true, disabled, triggerLabel = "라벨",
}: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { data: labels = [] } = useQuery({
    queryKey: ["document-labels", workspaceSlug],
    queryFn: () => documentsApi.labels.list(workspaceSlug),
  });

  const create = useMutation({
    mutationFn: (name: string) =>
      documentsApi.labels.create(workspaceSlug, {
        name,
        // 이미 있는 색을 피해 돌아가며 배정
        color: LABEL_COLORS[labels.length % LABEL_COLORS.length],
      }),
    onSuccess: (label) => {
      qc.invalidateQueries({ queryKey: ["document-labels", workspaceSlug] });
      if (!value.includes(label.id)) onChange([...value, label.id]);
      setQuery("");
    },
  });

  const filtered = labels.filter((l) => l.name.toLowerCase().includes(query.trim().toLowerCase()));
  const exactExists = labels.some((l) => l.name.toLowerCase() === query.trim().toLowerCase());

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-2xs text-muted-foreground hover:text-foreground hover:border-solid transition-colors disabled:opacity-50"
          disabled={disabled}
        >
          <Tag className="h-3 w-3" />
          {triggerLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="라벨 검색"
          className="h-8 text-xs mb-2"
          onKeyDown={(e) => {
            if (e.key === "Enter" && allowCreate && query.trim() && !exactExists) create.mutate(query.trim());
          }}
        />
        <ul className="max-h-56 overflow-y-auto space-y-0.5">
          {filtered.map((label) => (
            <li key={label.id}>
              <button
                type="button"
                onClick={() => toggle(label.id)}
                className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent/50"
              >
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                <span className="flex-1 truncate text-xs">{label.name}</span>
                {value.includes(label.id) && <Check className="h-3 w-3 text-primary shrink-0" />}
              </button>
            </li>
          ))}
          {filtered.length === 0 && !query && (
            <li className="px-2 py-3 text-2xs text-muted-foreground">아직 라벨이 없습니다.</li>
          )}
        </ul>
        {allowCreate && query.trim() && !exactExists && (
          <button
            type="button"
            onClick={() => create.mutate(query.trim())}
            disabled={create.isPending}
            className="mt-1 w-full flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-primary hover:bg-primary/5"
          >
            <Plus className="h-3 w-3" />
            "{query.trim()}" 만들기
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
