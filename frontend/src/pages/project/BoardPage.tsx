import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { Button } from "@/components/ui/button";
import { IssueCreateDialog } from "@/components/issues/IssueCreateDialog";
import type { Issue, State } from "@/types";

export function BoardPage() {
  const { workspaceSlug, projectId } = useParams<{
    workspaceSlug: string;
    projectId: string;
  }>();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedState, setSelectedState] = useState<State | null>(null);

  const { data: issues = [] } = useQuery({
    queryKey: ["issues", workspaceSlug, projectId],
    queryFn: () => issuesApi.list(workspaceSlug!, projectId!),
    enabled: !!workspaceSlug && !!projectId,
  });

  const { data: states = [] } = useQuery({
    queryKey: ["states", workspaceSlug, projectId],
    queryFn: () => projectsApi.states.list(workspaceSlug!, projectId!),
    enabled: !!workspaceSlug && !!projectId,
  });

  const updateIssue = useMutation({
    mutationFn: ({ issueId, stateId }: { issueId: string; stateId: string }) =>
      issuesApi.update(workspaceSlug!, projectId!, issueId, { state: stateId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["issues", workspaceSlug, projectId] }),
  });

  const taskIssues = issues.filter((i) => !i.is_field);
  const issuesByState = states.reduce<Record<string, Issue[]>>((acc, state) => {
    acc[state.id] = taskIssues.filter((i) => i.state === state.id);
    return acc;
  }, {});

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleDrop = (e: React.DragEvent, stateId: string) => {
    const issueId = e.dataTransfer.getData("issueId");
    if (issueId) updateIssue.mutate({ issueId, stateId });
  };

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold">Board</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Add issue
        </Button>
      </div>

      <div className="flex gap-4 overflow-x-auto flex-1 pb-4">
        {states.map((state) => (
          <div
            key={state.id}
            className="flex flex-col w-72 flex-shrink-0"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, state.id)}
          >
            <div
              className="flex items-center gap-2 mb-3 px-1"
              style={{ borderBottom: `2px solid ${state.color}` }}
            >
              <span className="text-sm font-medium pb-1">{state.name}</span>
              <span className="text-xs text-muted-foreground ml-auto pb-1">
                {issuesByState[state.id]?.length ?? 0}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 pb-1"
                onClick={() => {
                  setSelectedState(state);
                  setCreateOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="space-y-2 flex-1">
              {(issuesByState[state.id] ?? []).map((issue) => (
                <div
                  key={issue.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("issueId", issue.id)}
                  className="rounded-md border glass p-3 text-sm cursor-grab hover:shadow-sm transition-shadow active:cursor-grabbing"
                >
                  <p className="font-medium mb-2 line-clamp-2">{issue.title}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{issue.sequence_id}</span>
                    {issue.assignee_details.length > 0 && (
                      <div className="flex -space-x-1">
                        {issue.assignee_details.slice(0, 2).map((a) => (
                          <div
                            key={a.id}
                            className="h-5 w-5 rounded-full bg-primary/10 text-xs flex items-center justify-center border border-background"
                          >
                            {a.display_name[0].toUpperCase()}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <IssueCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        states={states}
        defaultStateId={selectedState?.id}
        workspaceSlug={workspaceSlug!}
        projectId={projectId!}
      />
    </div>
  );
}
