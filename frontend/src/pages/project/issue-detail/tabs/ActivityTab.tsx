import { useTranslation } from "react-i18next";
import { formatLongDate } from "@/utils/date-format";
import type { IssueActivity, State } from "@/types";

/** PASS5-D — Activity tab (read-only feed). 자체 mutation 없음. */
interface Props {
  activities: IssueActivity[];
  /** 과거 로그에 UUID로 저장된 state 값을 이름으로 폴백 변환하기 위한 상태 목록 */
  states?: State[];
}

/* UUID 형태(과거 state 로그)면 states에서 이름으로 치환. 이미 이름이면 그대로. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ActivityTab({ activities, states = [] }: Props) {
  const { t } = useTranslation();
  const resolve = (val: string | null | undefined) => {
    if (!val || !UUID_RE.test(val)) return val;
    return states.find((s) => s.id === val)?.name ?? val;
  };

  return (
    <div className="space-y-3">
      {activities.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">{t("issues.detail.activity.empty")}</p>
      )}
      {activities.map((act) => (
        <div key={act.id} className="flex gap-2 items-start text-xs">
          <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-2xs font-semibold shrink-0 mt-0.5">
            {act.actor_detail?.display_name?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="flex-1 leading-relaxed">
            <span className="font-medium">{act.actor_detail?.display_name}</span>
            {" "}
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground/70">{act.field}</span>
              {act.old_value
                ? ` ${t("issues.detail.activity.changed")} ${t("issues.detail.activity.from")} "${resolve(act.old_value)}" `
                : ` ${t("issues.detail.activity.changed")} `}
              {act.new_value
                ? `${t("issues.detail.activity.to")} "${resolve(act.new_value)}"`
                : `(${t("issues.detail.activity.deleted")})`}
            </span>
            <span className="text-muted-foreground/60 ml-1">
              · {formatLongDate(act.created_at)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
