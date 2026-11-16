// 能力与工具 → 工具服务 (scripts/lib/mcp-servers.mjs): install MCP tool servers for employees from a
// curated catalog or by hand, choose who gets them, test them before saving.
import { useEffect, useState } from "react";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { as, type Context } from "../lib/api";
import { useSkin } from "../lib/skin";
import { Skeleton } from "../components/Skeleton";

interface Field {
  key: string;
  label: string;
  kind: "args" | "secret" | "token";
  multiline?: boolean;
}
interface CatalogItem {
  id: string;
  name: string;
  description: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  fields: Field[];
  needs: string;
  docs: string;
}
interface Installed {
  id: string;
  name: string;
  catalogId: string | null;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled: boolean;
  scope: "all" | string[];
  secretKeys: string[];
  hasToken: boolean;
}
interface TestResult {
  ok: boolean;
  tools?: string[];
  error?: string;
  ms?: number;
  stderr?: string;
}

const lines = (s: string) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const kv = (s: string) => Object.fromEntries(lines(s).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]).filter(([k]) => k));

export function ToolServers({ ctx }: { ctx: Context }) {
  const { t } = useSkin();
  const [data, setData] = useState<{ catalog: CatalogItem[]; installed: Installed[] } | null>(null);
  const [editing, setEditing] = useState<{ item: CatalogItem | null; current: Installed | null } | null>(null);
  const load = () => as.get<{ catalog: CatalogItem[]; installed: Installed[] }>("/mcp/catalog").then(setData);
  useEffect(() => void load(), []);
  const employees = ctx.agents.filter((a) => a.metadata?.agentself && !a.metadata.agentself.isLead && a.status !== "terminated");
  const nameOf = (id: string) => employees.find((a) => a.id === id)?.name ?? id;

  if (!data) return <Skeleton lines={4} />;
  const installedIds = new Set(data.installed.map((s) => s.id));
  return (
    <div className="tool-servers">
      <p className="hint">
        工具服务（MCP）给{t("employee")}加新本事：读写指定文件夹、浏览器、GitHub、Notion、Zotero……装在这台电脑上，可以给全部{t("employee")}或只给指定的几位。{t("lead")}只管不干，不装这些。密钥存进 Paperclip 密钥库。
      </p>
      <div className="section">
        <h2>
          <span>已安装</span>
          <span className="grow" />
          <button className="btn sm" onClick={() => setEditing({ item: null, current: null })}>
            <Plus aria-hidden="true" /> 自定义添加
          </button>
        </h2>
        {data.installed.length === 0 && <div className="sub">还没有。从下面挑一个，或者自定义添加。</div>}
        {data.installed.map((s) => (
          <div key={s.id} className="row">
            <div style={{ minWidth: 0 }}>
              <div className="label">{s.name}</div>
              <div className="sub mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.transport === "http" ? s.url : [s.command, ...(s.args ?? [])].join(" ")}
              </div>
              <div className="sub">给：{s.scope === "all" ? `全部${t("employee")}` : s.scope.map(nameOf).join("、") || "（没有人）"}</div>
            </div>
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <button className="btn sm" onClick={() => setEditing({ item: data.catalog.find((c) => c.id === s.catalogId) ?? null, current: s })}>
                修改
              </button>
              <button
                className={`switch ${s.enabled ? "on" : ""}`}
                role="switch"
                aria-checked={s.enabled}
                aria-label={`启用 ${s.name}`}
                onClick={() => void as.put(`/mcp/servers/${s.id}`, { enabled: !s.enabled }).then(load)}
              />
              <button className="icon-btn xs plain" aria-label={`删除 ${s.name}`} onClick={() => confirm(`删除工具服务「${s.name}」？`) && void as.del(`/mcp/servers/${s.id}`).then(load)}>
                <Trash2 />
              </button>
            </span>
          </div>
        ))}
      </div>
      <h2 className="page-subtitle">精选</h2>
      <div className="catalog-grid">
        {data.catalog.map((c) => (
          <button key={c.id} type="button" className="card catalog-card" onClick={() => setEditing({ item: c, current: data.installed.find((s) => s.id === c.id) ?? null })}>
            <span className="card-head">
              <span className="card-kind">{c.transport === "http" ? "在线服务" : "本机运行"}</span>
              {installedIds.has(c.id) && <span className="status-tag good">已安装</span>}
            </span>
            <span className="card-title">{c.name}</span>
            <span className="card-sub">{c.description}</span>
            <span className="card-sub tertiary">需要：{c.needs}</span>
          </button>
        ))}
      </div>
      {editing && <ServerForm item={editing.item} current={editing.current} employees={employees} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), void load())} />}
    </div>
  );
}

