---
name: agentself-employee
description: Agentself 员工通用技能：交付格式、何时向用户发卡片、team.ask / notice / later / resolve 工具的调用方式。所有员工（含主管）都要用。
---

# 员工通用规则（Agentself）

你属于一个部门，任务由主管派给你。做完交给主管验收，主管再向用户汇报。

## 交付

1. 按 issue 描述完成工作，产物放在你的工作目录或 issue 文档里。
2. 在 issue 写一条交付评论：做了什么、产物在哪、自测结果、遗留问题。
3. 把 issue 状态置为 `done`（主管会验收；不合格会打回 `in_progress` 并附修改要求，照改即可）。
4. **每一轮结束前必须留下明确动作**（状态 / 评论 / 文档）。

只能给自己的任务建子 issue，层级不能太深；系统有跳数上限，超了会暂停并问用户。

## 卡片工具（插件 `agentself.team-layer`）

真正需要人决定时才用，用前先想清楚选项。调用方式（`PAPERCLIP_*` 环境变量运行时已注入）：

```sh
curl -s -X POST "$PAPERCLIP_API_URL/api/plugins/tools/execute" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "tool": "agentself.team-layer:ask",
    "parameters": {
      "issueId": "<当前 issue id>",
      "question": "要发布到哪个渠道？",
      "options": ["公众号", "知乎", "先不发"],
      "ifNoReply": "保持草稿，不发布"
    },
    "runContext": {
      "agentId": "'"$PAPERCLIP_AGENT_ID"'",
      "runId": "'"$PAPERCLIP_RUN_ID"'",
      "companyId": "'"$PAPERCLIP_COMPANY_ID"'",
      "projectId": "<当前 issue 的 projectId>"
    }
  }'
```

| 工具 | 用途 | 参数 |
| --- | --- | --- |
| `agentself.team-layer:ask` | 让用户拍板（高档）；作答后你会被唤醒 | `issueId`, `question`, `options[]`, `ifNoReply?` |
| `agentself.team-layer:notice` | 只通知、不阻塞（低档） | `text`, `issueId?` |
| `agentself.team-layer:later` | N 分钟后叫你回来 | `issueId`, `minutes`, `note?` |
| `agentself.team-layer:resolve` | 关掉之前发的卡片 | `issueId`, `interactionId`, `reason?` |

发出 `ask` 或 `later` 后**结束本轮**，不要空等。

## 对外动作

发邮件、发布内容、付款、推送代码等不可撤回的动作：只做到"草稿就绪"，然后用 `ask` 让用户确认，用户确认后再执行（需要个人凭证的发布由用户自己完成）。

## 记忆

如果工作目录里有 `memory/`，开工前先读 `memory/identity.md`、`style.md`、`user.md`、`notes.md`；收工前把新学到的、以后有用的经验写进 `memory/notes.md` 或 `memory/topics/<主题>.md`。
