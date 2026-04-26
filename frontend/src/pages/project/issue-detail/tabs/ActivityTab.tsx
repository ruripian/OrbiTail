import { useTranslation } from "react-i18next";
import { formatLongDate } from "@/utils/date-format";
import type { IssueActivity } from "@/types";

/** PASS5-D — Activity tab (read-only feed). 자체 mutation 없음. */
interface Props {
  activities: IssueActivity[];
}

export function ActivityTab({ activities }: Props) {
  const { t } = useTranslation();

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
                ? ` ${t("issues.detail.activity.changed")} ${t("issues.detail.activity.from")} "${act.old_value}" `
                : ` ${t("issues.detail.activity.changed")} `}
              {act.new_value
                ? `${t("issues.detail.activity.to")} "${act.new_value}"`
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
