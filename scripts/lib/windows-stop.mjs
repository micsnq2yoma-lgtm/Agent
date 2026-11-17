import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function processTree(rows, root) {
  const found = [];
  const pending = [root];
  const seen = new Set();
  while (pending.length) {
    const pid = pending.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const row = rows.find((p) => p.ProcessId === pid);
    if (row) found.push(row);
    pending.push(...rows.filter((p) => p.ParentProcessId === pid).map((p) => p.ProcessId));
  }
  return found;
}

/** Validate a live postmaster's PID and data directory before invoking its own pg_ctl. */
export function postgresCluster(row, read = (p) => fs.readFileSync(p, "utf8"), exists = fs.existsSync) {
  if (row.Name?.toLowerCase() !== "postgres.exe") return null;
  const dir = row.CommandLine?.match(/(?:^|\s)-D\s+(?:"([^"]+)"|(\S+))/)?.slice(1).find(Boolean);
  if (!dir || !row.ExecutablePath) return null;
  const pgCtl = path.join(path.dirname(row.ExecutablePath), "pg_ctl.exe");
  if (!exists(pgCtl)) throw new Error("找不到嵌入式 PostgreSQL 的 pg_ctl，已停止操作以保护数据库。");
  const lines = read(path.join(dir, "postmaster.pid")).trim().split(/\r?\n/);
  if (Number(lines[0]) !== row.ProcessId || path.resolve(lines[1] ?? "").toLowerCase() !== path.resolve(dir).toLowerCase()) {
    throw new Error("PostgreSQL 进程与数据目录身份不一致，已停止操作以保护数据库。");
  }
  return { pid: row.ProcessId, dir, pgCtl };
}

/** Never taskkill /T a tree containing PostgreSQL: Windows can leave shared-memory owners behind. */
export function stopWindowsTree(pid, { run = spawnSync, rows, cluster = postgresCluster, log = () => {} } = {}) {
  if (!rows) {
    const result = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress"],
    { encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) throw new Error("无法读取 Windows 进程树；未强制停止服务，请检查权限后重试。");
    const parsed = JSON.parse(result.stdout || "[]");
    rows = Array.isArray(parsed) ? parsed : [parsed];
  }
  const tree = processTree(rows, pid);
  if (!tree.length) return false;
  const postgres = tree.filter((p) => p.Name?.toLowerCase() === "postgres.exe");
  const clusters = postgres.map((p) => cluster(p)).filter(Boolean);
  const protectedPids = new Set(clusters.flatMap((p) => processTree(rows, p.pid).map((r) => r.ProcessId)));
  if (postgres.some((p) => !protectedPids.has(p.ProcessId))) {
    throw new Error("发现无法确认所属数据目录的 PostgreSQL 子进程；未强杀数据库。请先正常关闭该实例后重试。");
  }
  // The caller sets the shared stop marker first: neither supervisor may restart the DB.
  // PostgreSQL must exit BEFORE its Windows console owner, which can terminate it abruptly.
  for (const db of clusters) {
    const result = run(db.pgCtl, ["stop", "-D", db.dir, "-m", "fast", "-w", "-t", "30"],
      { encoding: "utf8", windowsHide: true, shell: false, timeout: 35_000 });
    if (result.status !== 0) throw new Error("嵌入式 PostgreSQL 未正常停止，已中止更新；请检查数据库日志，不要删除数据库文件。");
    log(`stopped embedded PostgreSQL ${db.pid} cleanly`);
  }
  for (const row of tree) {
    if (protectedPids.has(row.ProcessId)) continue;
    const result = run("taskkill", ["/PID", String(row.ProcessId), "/F"], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) {
      // A process may exit together with its parent; only fail if it is still alive.
      try { process.kill(row.ProcessId, 0); } catch { continue; }
      throw new Error(`无法停止进程 ${row.ProcessId}，未继续关闭数据库。`);
    }
  }
  return true;
}
