import { useEffect, useReducer } from "react";
import { useTranslation } from "react-i18next";
import { FlaskConical } from "lucide-react";

import { useDemoStore } from "@/stores/demoStore";

/** 남은 시간을 시/분 단위 문자열로. 만료됐으면 null. */
function remaining(expiresAt: string | null): { hours: number; minutes: number } | null {
  if (!expiresAt) return null;
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(diffMs) || diffMs <= 0) return null;
  return {
    hours: Math.floor(diffMs / 3_600_000),
    minutes: Math.floor((diffMs % 3_600_000) / 60_000),
  };
}

/** 데모 세션임을 알리는 고정 배지.
 *
 *  레이아웃을 밀지 않도록 화면 우하단에 떠 있게 둔다. 상단 배너로 만들면
 *  사이드바·타임라인의 높이 계산이 전부 어긋난다. */
export function DemoBadge() {
  const { t } = useTranslation();
  const isDemo = useDemoStore((s) => s.isDemo);
  const expiresAt = useDemoStore((s) => s.expiresAt);
  /* 남은 시간은 상태로 들고 있지 않고 렌더할 때마다 계산한다.
     effect 안에서 setState 를 부르면 불필요한 연쇄 렌더가 생긴다.
     여기서는 1분마다 다시 그리기만 하면 되므로 tick 만 올린다. */
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!isDemo) return;
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [isDemo]);

  if (!isDemo) return null;

  const left = remaining(expiresAt);

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border bg-background/90 px-3.5 py-2 text-xs shadow-sm backdrop-blur"
      role="status"
    >
      <FlaskConical className="h-3.5 w-3.5 text-primary" />
      <span className="font-medium text-foreground">{t("demo.badgeLabel")}</span>
      {left && (
        <span className="text-muted-foreground">
          {t("demo.badgeRemaining", { hours: left.hours, minutes: left.minutes })}
        </span>
      )}
    </div>
  );
}
