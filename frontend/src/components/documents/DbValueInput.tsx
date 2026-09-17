/**
 * 표 칸 하나의 값 입력 — 칸 종류에 맞는 위젯을 고른다.
 *
 * 이걸 따로 둔 이유: 값을 쓰는 곳이 둘이다(문서 화면의 칸 목록, 표 뷰의 칸). 두 곳이 서로 다른
 * 규칙으로 값을 쓰면 같은 칸이 문서에서는 글자, 표에서는 숫자로 저장되는 일이 생긴다.
 *
 * 예전에는 사용자가 친 글자 모양으로 타입을 **추측**했다(쉼표 있으면 목록, true 면 참거짓…).
 * 무엇으로 저장될지 알 수 없어 직관적이지 않았다. 이제 칸이 종류를 갖고, 위젯이 거기서 나온다.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, X, Link2 } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { DbColumn } from "@/types";

/** 다른 것을 가리키는 칸의 값 — 보여줄 이름과 따라갈 id 를 함께 들고 있다 */
export interface DbRef { id: string; label: string }

export type DbValue = string | number | boolean | string[] | DbRef | null;

export function isDbRef(v: DbValue): v is DbRef {
  return !!v && typeof v === "object" && !Array.isArray(v) && "id" in v;
}

/** 값을 사람이 읽는 한 줄로 — 읽기 모드와 표 셀에서 함께 쓴다 */
export function formatDbValue(column: DbColumn, value: DbValue): string {
  if (value === null || value === undefined || value === "") return "";
  if (column.type === "checkbox") return value ? "✓" : "";
  if (isDbRef(value)) return value.label || value.id;
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** 정렬 기준값 — 날짜·숫자는 크기로, 나머지는 글자로 */
export function dbSortKey(column: DbColumn, value: DbValue): string | number {
  if (value === null || value === undefined) return column.type === "number" ? Number.NEGATIVE_INFINITY : "";
  if (column.type === "number") return typeof value === "number" ? value : Number(value) || 0;
  if (column.type === "checkbox") return value ? 1 : 0;
  if (isDbRef(value)) return (value.label || value.id).toLowerCase();
  return formatDbValue(column, value).toLowerCase();
}

interface Props {
  column: DbColumn;
  value: DbValue;
  editable: boolean;
  onChange: (next: DbValue) => void;
  /** 표 셀에서는 테두리 없이 칸을 꽉 채운다 */
  compact?: boolean;
  /** 가리키는 칸(이슈·문서)을 고를 때 — 부모가 피커를 연다 */
  onPickRef?: (column: DbColumn, current: DbValue) => void;
  /** 가리키는 대상을 열 때 */
  onOpenRef?: (column: DbColumn, ref: DbRef) => void;
}

export function DbValueInput({ column, value, editable, onChange, compact, onPickRef, onOpenRef }: Props) {
  const { t } = useTranslation();
  const base = compact
    ? "w-full bg-transparent outline-none text-xs px-2 py-1"
    : "flex-1 min-w-0 bg-transparent border-b border-transparent hover:border-border focus:border-primary outline-none py-0.5 text-xs";

  /* 생성일·수정일은 문서 자체에서 나온다 — "회의 날짜" 같은 걸 매번 손으로 적지 않게 하려고 둔 칸이다.
     값은 properties 가 아니라 문서의 타임스탬프에서 오므로 부모가 넣어 준다. */
  if (column.type === "created" || column.type === "updated") {
    return (
      <span className={cn("truncate text-xs text-muted-foreground", compact ? "px-2 py-1 block" : "flex-1")}>
        {typeof value === "string" && value ? value.slice(0, 10) : ""}
      </span>
    );
  }

  /* 가리키는 칸 — 고르는 일은 피커(이미 있는 이슈/문서 선택 화면)가 맡는다 */
  if (column.type === "issue" || column.type === "doc") {
    const ref = isDbRef(value) ? value : null;
    return (
      <div className={cn("flex items-center gap-1 min-w-0", compact ? "px-1.5 py-1" : "flex-1")}>
        {ref ? (
          <button
            type="button"
            className="text-xs truncate hover:underline text-left min-w-0 flex-1"
            onClick={() => onOpenRef?.(column, ref)}
          >
            {column.type === "issue"
              ? <span className="font-mono">{ref.label || ref.id}</span>
              : <span>{ref.label || ref.id}</span>}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground flex-1 truncate">
            {editable ? t("documents.db.pick") : ""}
          </span>
        )}
        {editable && (
          <>
            <button
              type="button"
              className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent shrink-0"
              title={t("documents.db.pick")}
              onClick={() => onPickRef?.(column, value)}
            >
              <Link2 className="h-3 w-3" />
            </button>
            {ref && (
              <button
                type="button"
                className="p-0.5 rounded text-muted-foreground hover:text-destructive shrink-0"
                title={t("documents.db.clear")}
                onClick={() => onChange(null)}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  if (!editable) {
    const text = formatDbValue(column, value);
    return <span className={cn("truncate text-xs", compact && "px-2 py-1")}>{text}</span>;
  }

  if (column.type === "checkbox") {
    return (
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cn("h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
          value ? "bg-primary border-primary text-primary-foreground" : "hover:border-foreground/40",
          compact && "ml-2")}
        aria-pressed={!!value}
      >
        {value ? <Check className="h-3 w-3" /> : null}
      </button>
    );
  }

  if (column.type === "date") {
    /* 이슈에서 쓰는 달력을 그대로 쓴다 — 브라우저 기본 날짜 입력과 생김새·동작이 달라
       한 제품 안에 두 가지 달력이 섞이면 어색하다 */
    return (
      <div className={cn("min-w-0", compact ? "px-1" : "flex-1")}>
        <DatePicker
          value={typeof value === "string" ? value : null}
          onChange={(v) => onChange(v)}
          className={compact ? "text-xs" : "text-xs border border-border rounded-md bg-input/60 hover:bg-primary/10"}
        />
      </div>
    );
  }

  if (column.type === "number") {
    return (
      <input
        type="number"
        /* 브라우저 기본 스피너(위아래 화살표)는 감춘다 — 표 안에서 무슨 버튼인지 알 수 없다 */
        onWheel={(e) => (e.target as HTMLInputElement).blur()}
        defaultValue={typeof value === "number" || typeof value === "string" ? String(value) : ""}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          onChange(raw === "" ? null : Number(raw));
        }}
        className={cn(base, "db-number")}
      />
    );
  }

  if (column.type === "select" || column.type === "multi_select") {
    return <SelectInput column={column} value={value} onChange={onChange} compact={compact} />;
  }

  return (
    <input
      defaultValue={typeof value === "string" ? value : formatDbValue(column, value)}
      onBlur={(e) => onChange(e.target.value.trim() || null)}
      className={base}
    />
  );
}

function SelectInput({ column, value, onChange, compact }: {
  column: DbColumn; value: DbValue; onChange: (v: DbValue) => void; compact?: boolean;
}) {
  const { t } = useTranslation();
  const multi = column.type === "multi_select";
  const chosen: string[] = multi
    ? (Array.isArray(value) ? value : value ? [String(value)] : [])
    : (value ? [String(value)] : []);
  const options = column.options ?? [];

  const toggle = (opt: string) => {
    if (!multi) {
      onChange(chosen[0] === opt ? null : opt);
      return;
    }
    onChange(chosen.includes(opt) ? chosen.filter((c) => c !== opt) : [...chosen, opt]);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn("flex items-center gap-1 text-xs text-left min-w-0 hover:bg-accent/50 rounded transition-colors",
            compact ? "w-full px-2 py-1" : "flex-1 px-1 py-0.5")}
        >
          <span className={cn("truncate flex-1", chosen.length === 0 && "text-muted-foreground")}>
            {chosen.length ? chosen.join(", ") : t("documents.db.choose")}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
        {options.length === 0 ? (
          <div className="px-2 py-1.5 text-2xs text-muted-foreground">
            {t("documents.db.noOptions")}
          </div>
        ) : options.map((opt) => (
          <DropdownMenuItem
            key={opt}
            className="text-xs"
            onSelect={(e) => { e.preventDefault(); toggle(opt); }}
          >
            <span className={cn("flex-1", chosen.includes(opt) && "font-semibold")}>{opt}</span>
            {chosen.includes(opt) && <Check className="h-3 w-3 ml-2" />}
          </DropdownMenuItem>
        ))}
        {chosen.length > 0 && (
          <DropdownMenuItem className="text-xs text-muted-foreground" onSelect={() => onChange(null)}>
            <X className="h-3 w-3 mr-1.5" /> {t("documents.db.clear")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 제어되지 않는 입력의 초기값을 값 변경 때 되살리기 위한 키 — 부모가 key 로 쓴다 */
export function useDbInputKey(value: DbValue): string {
  const [mounted] = useState(() => Math.random().toString(36).slice(2));
  return `${mounted}:${JSON.stringify(value ?? null)}`;
}
