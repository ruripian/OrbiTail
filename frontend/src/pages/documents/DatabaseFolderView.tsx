/**
 * 폴더 표 뷰 — 폴더가 곧 데이터베이스.
 *
 * 새 개념(별도의 "데이터베이스" 객체)을 만들지 않았다. 이미 폴더로 문서를 묶어 쓰고 있고,
 * 거기에 칸을 붙이면 그대로 표가 된다. 개념을 하나 더 만들면 "표를 만들려면 이슈를 쓰나
 * 문서를 쓰나" 하는 혼란이 생긴다 — 폴더의 속성으로 두면 그 질문 자체가 안 생긴다.
 *
 * 값은 각 문서의 properties 에 칸 이름을 key 로 들어간다. 그래서 `.md` 로 내보내면
 * YAML 머리말이 되고, Obsidian 볼트를 가져오면 그 머리말이 그대로 칸 값이 된다.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, Table2, ArrowUpDown, ArrowUp, ArrowDown, Trash2, X, FileText, Filter,
  ChevronDown, Pencil, Type, ListChecks,
} from "lucide-react";
import { documentsApi } from "@/api/documents";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { apiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { DbValueInput, formatDbValue, dbSortKey, type DbValue } from "@/components/documents/DbValueInput";
import { IssuePickerDialog } from "@/components/documents/IssuePickerDialog";
import { DocumentPickerDialog } from "@/components/documents/DocumentPickerDialog";
import { useIssueDialogStore } from "@/stores/issueDialogStore";
import type { Document as DocType, DbColumn, DbColumnType } from "@/types";

const TYPE_LABELS: Record<DbColumnType, string> = {
  text: "documents.db.typeText", number: "documents.db.typeNumber", date: "documents.db.typeDate",
  select: "documents.db.typeSelect", multi_select: "documents.db.typeMultiSelect", checkbox: "documents.db.typeCheckbox",
  issue: "documents.db.typeIssue", doc: "documents.db.typeDoc",
  created: "documents.db.typeCreated", updated: "documents.db.typeUpdated",
};

/** 문서 자체에서 나오는 칸 — 사람이 채우지 않고, 셀도 읽기 전용이다 */
function derivedValue(column: DbColumn, row: DocType): DbValue {
  if (column.type === "created") return row.created_at ?? null;
  if (column.type === "updated") return row.updated_at ?? null;
  return null;
}
const isDerived = (c: DbColumn) => c.type === "created" || c.type === "updated";

interface Props {
  folder: DocType;
  workspaceSlug: string;
  spaceId: string;
  editable: boolean;
  /** project 스페이스면 이슈 고르기를 그 프로젝트로 제한한다 */
  projectId?: string | null;
  onUpdateFolder: (data: Partial<DocType>) => void;
  onInvalidate: () => void;
}

