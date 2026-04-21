/**
 * 문서 홈 — 스페이스 목록 + 최근 문서
 */

import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileText, FolderOpen, Plus, Loader2, Users, User as UserIcon, Layers } from "lucide-react";
import { toast } from "sonner";
import { documentsApi } from "@/api/documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageTransition } from "@/components/motion";
import type { DocumentSpace } from "@/types";

const SPACE_ICON: Record<string, React.ReactNode> = {
  project: <Layers className="h-5 w-5 text-primary" />,
  personal: <UserIcon className="h-5 w-5 text-amber-500" />,
  shared: <Users className="h-5 w-5 text-blue-500" />,
};

export default function DocumentsHomePage() {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIdentifier, setNewIdentifier] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newMembers, setNewMembers] = useState<string>("");  // 쉼표 구분 이메일

  const { data: spaces = [], isLoading } = useQuery({
    queryKey: ["document-spaces", workspaceSlug],
    queryFn: () => documentsApi.spaces.list(workspaceSlug!),
    enabled: !!workspaceSlug,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const payload: {
        name: string;
        icon: string;
        identifier?: string;
        description?: string;
      } = { name: newName.trim(), icon: "📚" };
      if (newIdentifier.trim()) payload.identifier = newIdentifier.trim().toUpperCase();
      if (newDescription.trim()) payload.description = newDescription.trim();
      return documentsApi.spaces.create(workspaceSlug!, payload);
    },
    onSuccess: (space) => {
      qc.invalidateQueries({ queryKey: ["document-spaces", workspaceSlug] });
      setCreateOpen(false);
      setNewName("");
      setNewIdentifier("");
      setNewDescription("");
      setNewMembers("");
      toast.success(t("documents.spaceCreated"));
      navigate(`/${workspaceSlug}/documents/space/${space.id}`);
    },
  });

  // 스페이스 유형별 그룹
  const projectSpaces = spaces.filter((s) => s.space_type === "project");
  const personalSpaces = spaces.filter((s) => s.space_type === "personal");
  const sharedSpaces = spaces.filter((s) => s.space_type === "shared");

  const SpaceCard = ({ space }: { space: DocumentSpace }) => (
    <button
      onClick={() => navigate(`/${workspaceSlug}/documents/space/${space.id}`)}
      className="flex items-start gap-4 p-5 rounded-xl border bg-card hover:bg-accent/50 transition-all text-left shadow-sm hover:shadow-md group"
    >
      <div className="h-10 w-10 rounded-lg bg-muted/50 flex items-center justify-center text-lg shrink-0">
        {SPACE_ICON[space.space_type]}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm group-hover:text-primary transition-colors truncate">
          {space.name}
        </p>
        {space.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{space.description}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1.5">
          {space.document_count} {t("documents.docCount")}
          {space.project_identifier && (
            <span className="ml-2 text-primary/70">
              {space.project_identifier}
            </span>
          )}
        </p>
      </div>
    </button>
  );

  const SpaceSection = ({ title, items }: { title: string; items: DocumentSpace[] }) => {
    if (items.length === 0) return null;
    return (
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{title}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => <SpaceCard key={s.id} space={s} />)}
        </div>
      </div>
    );
  };

  return (
    <PageTransition className="p-5 sm:p-8 overflow-y-auto h-full">
      <div className="max-w-5xl mx-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <FileText className="h-6 w-6 text-primary" />
              {t("documents.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{t("documents.homeDesc")}</p>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            {t("documents.newSpace")}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : spaces.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-12 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-lg text-muted-foreground">{t("documents.empty")}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("documents.emptyHint")}</p>
          </div>
        ) : (
          <div className="space-y-8">
            <SpaceSection title={t("documents.projectSpaces")} items={projectSpaces} />
            <SpaceSection title={t("documents.sharedSpaces")} items={sharedSpaces} />
            <SpaceSection title={t("documents.personalSpaces")} items={personalSpaces} />
          </div>
        )}
      </div>

      {/* 스페이스 생성 다이얼로그 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("documents.newSpace")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {t("documents.spaceName", "스페이스 이름")}
                <span className="text-rose-500 ml-0.5">*</span>
              </label>
              <Input
                placeholder={t("documents.spaceNamePlaceholder", "예: 기술 문서")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {t("documents.spaceIdentifier", "구분자 (선택)")}
              </label>
              <Input
                placeholder="TECH"
                maxLength={12}
                value={newIdentifier}
                onChange={(e) => setNewIdentifier(e.target.value.toUpperCase())}
              />
              <p className="text-2xs text-muted-foreground/70">
                {t("documents.spaceIdentifierHint", "영문 대문자/숫자, 최대 12자. 문서 URL 및 참조에 사용됩니다.")}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {t("documents.spaceDescription", "설명 (선택)")}
              </label>
              <textarea
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder={t("documents.spaceDescriptionPlaceholder", "이 스페이스의 목적을 간단히 설명하세요")}
                rows={2}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {t("documents.spaceMembers", "참여자 (선택)")}
              </label>
              <Input
                placeholder={t("documents.spaceMembersPlaceholder", "쉼표로 구분된 이메일")}
                value={newMembers}
                onChange={(e) => setNewMembers(e.target.value)}
              />
              <p className="text-2xs text-muted-foreground/70">
                {t("documents.spaceMembersHint", "스페이스 생성 후 멤버 관리에서도 추가할 수 있습니다.")}
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                {t("admin.common.cancel")}
              </Button>
              <Button
                disabled={!newName.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("documents.create")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
