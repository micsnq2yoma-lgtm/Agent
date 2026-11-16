// Mailboxes over IMAP (any provider: Gmail, Outlook, QQ, 163/126, company mail), zero dependencies.
// Read-only towards the outside world: reading, searching and saving a draft into the mailbox's
// Drafts folder. Nothing is ever sent: sending is an external action the user does themselves.
//
// Accounts: ~/.agentself/mail.json  { accounts: [{ id, address, host, port, user, password, drafts? }] }
// (the password is the provider's app password / 授权码, kept on this machine only)
// Cursor for "what is new": ~/.agentself/mail-state.json  { <id>: { uidValidity, lastUid } }
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";

const home = () => process.env.AGENTSELF_HOME ?? path.join(os.homedir(), ".agentself");
const accountsFile = () => path.join(home(), "mail.json");
const stateFile = () => path.join(home(), "mail-state.json");

/** Common IMAP servers; the user only types address + app password for these. */
export const MAIL_PRESETS = [
  { domain: /@(gmail|googlemail)\.com$/i, host: "imap.gmail.com", note: "Gmail：开启两步验证后生成「应用专用密码」" },
  { domain: /@(outlook|hotmail|live)\.[a-z.]+$/i, host: "outlook.office365.com", note: "Outlook：需要应用密码；部分账号只允许 OAuth，连不上时请用别的邮箱" },
  { domain: /@(qq|foxmail)\.com$/i, host: "imap.qq.com", note: "QQ 邮箱：设置 → 账户 → 开启 IMAP，生成授权码" },
  { domain: /@163\.com$/i, host: "imap.163.com", note: "163 邮箱：设置 → POP3/SMTP/IMAP → 开启 IMAP，生成授权码" },
  { domain: /@126\.com$/i, host: "imap.126.com", note: "126 邮箱：同 163，生成授权码" },
  { domain: /@(icloud|me|mac)\.com$/i, host: "imap.mail.me.com", note: "iCloud：在 Apple ID 里生成 App 专用密码" },
];
export function presetFor(address) {
  return MAIL_PRESETS.find((p) => p.domain.test(String(address ?? ""))) ?? null;
}

/* ---------------- accounts ---------------- */
export function readAccounts() {
  try {
    const v = JSON.parse(fs.readFileSync(accountsFile(), "utf8"));
    return Array.isArray(v?.accounts) ? v.accounts : [];
  } catch {
    return [];
  }
}
function writeAccounts(list) {
  fs.mkdirSync(home(), { recursive: true });
  fs.writeFileSync(accountsFile(), JSON.stringify({ accounts: list }, null, 2));
}
/** Accounts without passwords (for the UI and for agents). */
export function listAccounts() {
  return readAccounts().map(({ password, ...a }) => ({ ...a, hasPassword: !!password }));
}
export function saveAccount(input) {
  const address = String(input.address ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(address)) throw Object.assign(new Error("邮箱地址不对"), { status: 400 });
  const list = readAccounts();
  const id = String(input.id ?? "").trim() || address.toLowerCase();
  const cur = list.find((a) => a.id === id) ?? {};
  const preset = presetFor(address);
  const next = {
    ...cur,
    id,
    address,
    host: String(input.host ?? "").trim() || cur.host || preset?.host || "",
    port: Number(input.port ?? cur.port ?? 993) || 993,
    user: String(input.user ?? "").trim() || cur.user || address,
    ...(input.password ? { password: String(input.password) } : {}),
    ...(input.drafts !== undefined ? { drafts: String(input.drafts).trim() || undefined } : {}),
  };
  if (!next.host) throw Object.assign(new Error("没认出这个邮箱的 IMAP 服务器，请填写"), { status: 400 });
  if (!next.password) throw Object.assign(new Error("要填授权码或应用密码"), { status: 400 });
  writeAccounts([...list.filter((a) => a.id !== id), next]);
  return listAccounts().find((a) => a.id === id);
}
export function removeAccount(id) {
  writeAccounts(readAccounts().filter((a) => a.id !== id));
}
function account(id) {
  const list = readAccounts();
  const a = id ? list.find((x) => x.id === id || x.address === id) : list[0];
  if (!a) throw new Error(list.length ? `没有这个邮箱：${id}` : "还没有配置邮箱（设置 → 邮箱）");
  return a;
}