export function DatabaseFolderView({
  folder, workspaceSlug, spaceId, editable, projectId = null, onUpdateFolder, onInvalidate,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const columns = folder.db_columns ?? [];

  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState(false);
  /* 칸 이름 → 그 칸에서 고른 값들. 비어 있으면 거르지 않는다. */
  const [filters, setFilters] = useState<Record<string, string[]>>({});

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["documents", workspaceSlug, spaceId, "children", folder.id],
    queryFn: () => documentsApi.list(workspaceSlug, spaceId, { parent: folder.id }),
  });

  const saveRow = useMutation({
    mutationFn: ({ id, properties }: { id: string; properties: Record<string, DbValue> }) =>
      documentsApi.update(workspaceSlug, spaceId, id, { properties }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents", workspaceSlug, spaceId, "children", folder.id] }),
    onError: (e) => toast.error(apiErrorMessage(e, t("documents.cover.saveFailed"))),
  });

  const addRow = useMutation({
    mutationFn: () => documentsApi.create(workspaceSlug, spaceId, {
      title: t("documents.untitled"), parent: folder.id, is_folder: false,
    }),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["documents", workspaceSlug, spaceId, "children", folder.id] });
      onInvalidate();
      navigate(`/${workspaceSlug}/documents/space/${spaceId}/${doc.id}`);
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("documents.docPicker.createFailed"))),
  });

  const visible = useMemo(() => {
    let list = rows.filter((r) => !r.is_folder);
    for (const [name, chosen] of Object.entries(filters)) {
      if (!chosen.length) continue;
      const col = columns.find((c) => c.name === name);
      if (!col) continue;
      list = list.filter((r) => {
        const v = (r.properties ?? {})[name] as DbValue;
        const asList = Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)];
        return chosen.some((c) => asList.includes(c));
      });
    }
    if (sortBy) {
      const col = columns.find((c) => c.name === sortBy);
      if (col) {
        const valueOf = (d: DocType) =>
          isDerived(col) ? derivedValue(col, d) : ((d.properties ?? {})[sortBy] as DbValue);
        list = [...list].sort((a, b) => {
          const ka = dbSortKey(col, valueOf(a));
          const kb = dbSortKey(col, valueOf(b));
          const r = typeof ka === "number" && typeof kb === "number"
            ? ka - kb : String(ka).localeCompare(String(kb));
          return sortDesc ? -r : r;
        });
      }
    }
    return list;
  }, [rows, columns, filters, sortBy, sortDesc]);

  const toggleSort = (name: string) => {
    if (sortBy !== name) { setSortBy(name); setSortDesc(false); return; }
    if (!sortDesc) { setSortDesc(true); return; }
    setSortBy(null); setSortDesc(false);   // 세 번 누르면 정렬 해제
  };

  /* 가리키는 칸을 고르는 중 — 어느 행의 어느 칸인지 들고 있다가 피커가 닫히면 그 자리에 넣는다 */
  const [picking, setPicking] = useState<{ rowId: string; column: DbColumn } | null>(null);
  const openIssueDialog = useIssueDialogStore((s) => s.openIssue);

  const setCell = (rowId: string, name: string, v: DbValue) => {
    const row = rows.find((r) => r.id === rowId);
    saveRow.mutate({ id: rowId, properties: { ...((row?.properties ?? {}) as Record<string, DbValue>), [name]: v } });
  };

  const activeFilters = Object.values(filters).filter((v) => v.length).length;

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-none px-6 py-8">
        <div className="flex items-end justify-between gap-4 mb-5 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1.5">
              <Table2 className="h-3.5 w-3.5" /> {t("documents.db.table")}
            </p>
            <h1 className="text-2xl font-bold truncate">{folder.title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("workspaceSettings.usage.docCount", { count: visible.length })}
              {visible.length !== rows.filter((r) => !r.is_folder).length &&
                ` / ${rows.filter((r) => !r.is_folder).length}`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setFilters({})}>
                <X className="h-3.5 w-3.5" /> {t("documents.db.clearFilters", { count: activeFilters })}
              </Button>
            )}
            {editable && (
              <Button size="sm" className="h-8 gap-1.5" onClick={() => addRow.mutate()}>
                <Plus className="h-3.5 w-3.5" /> {t("documents.db.newDoc")}
              </Button>
            )}
          </div>
        </div>

        {columns.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
            <p className="text-sm text-muted-foreground">{t("documents.db.setupTitle")}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("documents.db.setupHint")}
            </p>
            {editable && (
              <div className="flex items-center justify-center pt-1">
                <AddColumnButton existing={[]} onAdd={(col) => onUpdateFolder({ db_columns: [col] })} label={t("documents.db.createColumn")} />
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-x-auto bg-card">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border bg-background sticky top-0 z-10">
                  <th className="text-left font-medium text-xs text-muted-foreground px-4 py-2.5 min-w-[280px]">{t("documents.templates.name")}</th>
                  {columns.map((col, i) => (
                    <th key={col.name} className="text-left font-medium text-xs text-muted-foreground px-1 py-2.5 min-w-[145px]">
                      <ColumnHeader
                        column={col}
                        sorted={sortBy === col.name ? (sortDesc ? "desc" : "asc") : null}
                        filtered={(filters[col.name] ?? []).length > 0}
                        editable={editable}
                        onSort={() => toggleSort(col.name)}
                        onFilterChange={(vals) => setFilters((p) => ({ ...p, [col.name]: vals }))}
                        chosenFilters={filters[col.name] ?? []}
                        onChangeColumn={(next) => {
                          const cols = [...columns];
                          if (next === null) cols.splice(i, 1);
                          else cols[i] = next;
                          onUpdateFolder({ db_columns: cols });
                          /* 이름이 바뀌면 옛 이름으로 걸어 둔 정렬·필터가 허공을 가리킨다 */
                          if (next === null || next.name !== col.name) {
                            if (sortBy === col.name) setSortBy(null);
                            setFilters((p) => { const q = { ...p }; delete q[col.name]; return q; });
                          }
                        }}
                      />
                    </th>
                  ))}
                  {editable && (
                    <th className="px-1 py-1.5 w-10">
                      <AddColumnButton
                        existing={columns.map((c) => c.name)}
                        onAdd={(col) => onUpdateFolder({ db_columns: [...columns, col] })}
                      />
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={columns.length + 1} className="px-3 py-6 text-center text-xs text-muted-foreground">{t("common.loading")}</td></tr>
                ) : visible.length === 0 ? (
                  <tr><td colSpan={columns.length + 1} className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {rows.length ? t("documents.db.noMatch") : t("documents.db.noDocs")}
                  </td></tr>
                ) : visible.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors duration-fast group">
                    <td className="px-4 py-2">
                      <button
                        className="flex items-center gap-2 text-left min-w-0 w-full group-hover:text-primary transition-colors"
                        onClick={() => navigate(`/${workspaceSlug}/documents/space/${spaceId}/${row.id}`)}
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                        <span className="truncate">{row.title}</span>
                      </button>
                    </td>
                    {columns.map((col) => (
                      <td key={col.name} className="px-1 py-0.5 align-middle">
                        <DbValueInput
                          /* key 에 값을 넣어, 다른 곳에서 값이 바뀌면 입력이 새 값으로 다시 그려지게 한다 */
                          key={`${row.id}:${col.name}:${JSON.stringify((row.properties ?? {})[col.name] ?? null)}`}
                          column={col}
                          value={isDerived(col) ? derivedValue(col, row) : ((row.properties ?? {})[col.name] as DbValue)}
                          editable={editable && !isDerived(col)}
                          compact
                          onChange={(v) => setCell(row.id, col.name, v)}
                          onPickRef={() => setPicking({ rowId: row.id, column: col })}
                          onOpenRef={(c, ref) => {
                            if (c.type === "doc") navigate(`/${workspaceSlug}/documents/space/${spaceId}/${ref.id}`);
                            else if (projectId) openIssueDialog(workspaceSlug, projectId, ref.id);
                            else navigate(`/${workspaceSlug}/my/issues?issue=${ref.id}`);
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 가리키는 칸 고르기 — 이미 있는 이슈·문서 선택 화면을 그대로 쓴다 */}
      <IssuePickerDialog
        open={!!picking && picking.column.type === "issue"}
        onOpenChange={(o) => { if (!o) setPicking(null); }}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        onSelect={(issue) => {
          if (!picking) return;
          setCell(picking.rowId, picking.column.name, {
            id: issue.id,
            label: issue.project_identifier ? `${issue.project_identifier}-${issue.sequence_id}` : issue.title,
          });
          setPicking(null);
        }}
      />
      <DocumentPickerDialog
        open={!!picking && picking.column.type === "doc"}
        onOpenChange={(o) => { if (!o) setPicking(null); }}
        workspaceSlug={workspaceSlug}
        defaultSpaceId={spaceId}
        onSelect={(d) => {
          if (!picking) return;
          setCell(picking.rowId, picking.column.name, { id: d.id, label: d.title });
          setPicking(null);
        }}
      />
    </div>
  );
}

/**
 * 칸 머리글 — 정렬·필터·이름·종류·삭제를 이 한 자리에서.
 *
 * 전에는 표 위에 "칸 설정" 패널을 따로 열었는데, 칸 하나 고치자고 패널을 여닫는 게 번거로웠다.
 * 스프레드시트를 쓰듯 머리글에서 바로 다루게 한다.
 */
function ColumnHeader({
  column, sorted, filtered, editable, chosenFilters, onSort, onFilterChange, onChangeColumn,
}: {
  column: DbColumn;
  sorted: "asc" | "desc" | null;
  filtered: boolean;
  editable: boolean;
  chosenFilters: string[];
  onSort: () => void;
  onFilterChange: (v: string[]) => void;
  /** null 을 주면 칸을 지운다 */
  onChangeColumn: (next: DbColumn | null) => void;
}) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(column.name);
  const [editingOptions, setEditingOptions] = useState(false);
  const selectLike = column.type === "select" || column.type === "multi_select";

  if (renaming) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const name = draft.trim();
          setRenaming(false);
          if (name && name !== column.name) onChangeColumn({ ...column, name });
          else setDraft(column.name);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setDraft(column.name); setRenaming(false); }
        }}
        className="w-full text-xs bg-transparent border-b border-primary outline-none px-1 py-0.5"
      />
    );
  }

  return (
    <div className="min-w-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1 w-full px-2 py-0.5 rounded hover:bg-accent transition-colors min-w-0">
            <span className="truncate flex-1 text-left">{column.name}</span>
            {sorted === "asc" && <ArrowUp className="h-3 w-3 shrink-0" />}
            {sorted === "desc" && <ArrowDown className="h-3 w-3 shrink-0" />}
            {filtered && <Filter className="h-3 w-3 shrink-0 text-primary" />}
            {!sorted && !filtered && <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem className="text-xs" onSelect={onSort}>
            <ArrowUpDown className="h-3.5 w-3.5 mr-2" />
            {sorted === "asc" ? t("documents.db.sortDesc") : sorted === "desc" ? t("documents.db.sortClear") : t("documents.db.sortAsc")}
          </DropdownMenuItem>
          {selectLike && (column.options?.length ?? 0) > 0 && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1 text-2xs text-muted-foreground">{t("documents.db.filter")}</div>
              {(column.options ?? []).map((opt) => (
                <DropdownMenuItem key={opt} className="text-xs"
                  onSelect={(e) => {
                    e.preventDefault();
                    onFilterChange(chosenFilters.includes(opt)
                      ? chosenFilters.filter((c) => c !== opt) : [...chosenFilters, opt]);
                  }}>
                  <span className={cn("flex-1", chosenFilters.includes(opt) && "font-semibold")}>{opt}</span>
                </DropdownMenuItem>
              ))}
              {chosenFilters.length > 0 && (
                <DropdownMenuItem className="text-xs text-muted-foreground" onSelect={() => onFilterChange([])}>
                  {t("documents.db.showAll")}
                </DropdownMenuItem>
              )}
            </>
          )}
          {editable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-xs" onSelect={() => setTimeout(() => setRenaming(true), 0)}>
                <Pencil className="h-3.5 w-3.5 mr-2" /> {t("documents.db.rename")}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="text-xs">
                  <Type className="h-3.5 w-3.5 mr-2" /> {t("admin.content.filterKind")} · {t(TYPE_LABELS[column.type])}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {(Object.keys(TYPE_LABELS) as DbColumnType[]).map((t) => (
                    <DropdownMenuItem key={t} className="text-xs"
                      onSelect={() => onChangeColumn({
                        ...column, type: t,
                        ...(t === "select" || t === "multi_select" ? { options: column.options ?? [] } : {}),
                      })}>
                      <span className={cn("flex-1", t === column.type && "font-semibold")}>{TYPE_LABELS[t]}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {selectLike && (
                <DropdownMenuItem className="text-xs" onSelect={(e) => { e.preventDefault(); setEditingOptions((v) => !v); }}>
                  <ListChecks className="h-3.5 w-3.5 mr-2" /> {t("documents.db.editOptions")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-xs text-destructive focus:text-destructive"
                onSelect={() => onChangeColumn(null)}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" /> {t("documents.db.deleteColumn")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {editingOptions && selectLike && (
        <div className="mt-1 px-2 pb-1">
          <OptionEditor
            options={column.options ?? []}
            onChange={(opts) => onChangeColumn({ ...column, options: opts })}
          />
        </div>
      )}
    </div>
  );
}

/** 표 오른쪽 끝의 `+` — 이름과 종류만 받고 바로 만든다 */
function AddColumnButton({ existing, onAdd, label }: {
  existing: string[]; onAdd: (col: DbColumn) => void; label?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<DbColumnType>("text");

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    // 이름이 곧 값의 key 라 중복되면 한 칸이 다른 칸의 값을 덮는다
    if (existing.some((e) => e.toLowerCase() === n.toLowerCase())) {
      toast.error(t("documents.db.duplicateColumn"));
      return;
    }
    onAdd({ name: n, type, ...(type === "select" || type === "multi_select" ? { options: [] } : {}) });
    setName(""); setType("text"); setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {label ? (
          <Button size="sm" variant="outline" className="h-8 gap-1.5">
            <Plus className="h-3.5 w-3.5" /> {label}
          </Button>
        ) : (
          <button className="p-1 rounded hover:bg-accent text-muted-foreground" title={t("documents.db.addColumn")}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 p-2 space-y-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); e.stopPropagation(); }}
          placeholder={t("documents.db.columnName")}
          className="w-full text-xs bg-transparent border rounded-md px-2 py-1.5 outline-none focus:border-primary"
        />
        <div className="flex flex-wrap gap-1">
          {(Object.keys(TYPE_LABELS) as DbColumnType[]).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={cn("text-2xs rounded px-1.5 py-1 border transition-colors",
                t === type ? "border-primary bg-primary/10 text-foreground" : "border-transparent bg-muted hover:bg-accent")}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <Button size="sm" className="w-full h-7 text-xs" onClick={submit}>{t("documents.blocks.add")}</Button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OptionEditor({ options, onChange }: { options: string[]; onChange: (v: string[]) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1">
      {options.map((opt) => (
        <span key={opt} className="inline-flex items-center gap-1 text-2xs bg-muted rounded px-1.5 py-0.5">
          {opt}
          <button className="opacity-50 hover:opacity-100" onClick={() => onChange(options.filter((o) => o !== opt))}>
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const v = draft.trim();
          if (v && !options.includes(v)) onChange([...options, v]);
          setDraft("");
        }}
        placeholder={t("documents.db.addOption")}
        className="text-2xs bg-transparent outline-none w-28 border-b border-transparent focus:border-primary"
      />
    </div>
  );
}

export { formatDbValue };
