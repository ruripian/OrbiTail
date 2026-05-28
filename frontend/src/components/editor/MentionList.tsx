/**
 * 댓글 @멘션 자동완성 dropdown.
 *
 * TipTap Mention extension 의 suggestion render API 에서 사용.
 * - props.items 에 필터된 후보 리스트 주입
 * - 키보드: ↑/↓ 이동, Enter 선택, Esc 닫기(상위에서 처리)
 * - 마우스: 항목 클릭 시 즉시 선택
 *
 * 백엔드 알림 매칭은 댓글 평문에서 @display_name 정규식으로 이뤄지므로
 * 멘션 노드의 라벨은 display_name 그대로 사용.
 */
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { cn } from "@/lib/utils";

export interface MentionItem {
  /** 멤버(User) id — 멘션 노드 data-id 로 저장 */
  id: string;
  /** 표시명. @{display_name} 으로 평문 렌더되어 백엔드 regex 매칭. */
  display_name: string;
  avatar?: string | null;
}

interface Props {
  items: MentionItem[];
  command: (item: { id: string; label: string }) => void;
}

/** 부모(RichTextEditor 의 mention render hook)가 키 이벤트를 위임할 수 있도록 imperative handle 노출 */
export interface MentionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const MentionList = forwardRef<MentionListHandle, Props>(({ items, command }, ref) => {
  const [selected, setSelected] = useState(0);

  /* 결과가 바뀌면 첫 항목으로 리셋 — query 가 좁혀질 때 selection 이 out-of-range 되는 것 방지 */
  useEffect(() => { setSelected(0); }, [items]);

  const selectItem = (idx: number) => {
    const item = items[idx];
    if (item) command({ id: item.id, label: item.display_name });
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowUp") {
        setSelected((s) => (s + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelected((s) => (s + 1) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        selectItem(selected);
        return true;
      }
      return false;
    },
  }));

  return (
    <div className="rounded-lg border bg-popover shadow-lg p-1 min-w-[220px] max-h-[260px] overflow-y-auto">
      {items.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">결과 없음</div>
      ) : (
        items.map((item, idx) => (
          <button
            key={item.id}
            type="button"
            onMouseDown={(e) => {
              // mousedown preventDefault — selection blur 방지 (Toolbar 패턴과 동일)
              e.preventDefault();
              selectItem(idx);
            }}
            onMouseEnter={() => setSelected(idx)}
            className={cn(
              "flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors",
              idx === selected ? "bg-primary/10 text-foreground" : "text-foreground/80 hover:bg-muted/40",
            )}
          >
            <AvatarInitials name={item.display_name} avatar={item.avatar} size="xs" />
            <span className="truncate">{item.display_name}</span>
          </button>
        ))
      )}
    </div>
  );
});

MentionList.displayName = "MentionList";