function ServerForm({ item, current, employees, onClose, onSaved }: { item: CatalogItem | null; current: Installed | null; employees: Context["agents"]; onClose: () => void; onSaved: () => void }) {
  const { t } = useSkin();
  const fixedArgs = item?.args ?? [];
  const extraArgs = current?.args ? current.args.slice(fixedArgs.length) : [];
  const [f, setF] = useState({
    id: current?.id ?? item?.id ?? "",
    name: current?.name ?? item?.name ?? "",
    transport: (current?.transport ?? item?.transport ?? "stdio") as "stdio" | "http",
    command: current?.command ?? item?.command ?? "",
    args: (item ? extraArgs : (current?.args ?? [])).join("\n"),
    env: Object.entries(current?.env ?? item?.env ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"),
    secretsText: "",
    url: current?.url ?? item?.url ?? "",
    token: "",
  });
  const [secretVals, setSecretVals] = useState<Record<string, string>>({});
  const [scopeAll, setScopeAll] = useState(current ? current.scope === "all" : true);
  const [picked, setPicked] = useState<string[]>(Array.isArray(current?.scope) ? current!.scope : []);
  const [test, setTest] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });

  const secretFields = item?.fields.filter((x) => x.kind === "secret") ?? [];
  const body = () => {
    const secrets = { ...secretVals, ...kv(f.secretsText) };
    return {
      name: f.name || f.id,
      catalogId: item?.id ?? null,
      transport: f.transport,
      command: f.command,
      args: item ? [...fixedArgs, ...lines(f.args)] : lines(f.args),
      env: kv(f.env),
      secrets,
      url: f.url,
      token: f.token,
      scope: scopeAll ? "all" : picked,
    };
  };
  async function runTest() {
    setBusy("test");
    setTest(null);
    try {
      setTest(await as.post<TestResult>("/mcp/test", body()));
    } catch (e) {
      setTest({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }
  async function save() {
    setBusy("save");
    setErr(null);
    try {
      await as.put(`/mcp/servers/${f.id}`, body());
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  const needSecrets = secretFields.some((x) => !current?.secretKeys.includes(x.key) && !secretVals[x.key]);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="工具服务">
        <header>
          <div className="line1">
            <span className="mono">{item ? "精选" : "自定义"} · {f.transport === "http" ? "在线服务" : "本机运行"}</span>
            <span className="grow" />
            {item?.docs && (
              <a href={item.docs} target="_blank" rel="noreferrer" className="sub">
                说明 <ExternalLink size={12} aria-hidden="true" />
              </a>
            )}
          </div>
          <h2>{f.name || "新工具服务"}</h2>
          {item && <div className="sub">{item.description}</div>}
        </header>
        <div className="body">
          {!item && (
            <section>
              <div className="grid2">
                <label className="field">
                  英文 id
                  <input className="input mono" value={f.id} disabled={!!current} placeholder="my-tool" onChange={(e) => set("id", e.target.value)} />
                </label>
                <label className="field">
                  名称
                  <input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} />
                </label>
              </div>
              <label className="field" style={{ marginTop: 8 }}>
                连接方式
                <select className="input" value={f.transport} onChange={(e) => set("transport", e.target.value)}>
                  <option value="stdio">本机运行（命令）</option>
                  <option value="http">在线服务（网址）</option>
                </select>
              </label>
            </section>
          )}
          <section>
            {f.transport === "stdio" ? (
              <>
                {!item && (
                  <label className="field">
                    启动命令
                    <input className="input mono" value={f.command} placeholder="npx" onChange={(e) => set("command", e.target.value)} />
                  </label>
                )}
                {item ? (
                  <div className="sub mono" style={{ marginBottom: 8 }}>
                    {[item.command, ...fixedArgs].join(" ")}
                  </div>
                ) : null}
                {(!item || item.fields.some((x) => x.kind === "args")) && (
                  <label className="field">
                    {item?.fields.find((x) => x.kind === "args")?.label ?? "参数（每行一个）"}
                    <textarea className="input" style={{ minHeight: 80 }} value={f.args} onChange={(e) => set("args", e.target.value)} />
                  </label>
                )}
                {secretFields.map((x) => (
                  <label key={x.key} className="field" style={{ marginTop: 8 }}>
                    {x.label}
                    {current?.secretKeys.includes(x.key) ? "（已保存；填新的会替换）" : ""}
                    <input className="input mono" type="password" autoComplete="off" value={secretVals[x.key] ?? ""} onChange={(e) => setSecretVals({ ...secretVals, [x.key]: e.target.value })} />
                  </label>
                ))}
                {!item && (
                  <>
                    <label className="field" style={{ marginTop: 8 }}>
                      环境变量（KEY=值，每行一个，明文保存）
                      <textarea className="input" style={{ minHeight: 60 }} value={f.env} onChange={(e) => set("env", e.target.value)} />
                    </label>
                    <label className="field" style={{ marginTop: 8 }}>
                      密钥类环境变量（KEY=值，存进密钥库）{current?.secretKeys.length ? `：已有 ${current.secretKeys.join("、")}` : ""}
                      <textarea className="input mono" style={{ minHeight: 60 }} value={f.secretsText} onChange={(e) => set("secretsText", e.target.value)} />
                    </label>
                  </>
                )}
              </>
            ) : (
              <>
                {!item && (
                  <label className="field">
                    网址
                    <input className="input mono" value={f.url} placeholder="https://…/mcp" onChange={(e) => set("url", e.target.value)} />
                  </label>
                )}
                <label className="field" style={{ marginTop: 8 }}>
                  {item?.fields.find((x) => x.kind === "token")?.label ?? "访问令牌（Bearer，可选）"}
                  {current?.hasToken ? "（已保存；填新的会替换）" : ""}
                  <input className="input mono" type="password" autoComplete="off" value={f.token} onChange={(e) => set("token", e.target.value)} />
                </label>
              </>
            )}
          </section>
          <section>
            <h3>给谁用</h3>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <input type="radio" checked={scopeAll} onChange={() => setScopeAll(true)} /> 全部{t("employee")}（包括以后新建的）
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, marginTop: 4 }}>
              <input type="radio" checked={!scopeAll} onChange={() => setScopeAll(false)} /> 只给这些{t("employee")}：
            </label>
            {!scopeAll && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                {employees.map((a) => (
                  <label key={a.id} className="chip" style={{ cursor: "pointer" }}>
                    <input type="checkbox" checked={picked.includes(a.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, a.id] : picked.filter((x) => x !== a.id))} /> {a.name}
                  </label>
                ))}
              </div>
            )}
          </section>
          {test && (
            <section>
              <h3>测试结果</h3>
              {test.ok ? (
                <div className="sub">
                  能用（{test.ms} ms），提供 {test.tools?.length ?? 0} 个工具：<span className="mono">{test.tools?.slice(0, 20).join("、")}</span>
                </div>
              ) : (
                <div className="sub" style={{ color: "var(--as-high)" }}>
                  {test.error}
                  {test.stderr ? <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{test.stderr}</pre> : null}
                </div>
              )}
            </section>
          )}
          {err && <div className="sub" style={{ color: "var(--as-high)" }}>{err}</div>}
        </div>
        <footer>
          <div className="under" style={{ display: "flex", gap: 8 }}>
            <button className="btn" disabled={busy !== null || (f.transport === "stdio" ? !f.command && !item : !f.url && !item)} title="启动一次，列出它提供的工具（用这里填的值，不保存）" onClick={() => void runTest()}>
              {busy === "test" ? "测试中…（第一次可能要下载）" : "测试"}
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn ghost" onClick={onClose}>
              取消
            </button>
            <button className="btn primary" disabled={busy !== null || !f.id || needSecrets || (!scopeAll && picked.length === 0)} onClick={() => void save()}>
              {busy === "save" ? "保存中…" : current ? "保存" : "安装"}
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}
