/**
 * 앱 전환 탭 — Issues / Documents 전환.
 * Sidebar와 DocumentLayout 양쪽에서 공유.
 */

import { Link, useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layers, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

export function AppSwitcher() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const location = useLocation();
  const isDocuments = location.pathname.includes("/documents");

  return (
    <div className="flex items-center h-10 border-b border-border">
      <Link
        to={`/${workspaceSlug}`}
        className={cn(
          "flex-1 flex items-center justify-center gap-1.5 h-full text-xs font-medium transition-colors",
          !isDocuments
            ? "text-primary border-b-2 border-primary"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Layers className="h-3.5 w-3.5" />
        {t("sidebar.issues")}
      </Link>
      <Link
        to={`/${workspaceSlug}/documents`}
        className={cn(
          "flex-1 flex items-center justify-center gap-1.5 h-full text-xs font-medium transition-colors",
          isDocuments
            ? "text-primary border-b-2 border-primary"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <FileText className="h-3.5 w-3.5" />
        {t("sidebar.documents")}
      </Link>
    </div>
  );
}
