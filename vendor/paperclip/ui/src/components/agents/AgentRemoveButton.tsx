import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { UserMinus } from "lucide-react";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/lib/queryKeys";
import { mapBulkAgents } from "@/lib/bulk-agent-settings";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";

export function AgentRemoveButton({ companyId, agents, onRemoved }: { companyId: string; agents: Agent[]; onRemoved: (ids: string[]) => void }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [targets, setTargets] = useState<Agent[]>([]);
  async function remove() {
    setBusy(true);
    setError("");
    try {
      const results = await mapBulkAgents(targets, (agent) => agentsApi.terminate(agent.id, companyId));
      const succeeded = targets.filter((_, i) => results[i].status === "fulfilled");
      const failed = targets.filter((_, i) => results[i].status === "rejected");
      const failures = results.flatMap((result, i) => result.status === "rejected" ? [`${targets[i].name}：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`] : []);
      const ids = succeeded.map((agent) => agent.id);
      client.setQueryData<Agent[]>(queryKeys.agents.list(companyId), (current) => current?.map((agent) => ids.includes(agent.id) ? { ...agent, status: "terminated" } : agent));
      onRemoved(ids);
      void client.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
      void client.invalidateQueries({ queryKey: queryKeys.org(companyId) });
      for (const id of ids) void client.invalidateQueries({ queryKey: queryKeys.agents.detail(id) });
      if (failed.length) { setTargets(failed); setError(failures.join("；")); }
      else setOpen(false);
    } finally { setBusy(false); }
  }
  return <>
    <Button size="sm" variant="outline" disabled={!agents.length || busy} aria-label={agents.length === 1 ? `移除 ${agents[0].name}` : "移除所选员工"}
      onClick={() => { setTargets([...agents]); setError(""); setOpen(true); }}>
      <UserMinus className="size-3.5" aria-hidden />移除
    </Button>
    <AlertDialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>移除{targets.length === 1 ? `「${targets[0]?.name}」` : `这 ${targets.length} 名员工`}？</AlertDialogTitle>
          <AlertDialogDescription>员工会被停用并移出在职列表，历史任务和记录保留。正在执行的任务会中止；如果是主管，其下属也可能暂停派活。</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void remove(); }}>{busy ? "正在移除…" : "确认移除"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