/* ---------------- MIME ---------------- */
function decoder(charset) {
  const c = String(charset ?? "utf-8").trim().toLowerCase().replace(/^"|"$/g, "");
  const alias = { gb2312: "gbk", "x-gbk": "gbk", "ks_c_5601-1987": "euc-kr", "iso-8859-8-i": "iso-8859-8" };
  try {
    return new TextDecoder(alias[c] ?? c);
  } catch {
    return new TextDecoder("utf-8");
  }
}
function qpBytes(s, header = false) {
  const t = header ? s.replace(/_/g, " ") : s.replace(/=\r?\n/g, "");
  const out = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) {
      out.push(parseInt(t.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(...Buffer.from(t[i], "latin1"));
  }
  return Buffer.from(out);
}
/** RFC 2047 encoded words in headers (=?gbk?B?...?=), adjacent words joined. */
export function decodeWords(s) {
  return String(s ?? "")
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?*]+)(?:\*[^?]*)?\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, text) => decoder(cs).decode(enc.toUpperCase() === "B" ? Buffer.from(text, "base64") : qpBytes(text, true)));
}
function splitHead(buf) {
  const s = buf.toString("latin1");
  let i = s.indexOf("\r\n\r\n");
  let sep = 4;
  if (i < 0) {
    i = s.indexOf("\n\n");
    sep = 2;
  }
  if (i < 0) return { head: s, body: Buffer.alloc(0) };
  return { head: s.slice(0, i), body: buf.subarray(i + sep) };
}
/** Header block → { name(lowercase): raw value }, folded lines unfolded. Values are latin1 bytes. */
export function parseHeaders(head) {
  const out = {};
  for (const line of String(head).replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m && !(m[1].toLowerCase() in out)) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}
/** Header text: raw 8-bit UTF-8 (common in Chinese mail) or encoded words. */
const headerText = (v) => decodeWords(Buffer.from(String(v ?? ""), "latin1").toString("utf8"));
function param(value, name) {
  const m = String(value ?? "").match(new RegExp(`${name}\\*?=(?:"([^"]*)"|([^;\\s]*))`, "i"));
  const v = m?.[1] ?? m?.[2] ?? null;
  if (v && /^[\w-]+''/.test(v)) {
    const [cs, , enc] = v.split("'");
    return decoder(cs).decode(Buffer.from(decodeURIComponent(enc).split("").map((c) => c.charCodeAt(0))));
  }
  return v ? headerText(v) : null;
}
function bodyBytes(body, encoding) {
  const e = String(encoding ?? "").trim().toLowerCase();
  if (e === "base64") return Buffer.from(body.toString("latin1").replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  if (e === "quoted-printable") return qpBytes(body.toString("latin1"));
  return body;
}
const htmlToText = (h) =>
  h
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** A full RFC 822 message → { headers, text, attachments[] }. */
export function parseMessage(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "latin1");
  const { head, body } = splitHead(buf);
  const h = parseHeaders(head);
  const parts = { plain: null, html: null, attachments: [] };
  walk(h, body, parts, 0);
  return {
    from: headerText(h.from),
    to: headerText(h.to),
    cc: headerText(h.cc),
    subject: headerText(h.subject),
    date: h.date ?? "",
    messageId: h["message-id"] ?? "",
    text: parts.plain ?? (parts.html ? htmlToText(parts.html) : ""),
    attachments: parts.attachments,
  };
}
function walk(h, body, parts, depth) {
  const type = String(h["content-type"] ?? "text/plain").toLowerCase();
  const disp = String(h["content-disposition"] ?? "").toLowerCase();
  if (type.startsWith("multipart/") && depth < 8) {
    const boundary = param(h["content-type"], "boundary");
    if (!boundary) return;
    const s = body.toString("latin1");
    const pieces = s.split(`--${boundary}`).slice(1);
    for (const piece of pieces) {
      if (piece.startsWith("--")) break;
      const b = Buffer.from(piece.replace(/^\r?\n/, ""), "latin1");
      const sub = splitHead(b);
      walk(parseHeaders(sub.head), sub.body, parts, depth + 1);
    }
    return;
  }
  const filename = param(h["content-disposition"], "filename") ?? param(h["content-type"], "name");
  if (disp.startsWith("attachment") || (filename && !type.startsWith("text/"))) {
    parts.attachments.push({ filename: filename ?? "(未命名)", type: type.split(";")[0], size: body.length });
    return;
  }
  if (type.startsWith("message/rfc822") && depth < 8) {
    const sub = splitHead(body);
    walk(parseHeaders(sub.head), sub.body, parts, depth + 1);
    return;
  }
  const text = decoder(param(h["content-type"], "charset") ?? "utf-8").decode(bodyBytes(body, h["content-transfer-encoding"]));
  if (type.startsWith("text/html")) parts.html ??= text;
  else if (type.startsWith("text/")) parts.plain ??= text;
}

