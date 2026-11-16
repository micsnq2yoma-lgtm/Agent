// The acceptance watcher's protocol: how a round's request, result and verdict are recognised.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { buildPrompt, findRequest, findResult, parseVerdict, repoFromRemote, resultHeading } from "../../../scripts/dev/acceptance-watch.mjs";

const sha = "343f3b46da99082a841d347fb820106daa3181bc";

describe("acceptance watcher", () => {
  it("result comments are recognised by machine, PR and commit, and only after the round started", () => {
    const head = resultHeading("B", 8, sha);
    expect(head).toBe("## [验收机 B] PR #8 @ 343f3b4");
    const comments = [
      { body: `${head}\n旧的\n结论：需修改`, created_at: "2026-11-16T08:00:00Z" },
      { body: `## [验收机 A] PR #8 @ 343f3b4\n结论：通过`, created_at: "2026-11-16T09:10:00Z" },
      { body: `${head}\n| p2 | ✅ |\n结论：通过`, created_at: "2026-11-16T09:20:00Z" },
    ];
    expect(findResult(comments, { machine: "B", pr: 8, sha, since: "2026-11-16T09:00:00Z" })?.body).toMatch(/p2/);
    expect(findResult(comments, { machine: "C", pr: 8, sha, since: "2026-11-16T09:00:00Z" })).toBeNull();
    expect(findResult(comments, { machine: "B", pr: 8, sha: "deadbeef", since: "" })).toBeNull();
  });
  it("the verdict is the last 结论 line", () => {
    expect(parseVerdict("…\n结论：通过")).toBe("pass");
    expect(parseVerdict("说明里提到结论：需修改的情况\n\n结论：通过")).toBe("pass");
    expect(parseVerdict("结论: **需修改**")).toBe("fix");
    expect(parseVerdict("没有结论")).toBeNull();
  });
  it("the newest 验收请求 comment is this round's checklist", () => {
    const c = [{ body: "## 验收请求\n第一轮" }, { body: "普通评论" }, { body: "  ## 验收请求\n第二轮：跑 p20" }];
    expect(findRequest(c)?.body).toMatch(/第二轮/);
    expect(findRequest([{ body: "无" }])).toBeNull();
  });
  it("repo from the git remote", () => {
    expect(repoFromRemote("https://github.com/micsnq2yoma-lgtm/Agentself.git")).toBe("micsnq2yoma-lgtm/Agentself");
    expect(repoFromRemote("git@github.com:acme/app.git")).toBe("acme/app");
    expect(repoFromRemote("http://127.0.0.1:1234/git/x")).toBeNull();
  });
  it("the prompt carries the exact heading and the request", () => {
    const p = buildPrompt({ machine: "B", repo: "o/r", pr: { number: 8, title: "论文库", url: "u" }, sha, request: "## 验收请求\n跑 p20" });
    expect(p).toContain("## [验收机 B] PR #8 @ 343f3b4");
    expect(p).toContain("跑 p20");
    expect(p).toContain("docs/acceptance/MAINTAINER.md");
    expect(p).toContain("gh pr comment 8 --repo o/r --body-file");
  });
});
