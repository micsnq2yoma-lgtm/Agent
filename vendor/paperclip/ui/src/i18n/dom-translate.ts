// Agentself: zh-CN UI translation layer for the Paperclip admin UI.
//
// Most Paperclip UI text is hard-coded English across ~1,500 files. Instead of rewriting every
// component (and fighting every upstream merge), this layer translates rendered UI text with a
// dictionary extracted from the source (scripts/i18n in the Agentself repo) plus a few patterns
// for dynamic strings. User content (editors, markdown bodies, code, inputs) is never touched.
//
// Opt out per browser: localStorage.setItem("paperclip.locale", "en").
import zh from "./zh-CN-dom.json";

const DICT = new Map<string, string>(Object.entries(zh as Record<string, string>));

type Pattern = [RegExp, (m: RegExpMatchArray) => string];
const t = (s: string) => DICT.get(s) ?? s;
const PATTERNS: Pattern[] = [
  [/^just now$/i, () => "刚刚"],
  [/^(\d+)\s*s(?:ec(?:onds?)?)? ago$/i, (m) => `${m[1]} 秒前`],
  [/^(\d+)\s*m(?:in(?:utes?)?)? ago$/i, (m) => `${m[1]} 分钟前`],
  [/^(\d+)\s*h(?:ours?|rs?)? ago$/i, (m) => `${m[1]} 小时前`],
  [/^(\d+)\s*d(?:ays?)? ago$/i, (m) => `${m[1]} 天前`],
  [/^(\d+)\s*w(?:eeks?)? ago$/i, (m) => `${m[1]} 周前`],
  [/^(\d+)\s*mo(?:nths?)? ago$/i, (m) => `${m[1]} 个月前`],
  [/^in (\d+)\s*m(?:in(?:utes?)?)?$/i, (m) => `${m[1]} 分钟后`],
  [/^in (\d+)\s*h(?:ours?)?$/i, (m) => `${m[1]} 小时后`],
  [/^(\d+) (?:issues?|tasks?)$/i, (m) => `${m[1]} 个任务`],
  [/^(\d+) sub-?issues?$/i, (m) => `${m[1]} 个子任务`],
  [/^(\d+) agents?$/i, (m) => `${m[1]} 个智能体`],
  [/^(\d+) projects?$/i, (m) => `${m[1]} 个项目`],
  [/^(\d+) comments?$/i, (m) => `${m[1]} 条评论`],
  [/^(\d+) runs?$/i, (m) => `${m[1]} 次运行`],
  [/^(\d+) items?$/i, (m) => `${m[1]} 项`],
  [/^(\d+) results?$/i, (m) => `${m[1]} 条结果`],
  [/^(\d+) members?$/i, (m) => `${m[1]} 名成员`],
  [/^(\d+) skills?$/i, (m) => `${m[1]} 个技能`],
  [/^(\d+) (?:approvals?)$/i, (m) => `${m[1]} 个审批`],
  [/^(\d+) (?:files?)$/i, (m) => `${m[1]} 个文件`],
  [/^(\d+) selected$/i, (m) => `已选 ${m[1]} 项`],
  [/^(\d+) more$/i, (m) => `还有 ${m[1]} 项`],
  [/^\+(\d+) more$/i, (m) => `+${m[1]} 项`],
  [/^Updated (.+)$/, (m) => `更新于 ${translateText(m[1])}`],
  [/^Created (.+)$/, (m) => `创建于 ${translateText(m[1])}`],
  [/^Page (\d+) of (\d+)$/i, (m) => `第 ${m[1]} / ${m[2]} 页`],
  [/^(\d+) of (\d+)$/i, (m) => `${m[1]} / ${m[2]}`],
];

export function translateText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || !/[A-Za-z]/.test(trimmed)) return raw;
  const direct = DICT.get(trimmed.replace(/\s+/g, " "));
  let out: string | null = direct ?? null;
  if (out == null) {
    for (const [re, fn] of PATTERNS) {
      const m = trimmed.match(re);
      if (m) {
        out = fn(m);
        break;
      }
    }
  }
  if (out == null) {
    // "Label:" -> translate the label, keep the colon
    const colon = trimmed.match(/^(.+?)(:|：)$/);
    if (colon && DICT.has(colon[1])) out = `${DICT.get(colon[1])}：`;
  }
  if (out == null || out === trimmed) return raw;
  const lead = raw.match(/^\s*/)?.[0] ?? "";
  const trail = raw.match(/\s*$/)?.[0] ?? "";
  return lead + out + trail;
}

const SKIP_SELECTOR = [
  "script",
  "style",
  "code",
  "pre",
  "kbd",
  "samp",
  "textarea",
  "input",
  "[contenteditable='true']",
  "[contenteditable='']",
  ".mdxeditor",
  ".cm-editor",
  ".monaco-editor",
  ".prose",
  ".markdown-body",
  "[data-markdown]",
  "[data-no-translate]",
  "[translate='no']",
].join(",");

const ATTRS = ["placeholder", "title", "aria-label", "alt"] as const;
const originals = new WeakMap<Node, string>();

function skipped(el: Element | null): boolean {
  return !!el && !!el.closest(SKIP_SELECTOR);
}

function translateTextNode(node: Text) {
  const parent = node.parentElement;
  if (!parent || skipped(parent)) return;
  const value = node.nodeValue ?? "";
  const next = translateText(value);
  if (next !== value) {
    originals.set(node, value);
    node.nodeValue = next;
  }
}

function translateAttrs(el: Element) {
  if (skipped(el) && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return;
  if (el.closest("[data-no-translate],[translate='no']")) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const next = translateText(v);
    if (next !== v) el.setAttribute(a, next);
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return translateTextNode(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) translateAttrs(root as Element);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n = walker.nextNode();
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) translateTextNode(n as Text);
    else translateAttrs(n as Element);
    n = walker.nextNode();
  }
}

export function isChineseEnabled(): boolean {
  try {
    return (localStorage.getItem("paperclip.locale") ?? "zh-CN") !== "en";
  } catch {
    return true;
  }
}

let started = false;
export function startDomTranslation() {
  if (started || typeof document === "undefined" || !isChineseEnabled()) return;
  started = true;
  document.documentElement.lang = "zh-CN";
  const titleEl = document.querySelector("title");
  const fixTitle = () => {
    if (titleEl && titleEl.textContent) {
      const parts = titleEl.textContent.split(" · ").map((p) => translateText(p));
      const next = parts.join(" · ");
      if (next !== titleEl.textContent) titleEl.textContent = next;
    }
  };
  let pending = new Set<Node>();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const nodes = pending;
    pending = new Set();
    observer.disconnect();
    for (const n of nodes) if (n.isConnected) walk(n);
    fixTitle();
    observe();
  };
  const queue = (n: Node) => {
    pending.add(n);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  };
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") queue(r.target);
      else if (r.type === "attributes") queue(r.target);
      else r.addedNodes.forEach(queue);
    }
  });
  const observe = () =>
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  walk(document.body);
  fixTitle();
  observe();
}

export const __test = { DICT, PATTERNS, originals };
