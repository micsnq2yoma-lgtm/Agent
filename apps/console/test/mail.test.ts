// Mailboxes over IMAP, zero dependencies: MIME decoding (Chinese mail), the IMAP response reader,
// drafts. (The client itself was exercised against a fake IMAP-over-TLS server.)
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDraft, decodeWords, listAccounts, mailEnv, mailEnvName, parseMessage, plainPasswordAccounts, presetFor, readResponse, saveAccount, testAccount } from "../server/mail.mjs";

const gbk = (s: string) => Buffer.from(new Uint8Array([...s].flatMap((c) => ({ 你: [0xc4, 0xe3], 好: [0xba, 0xc3], 论: [0xc2, 0xdb], 文: [0xce, 0xc4] } as Record<string, number[]>)[c] ?? [c.charCodeAt(0)])));

describe("MIME", () => {
  it("decodes encoded-word headers in UTF-8 and GBK, joined across words", () => {
    expect(decodeWords(`=?UTF-8?B?${Buffer.from("张老师").toString("base64")}?= <z@u.edu>`)).toBe("张老师 <z@u.edu>");
    expect(decodeWords(`=?GBK?B?${gbk("论文").toString("base64")}?=`)).toBe("论文");
    expect(decodeWords("=?utf-8?Q?caf=C3=A9_au_lait?=")).toBe("café au lait");
    expect(decodeWords(`=?UTF-8?B?${Buffer.from("你").toString("base64")}?= =?UTF-8?B?${Buffer.from("好").toString("base64")}?=`)).toBe("你好");
  });
  it("finds the text part of a multipart GBK message and lists attachments", () => {
    const raw = Buffer.concat([
      Buffer.from(`From: a@b.c\r\nSubject: =?GBK?B?${gbk("论文").toString("base64")}?=\r\nContent-Type: multipart/mixed; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/plain; charset=GBK\r\nContent-Transfer-Encoding: base64\r\n\r\n${gbk("你好").toString("base64")}\r\n--b1\r\nContent-Type: application/pdf; name="p.pdf"\r\nContent-Disposition: attachment; filename="p.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0=\r\n--b1--\r\n`, "latin1"),
    ]);
    const m = parseMessage(raw);
    expect(m.subject).toBe("论文");
    expect(m.text).toBe("你好");
    expect(m.attachments).toEqual([{ filename: "p.pdf", type: "application/pdf", size: 10 }]);
  });
  it("falls back to HTML as text, decoding quoted-printable", () => {
    const m = parseMessage(Buffer.from("Subject: hi\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<p>caf=C3=A9</p><br>line &amp; more\r\n", "latin1"));
    expect(m.text).toBe("café\n\nline & more");
  });
});

describe("IMAP responses", () => {
  it("splices literals and waits for complete data", () => {
    const body = Buffer.from("Subject: x\r\n\r\n");
    const full = Buffer.concat([Buffer.from(`* 1 FETCH (UID 10 BODY[] {${body.length}}\r\n`), body, Buffer.from(")\r\nA1 OK\r\n")]);
    expect(readResponse(full.subarray(0, 20))).toBeNull();
    const r = readResponse(full);
    expect(r.line).toBe("* 1 FETCH (UID 10 BODY[] {14}<literal>)");
    expect(r.literals[0].toString()).toBe("Subject: x\r\n\r\n");
    expect(readResponse(full.subarray(r.used)).line).toBe("A1 OK");
  });
});

describe("drafts and presets", () => {
  it("a draft is a UTF-8 text message replying to the original; nothing here sends mail", () => {
    const d = buildDraft({ from: "me@qq.com", to: "z@u.edu", subject: "Re: 论文", body: "好的", inReplyTo: "<m1@u.edu>" });
    expect(d).toMatch(/^From: me@qq\.com\r\nTo: z@u\.edu\r\nSubject: =\?UTF-8\?B\?/);
    expect(d).toMatch(/In-Reply-To: <m1@u\.edu>/);
    expect(Buffer.from(d.split("\r\n\r\n")[1], "base64").toString()).toBe("好的");
  });
  it("knows the common Chinese and international providers", () => {
    expect(presetFor("me@qq.com").host).toBe("imap.qq.com");
    expect(presetFor("me@163.com").host).toBe("imap.163.com");
    expect(presetFor("me@gmail.com").host).toBe("imap.gmail.com");
    expect(presetFor("me@lab.edu.cn")).toBeNull();
  });
});

describe("app passwords live in the secret store", () => {
  it("with a secretId nothing secret is written to mail.json; agents get a secret_ref binding", async () => {
    const prev = process.env.AGENTSELF_HOME;
    process.env.AGENTSELF_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "agentself-mail-"));
    try {
      saveAccount({ address: "me@qq.com", password: "typed-code" });
      expect(plainPasswordAccounts()).toHaveLength(1); // before any team: waits in the file
      saveAccount({ address: "me@qq.com" }, { secretId: "sec-1" });
      const file = fs.readFileSync(path.join(process.env.AGENTSELF_HOME, "mail.json"), "utf8");
      expect(file).not.toMatch(/typed-code/);
      expect(plainPasswordAccounts()).toHaveLength(0);
      expect(listAccounts()[0]).toMatchObject({ hasPassword: true, inSecretStore: true, host: "imap.qq.com" });
      const name = mailEnvName("me@qq.com");
      expect(name).toMatch(/^AGENTSELF_MAIL_PW_[0-9A-F]{10}$/);
      expect(mailEnv()).toEqual({ [name]: { type: "secret_ref", secretId: "sec-1", version: "latest" } });
      // outside a run the stored password is not available: testing needs it typed again
      await expect(testAccount({ id: "me@qq.com" })).rejects.toThrow(/再填一次授权码/);
    } finally {
      process.env.AGENTSELF_HOME = prev;
    }
  });
});
