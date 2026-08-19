/**
 * 문서 탐색기 — 윈도우/시놀로지 파일 관리자식 조작.
 *
 * 이 파일은 공통 도구(뒤로·라벨 필터·분할 토글)와 패널 배치만 맡는다.
 * 목록·선택·드래그 같은 실제 조작은 ExplorerPanel 이 담당하고, 분할하면 두 번 인스턴스화된다.
 * 트리 규칙(순환 차단·sort_order·폴더 우선 정렬)은 사이드바와 공유한다 — lib/document-tree.
 */

import { useState, useMemo } from "react";
import { useParams, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Columns2, Square } from "lucide-react";
import { documentsApi } from "@/api/documents";
import { DocumentLabelPicker } from "@/components/documents/DocumentLabelPicker";
import { ExplorerPanel } from "@/components/documents/ExplorerPanel";
import { Button } from "@/components/ui/button";
import { buildChildrenMap } from "@/lib/document-tree";

interface LayoutContext {
  /** 스페이스를 고르기 전에는 비어 있다 */
  activeSpaceId?: string;
  invalidate: () => void;
}

export default function DocumentExplorerPage() {
  const { t } = useTranslation();
  const { workspaceSlug, spaceId } = useParams<{ workspaceSlug: string; spaceId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ctx = useOutletContext<LayoutContext | undefined>();

  /* 단일 패널의 위치만 URL 에 싣는다 — 뒤로/앞으로·새로고침·링크 공유가 폴더 단위로 동작한다.
     분할은 임시 작업용이라 두 패널이 URL 하나를 나눠 쓰게 만들지 않는다(패널 독립 유지). */
  const [searchParams, setSearchParams] = useSearchParams();
  const folderParam = searchParams.get("folder");

  const [split, setSplit] = useState(false);
  const [activePanel, setActivePanel] = useState<0 | 1>(0);
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  /* 클립보드는 패널 밖에 둔다 — 한쪽에서 잘라 다른 쪽에 붙여넣는 게 분할의 핵심 용도다 */
  const [clipboard, setClipboard] = useState<string[]>([]);

  const { data: allDocs = [] } = useQuery({
    queryKey: ["documents", workspaceSlug, spaceId, "all"],
    queryFn: () => documentsApi.list(workspaceSlug!, spaceId!, { all: "true" }),
    enabled: !!workspaceSlug && !!spaceId,
  });

  const childrenMap = useMemo(() => buildChildrenMap(allDocs), [allDocs]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["documents", workspaceSlug, spaceId] });
    ctx?.invalidate();
  };

  const panelProps = {
    workspaceSlug: workspaceSlug!,
    spaceId: spaceId!,
    allDocs,
    childrenMap,
    labelFilter,
    clipboard,
    setClipboard,
    onInvalidate: invalidate,
    split,
  };

  /* 분할 중에는 URL 을 건드리지 않는다 — 패널마다 위치가 달라 하나의 파라미터로 표현할 수 없다 */
  const urlBinding = split
    ? {}
    : {
        folderId: folderParam,
        onFolderChange: (id: string | null) =>
          setSearchParams(id ? { folder: id } : {}),
      };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 공통 도구 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0" data-print-hide>
        <Button
          variant="ghost" size="sm" className="h-8 text-xs gap-1.5"
          onClick={() => navigate(`/${workspaceSlug}/documents/space/${spaceId}`)}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("documents.backToEditor")}
        </Button>

        <div className="w-px h-5 bg-border" />

        {/* 라벨 필터 — 걸면 폴더를 벗어나 스페이스 전체에서 찾는다 */}
        <div className="flex items-center gap-1.5 flex-1">
          <DocumentLabelPicker
            workspaceSlug={workspaceSlug!}
            value={labelFilter}
            onChange={setLabelFilter}
            allowCreate={false}
            triggerLabel={labelFilter.length > 0 ? `라벨 ${labelFilter.length}` : "라벨"}
          />
          {labelFilter.length > 0 && (
            <button
              onClick={() => setLabelFilter([])}
              className="text-2xs text-muted-foreground hover:text-destructive"
            >
              해제
            </button>
          )}
        </div>

        {clipboard.length > 0 && (
          <span className="text-2xs text-muted-foreground">잘라낸 항목 {clipboard.length}개</span>
        )}

        {/* 분할 — 두 폴더를 나란히 열어 서로 끌어다 옮긴다 */}
        <Button
          variant={split ? "secondary" : "ghost"}
          size="sm"
          className="h-8 text-xs gap-1.5"
          title={split ? "분할 해제" : "화면 분할"}
          onClick={() => { setSplit((v) => !v); setActivePanel(0); }}
        >
          {split ? <Square className="h-3.5 w-3.5" /> : <Columns2 className="h-3.5 w-3.5" />}
          {split ? "단일" : "분할"}
        </Button>
      </div>

      {/* 패널 */}
      <div className="flex flex-1 min-h-0">
        <ExplorerPanel
          {...panelProps}
          {...urlBinding}
          isActive={!split || activePanel === 0}
          onActivate={() => setActivePanel(0)}
        />
        {split && (
          <>
            <div className="w-px bg-border shrink-0" />
            <ExplorerPanel
              {...panelProps}
              isActive={activePanel === 1}
              onActivate={() => setActivePanel(1)}
            />
          </>
        )}
      </div>
    </div>
  );
}
