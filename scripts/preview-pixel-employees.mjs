// Passive review artifact; no product interaction or live agent connection.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MODEL_FAMILIES } from "../packages/shared/src/index.ts";
import { ACTION_TEXT, characterSvg } from "../packages/pixel-office/src/characters.ts";

const output = resolve("work/pixel-preview");
await mkdir(output, { recursive: true });
const rows = MODEL_FAMILIES.map(family => `<section><h2>${family}</h2><div class="row">${Object.entries(ACTION_TEXT).map(([action, text]) => `<figure>${characterSvg(family, action, { animated: true })}<figcaption><b>${text}</b><span>${action}</span></figcaption></figure>`).join("")}</div></section>`).join("");
await writeFile(resolve(output, "index.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agentself · 像素员工图鉴</title><style>
*{box-sizing:border-box}body{margin:0;background:#f2f0ea;color:#243674;font-family:system-ui,sans-serif}main{padding:32px;max-width:1600px;margin:auto}h1{margin:0 0 8px}p{color:#626a79}section{padding:20px 0;border-top:1px solid #d9d9dd}h2{text-transform:capitalize;font-size:18px}.row{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px}figure{flex:0 0 120px;margin:0;background:#fff;border-radius:12px;padding:12px}svg{display:block;width:96px;height:88px;image-rendering:pixelated}figcaption{text-align:center;font-size:12px;margin-top:14px}figcaption span{display:block;color:#777f8d;font-size:10px;margin-top:5px}@media(prefers-color-scheme:dark){body{background:#171c27;color:#e3e8ef}figure{background:#232b3a}p,figcaption span{color:#adb8c9}section{border-color:#344157}}
</style><main><h1>像素员工 · 状态图鉴</h1><p>演示素材 / 10 种形象 / 11 个动作 · 工作状态由实际任务驱动 · 无宠物互动</p>${rows}</main></html>`, "utf8");
console.log(`Pixel employee preview: ${resolve(output, "index.html")}`);
