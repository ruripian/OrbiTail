/**
 * 팀 목록 페이지 — /<ws>/teams.
 *
 * 본인이 멤버인 팀만 나열. + 새 팀 만들기.
 * 탐색(비멤버 팀 노출) 은 현재 정책상 미지원.
 */
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Users, ArrowRight } from "lucide-react";
import { teamsApi } from "@/api/teams";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function TeamListPage() {
  const { workspaceSlug = "" } = useParams<{ workspaceSlug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: teams = [], isLoading } = useQuery({
    queryKey: ["teams", workspaceSlug],
    queryFn: () => teamsApi.list(workspaceSlug),
    enabled: !!workspaceSlug,
  });

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-[920px] mx-auto px-6 py-10">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">팀</h1>
          <Button onClick={() => setCreateOpen(true)} className="gap-2 shrink-0">
            <Plus className="h-4 w-4" />
            새 팀 만들기
          </Button>
        </header>

        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-12">로딩 중...</p>
        ) : teams.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card/50 px-6 py-16 text-center">
            <Users className="h-8 w-8 mx-auto mb-3 text-muted-foreground/60" />
            <p className="text-sm font-medium mb-1">아직 소속된 팀이 없습니다</p>
            <p className="text-xs text-muted-foreground mb-4">
              팀을 만들어 멤버들의 일정을 한 화면에서 확인해보세요.
            </p>
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              새 팀 만들기
            </Button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {teams.map((team) => (
              <li key={team.id}>
                <button
                  onClick={() => navigate(`/${workspaceSlug}/teams/${team.id}`)}
                  className="group w-full text-left rounded-xl border bg-card hover:bg-accent/40 hover:border-primary/40 transition-colors p-4"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "h-10 w-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0",
                        "bg-primary/10 text-primary",
                      )}
                      style={team.color ? { backgroundColor: `${team.color}22`, color: team.color } : undefined}
                    >
                      {team.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <h3 className="text-sm font-semibold truncate">{team.name}</h3>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </div>
                      {team.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{team.description}</p>
                      )}
                      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                        <Users className="h-3 w-3" />
                        <span>{team.member_count}명</span>
                        {team.my_role === 20 && (
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-2xs font-semibold">관리자</span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CreateTeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (team) => {
          qc.invalidateQueries({ queryKey: ["teams", workspaceSlug] });
          setCreateOpen(false);
          navigate(`/${workspaceSlug}/teams/${team.id}`);
        }}
      />
    </div>
  );
}

/* ────────────── 새 팀 만들기 다이얼로그 ────────────── */
function CreateTeamDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (team: { id: string }) => void | Promise<void>;
}) {
  const { workspaceSlug = "" } = useParams<{ workspaceSlug: string }>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("");

  const createMutation = useMutation({
    mutationFn: () => teamsApi.create(workspaceSlug, { name: name.trim(), description, color }),
    onSuccess: (team) => {
      setName(""); setDescription(""); setColor("");
      onCreated(team);
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.detail ?? "팀 생성에 실패했습니다.";
      toast.error(msg);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>새 팀 만들기</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) createMutation.mutate(); }}
          className="space-y-3"
        >
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">팀 이름 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 디자인팀"
              maxLength={100}
              required
              autoFocus
              className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">설명 (선택)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="팀의 목적이나 책임 범위"
              rows={2}
              className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60 resize-y"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">팀 색 (선택)</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color || "#888888"}
                onChange={(e) => setColor(e.target.value)}
                className="h-8 w-12 rounded border cursor-pointer"
              />
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#hex 또는 비워두기"
                className="flex-1 text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:border-primary/60"
              />
              {color && (
                <button type="button" onClick={() => setColor("")} className="text-2xs text-muted-foreground hover:text-foreground">
                  지우기
                </button>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
            <Button type="submit" disabled={!name.trim() || createMutation.isPending}>
              {createMutation.isPending ? "생성 중..." : "팀 만들기"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
