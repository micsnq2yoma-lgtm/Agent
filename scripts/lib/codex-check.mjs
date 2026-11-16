// Known problems in a machine's own Codex setup that make every Codex run fail before it starts, with
// a plain explanation. Agentself never edits ~/.codex/config.toml (it is the user's own); it only says
// what to change.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const codexHome = (env = process.env) => env.CODEX_HOME || path.join(os.homedir(), ".codex");

/** Problems found in config.toml text. Pure. */
export function configProblems(text) {
  const out = [];
  const tier = /^\s*service_tier\s*=\s*["']([^"']*)["']/m.exec(text ?? "");
  // codex-cli 0.128 accepts only "fast" and "flex"; older configs wrote "default"
  if (tier && !["fast", "flex"].includes(tier[1]))
    out.push({ code: "service_tier", message: `config.toml 里 service_tier = "${tier[1]}"，当前 Codex 只认 "fast" 或 "flex"`, fix: `删掉这一行（用默认档），或改成 service_tier = "flex"` });
  return out;
}

/** Problems in this machine's ~/.codex/config.toml (none when the file is missing). */
export function codexConfigProblems(env = process.env) {
  const file = path.join(codexHome(env), "config.toml");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return configProblems(text).map((p) => ({ ...p, file }));
}

/** A hint for a Codex error message, or null. Pure. */
export function explainCodexError(text) {
  const s = String(text ?? "");
  if (/Error loading config\.toml/i.test(s)) {
    const v = /unknown variant [`'"]?([\w-]+)/.exec(s)?.[1];
    return `本机 Codex 的配置文件（~/.codex/config.toml）读不出来${v ? `：有一项写成了 "${v}"，当前版本不认` : ""}。这是这台电脑自己的 Codex 设置，Agentself 不会替你改；${v === "default" ? '多半是 service_tier = "default"，删掉这一行或改成 "flex"' : "按报错改掉那一行"}，再点"重新检测"。`;
  }
  if (/unexpected argument/i.test(s)) return "Codex 收到了被拆开的参数（Windows 上带空格的参数会被拆开）。更新 Agentself 后点\"重新检测\"；还不行就把这段报错发给开发者。";
  if (/not logged in|login required|401|unauthorized/i.test(s)) return "这台电脑的 Codex 还没登录：在命令行运行 codex login。";
  return null;
}