/* ---------------- IMAP ---------------- */
const q = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Minimal IMAP4rev1 client over TLS: tagged commands, literals in responses, one at a time. */
export class Imap {
  constructor({ host, port = 993, timeoutMs = 30_000 }) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.buf = Buffer.alloc(0);
    this.tag = 0;
    this.waiters = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.sock = tls.connect({ host: this.host, port: this.port, servername: this.host }, () => {});
      this.sock.setTimeout(this.timeoutMs, () => this.sock.destroy(new Error("邮箱服务器超时")));
      this.sock.on("data", (d) => {
        this.buf = Buffer.concat([this.buf, d]);
        this.pump();
      });
      this.sock.on("error", (e) => {
        reject(e);
        for (const w of this.waiters.splice(0)) w.reject(e);
      });
      this.sock.on("close", () => {
        for (const w of this.waiters.splice(0)) w.reject(new Error("连接已关闭"));
      });
      this.greeting = { resolve, reject };
    });
  }
  /** Parse complete responses out of the buffer (lines, with {n} literals spliced in as Buffers). */
  pump() {
    for (;;) {
      const r = readResponse(this.buf);
      if (!r) return;
      this.buf = this.buf.subarray(r.used);
      this.onResponse(r);
    }
  }
  onResponse(r) {
    if (this.greeting) {
      const g = this.greeting;
      this.greeting = null;
      return /^\* (OK|PREAUTH)/i.test(r.line) ? g.resolve() : g.reject(new Error(`邮箱服务器拒绝连接：${r.line}`));
    }
    const w = this.waiters[0];
    if (!w) return;
    if (r.line.startsWith("+")) return w.onContinue?.();
    if (r.line.startsWith(`${w.tag} `)) {
      this.waiters.shift();
      const ok = /^\S+ OK/i.test(r.line);
      return ok ? w.resolve({ untagged: w.untagged, line: r.line }) : w.reject(Object.assign(new Error(r.line.replace(/^\S+\s+/, "")), { imap: true }));
    }
    w.untagged.push(r);
  }
  /** Send a command; `literal` (Buffer) is sent after the server's "+" continuation. */
  cmd(text, literal = null) {
    const tag = `A${++this.tag}`;
    return new Promise((resolve, reject) => {
      const w = { tag, untagged: [], resolve, reject };
      if (literal) w.onContinue = () => this.sock.write(Buffer.concat([literal, Buffer.from("\r\n")]));
      this.waiters.push(w);
      this.sock.write(`${tag} ${text}${literal ? ` {${literal.length}}` : ""}\r\n`);
    });
  }
  async login(user, password) {
    await this.cmd(`LOGIN ${q(user)} ${q(password)}`);
    // 163 / 126 refuse SELECT from clients that do not identify themselves ("Unsafe Login")
    await this.cmd(`ID ("name" "agentself" "version" "1.0" "vendor" "agentself")`).catch(() => {});
  }
  async select(box = "INBOX", readOnly = true) {
    const r = await this.cmd(`${readOnly ? "EXAMINE" : "SELECT"} ${q(box)}`);
    const info = { uidValidity: null, uidNext: null, exists: 0 };
    for (const u of r.untagged) {
      const v = u.line.match(/UIDVALIDITY (\d+)/i);
      if (v) info.uidValidity = Number(v[1]);
      const n = u.line.match(/UIDNEXT (\d+)/i);
      if (n) info.uidNext = Number(n[1]);
      const e = u.line.match(/^\* (\d+) EXISTS/i);
      if (e) info.exists = Number(e[1]);
    }
    return info;
  }
  async search(criteria) {
    const r = await this.cmd(`UID SEARCH ${criteria}`);
    const ids = [];
    for (const u of r.untagged) {
      const m = u.line.match(/^\* SEARCH(.*)$/i);
      if (m) ids.push(...m[1].trim().split(/\s+/).filter(Boolean).map(Number));
    }
    return ids;
  }
  /** UID FETCH; returns [{ uid, flags, literals: Buffer[] }]. */
  async fetch(uids, items) {
    if (!uids.length) return [];
    const r = await this.cmd(`UID FETCH ${uids.join(",")} (${items})`);
    return r.untagged
      .filter((u) => /^\* \d+ FETCH/i.test(u.line))
      .map((u) => ({ uid: Number(u.line.match(/UID (\d+)/i)?.[1]), flags: u.line.match(/FLAGS \(([^)]*)\)/i)?.[1] ?? "", literals: u.literals }));
  }
  async list() {
    const r = await this.cmd(`LIST "" "*"`);
    return r.untagged
      .map((u) => u.line.match(/^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (.+)$/i))
      .filter(Boolean)
      .map((m) => ({ flags: m[1], name: m[2].replace(/^"|"$/g, "").replace(/\\"/g, '"') }));
  }
  async append(box, message, flags = "\\Draft") {
    return this.cmd(`APPEND ${q(box)} (${flags})`, Buffer.from(message, "utf8"));
  }
  async logout() {
    await this.cmd("LOGOUT").catch(() => {});
    this.sock?.end();
  }
}

/** One response: a line (possibly with literals) ending in CRLF. null if incomplete. Pure. */
export function readResponse(buf) {
  let pos = 0;
  let line = "";
  const literals = [];
  for (;;) {
    const nl = buf.indexOf("\r\n", pos);
    if (nl < 0) return null;
    const part = buf.subarray(pos, nl).toString("latin1");
    const lit = part.match(/\{(\d+)\}$/);
    if (!lit) return { line: line + part, literals, used: nl + 2 };
    const n = Number(lit[1]);
    const start = nl + 2;
    if (buf.length < start + n) return null;
    literals.push(buf.subarray(start, start + n));
    line += part + "<literal>";
    pos = start + n;
  }
}

async function open(acc) {
  const imap = new Imap({ host: acc.host, port: acc.port ?? 993 });
  await imap.connect();
  await imap.login(acc.user ?? acc.address, acc.password);
  return imap;
}
const HEADER_ITEMS = "UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)]";
function summarize(row) {
  const h = parseHeaders(row.literals[0]?.toString("latin1") ?? "");
  return { uid: row.uid, from: headerText(h.from), subject: headerText(h.subject), date: h.date ?? "", unread: !/\\Seen/i.test(row.flags) };
}
const imapDate = (d) => `${d.getDate()}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}-${d.getFullYear()}`;

/** Try the login and count unread mail. */
export async function testAccount(input) {
  const acc = { ...account(input.id || input.address), ...Object.fromEntries(Object.entries(input).filter(([, v]) => v)) };
  const imap = await open(acc);
  try {
    const box = await imap.select("INBOX");
    const unread = await imap.search("UNSEEN");
    return { ok: true, messages: box.exists, unread: unread.length };
  } finally {
    await imap.logout();
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return {};
  }
}
function writeState(s) {
  fs.mkdirSync(home(), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2));
}

/** Mail that arrived since the last call (first call: the last `firstDays` days). Advances the cursor. */
export async function newMail({ account: id, max = 30, firstDays = 1 } = {}) {
  const acc = account(id);
  const imap = await open(acc);
  try {
    const box = await imap.select("INBOX");
    const all = readState();
    const cur = all[acc.id];
    let uids;
    if (cur && cur.uidValidity === box.uidValidity) uids = (await imap.search(`UID ${cur.lastUid + 1}:*`)).filter((u) => u > cur.lastUid);
    else uids = await imap.search(`SINCE ${imapDate(new Date(Date.now() - firstDays * 86400_000))}`);
    uids.sort((a, b) => a - b);
    const take = uids.slice(-max);
    const rows = (await imap.fetch(take, HEADER_ITEMS)).map(summarize).sort((a, b) => a.uid - b.uid);
    const lastUid = Math.max(cur?.uidValidity === box.uidValidity ? cur.lastUid : 0, ...uids, 0);
    all[acc.id] = { uidValidity: box.uidValidity, lastUid, checkedAt: new Date().toISOString() };
    writeState(all);
    return { account: acc.address, count: uids.length, shown: rows.length, messages: rows };
  } finally {
    await imap.logout();
  }
}

/** Recent mail (headers), optionally filtered by text in sender or subject. Does not move the cursor. */
export async function recentMail({ account: id, days = 3, query = "", unreadOnly = false, max = 50 } = {}) {
  const acc = account(id);
  const imap = await open(acc);
  try {
    await imap.select("INBOX");
    const uids = (await imap.search(`${unreadOnly ? "UNSEEN " : ""}SINCE ${imapDate(new Date(Date.now() - days * 86400_000))}`)).sort((a, b) => a - b);
    const rows = (await imap.fetch(uids.slice(-300), HEADER_ITEMS)).map(summarize);
    const qx = String(query).trim().toLowerCase();
    const hit = qx ? rows.filter((r) => `${r.from} ${r.subject}`.toLowerCase().includes(qx)) : rows;
    return { account: acc.address, messages: hit.sort((a, b) => b.uid - a.uid).slice(0, max) };
  } finally {
    await imap.logout();
  }
}

/** One message in full (text capped), without marking it read. */
export async function readMail({ account: id, uid, maxChars = 20_000 }) {
  const acc = account(id);
  const imap = await open(acc);
  try {
    await imap.select("INBOX");
    const [row] = await imap.fetch([Number(uid)], "UID BODY.PEEK[]");
    if (!row?.literals[0]) throw new Error(`没有这封邮件：${uid}`);
    const m = parseMessage(row.literals[0]);
    return { uid: Number(uid), ...m, text: m.text.length > maxChars ? `${m.text.slice(0, maxChars)}\n…（后面还有 ${m.text.length - maxChars} 字）` : m.text };
  } finally {
    await imap.logout();
  }
}

const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
/** Build a plain-text draft (RFC 822). Pure. */
export function buildDraft({ from, to, cc = "", subject, body, inReplyTo = "" }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n"),
  ];
  return lines.join("\r\n");
}

/** Save a draft into the mailbox's Drafts folder (the user reviews and sends it). Never sends. */
export async function saveDraft({ account: id, to, cc = "", subject, body, replyToUid = null }) {
  const acc = account(id);
  const imap = await open(acc);
  try {
    let inReplyTo = "";
    let subj = subject;
    if (replyToUid) {
      await imap.select("INBOX");
      const [row] = await imap.fetch([Number(replyToUid)], HEADER_ITEMS);
      const h = parseHeaders(row?.literals[0]?.toString("latin1") ?? "");
      inReplyTo = h["message-id"] ?? "";
      subj ||= `Re: ${headerText(h.subject)}`;
    }
    const boxes = await imap.list();
    const drafts = acc.drafts ?? boxes.find((b) => /\\Drafts/i.test(b.flags))?.name ?? boxes.find((b) => /^(drafts|草稿|&g0l6P3ux-)/i.test(b.name))?.name ?? "Drafts";
    await imap.append(drafts, buildDraft({ from: acc.address, to, cc, subject: subj || "(无主题)", body, inReplyTo }));
    return { saved: true, folder: drafts, note: "已存进草稿箱，没有发送。用户会自己检查后发送。" };
  } finally {
    await imap.logout();
  }
}
