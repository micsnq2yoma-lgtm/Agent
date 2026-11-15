// Human wording for the cron expressions the UI offers (盯守 / 例行任务): "每天 08:30".
// Anything it does not recognise is returned as is.
const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const pad = (n: number) => String(n).padStart(2, "0");
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);

function days(dow: string): string | null {
  if (dow === "*") return "每天";
  if (dow === "1-5") return "工作日";
  if (dow === "0,6" || dow === "6,0" || dow === "6-7") return "周末";
  const parts = dow.split(",").map(num);
  if (parts.every((d) => d !== null && d >= 0 && d <= 7)) return `每${parts.map((d) => WEEK[d!]).join("、")}`;
  return null;
}

export function cronText(expr: string | null | undefined): string {
  const raw = (expr ?? "").trim();
  const f = raw.split(/\s+/);
  if (f.length !== 5) return raw;
  const [mi, h, dom, mon, dow] = f;
  if (mon !== "*") return raw;
  const step = (s: string) => s.match(/^\*\/(\d+)$/)?.[1];
  if (step(mi) && h === "*" && dom === "*" && dow === "*") return `每 ${step(mi)} 分钟`;
  const m = num(mi);
  if (m === null) return raw;
  if (h === "*" && dom === "*" && dow === "*") return m === 0 ? "每小时" : `每小时第 ${m} 分`;
  if (step(h) && dom === "*" && dow === "*") return `每 ${step(h)} 小时`;
  const hours = h.split(",").map(num);
  if (hours.some((x) => x === null || x > 23)) return raw;
  const at = hours.map((x) => `${pad(x!)}:${pad(m)}`).join("、");
  if (dom !== "*") {
    const d = num(dom);
    return d !== null && dow === "*" ? `每月 ${d} 日 ${at}` : raw;
  }
  const d = days(dow);
  return d ? `${d} ${at}` : raw;
}
