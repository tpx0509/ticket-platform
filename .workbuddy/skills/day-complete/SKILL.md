---
name: day-complete
description: 处理 30 天冲刺的「第 N 天完成」收尾动作：提交并推送 ticket-platform 的代码、重新生成并替换桌面进度壁纸、讲解下一天的预习内容。当用户说「第 N 天完成」「DN 搞定了」「今天完成了」「收工」这类话时使用。仅在 ticket-platform 项目内使用。
agent_created: true
---

# 第 N 天完成

一次触发，四个动作：**提交代码 → 换壁纸 → 讲解下一天 → 记台账**。

## 什么时候用

用户明确表示某一天结束了才启动：

- 「第 2 天完成」「D2 完成了」「今天搞定了」「收工」
- 带验收结论的：「SQL 那部分学完了，第 2 天完成」

**不要**在用户只是问问题、改个 bug、聊技术时启动。

## 不许提前（用户 2026-11-06 明确要求）

只做当天该做的事。不要在 D6 收尾时顺手把 D12 的越权、D13 的分页这类内容提前实现——用户还没学到那块，代码看着困难，也会失去「先踩坑、后学原理」的顺序。

- **讲解只讲 D{N+1}**，不要把后面几天一起倒完
- **实现只在当天验收范围内**，不引入后面才讲的技术
- 一件事跨天时（比如迁移），做完属于当天的那部分就停
- 已经提前做完的（M3 的 RLS + 404 兜底）保留不动，但不再新增提前项

用户要提前做时，先确认一句「这块还没学到，确定现在做？」，得到明确同意再动手。

## 不许省略（同一要求的另一半）

「不提前」不等于「跳过」。清单和里程碑里列出的每一项，到对应那天都要出现，而且**由用户自己写**，不是 agent 代做。

- 一天收尾时，把清单里那天的 `tasks` 逐条对一遍，缺哪项当场补，不许因为「快了」「顺手做了」就划过去
- 之前被 agent 代做掉的，在对应那天**回炉**：删掉重写，或者在空文件上从零写一遍。不许说「这个已经做过了」直接跳过
- 回炉时要讲清当时为什么那么写，然后让他自己动手，agent 只在写完 review

回炉清单（截至 D6）：

| 该做的日子 | 内容 | 现状 |
|---|---|---|
| D9 框架起步 | `GET /orgs/:orgId/tickets/:id` | 2026-11-06 已由 agent 写完，当天让用户从 controller 到 repository 自己重写一遍，另补列表、创建两个接口 |
| D12 鉴权（下） | RLS 策略 + 受限角色 + 越权测试（M3） | 2026-11-06 已由 agent 做完，当天让用户在空 schema 上自己写一遍策略，再补 RBAC 与垂直越权 |



## 重要例外：提交代码

用户的全局规则是「绝不自动 commit / push」，改动一律留在工作区让用户自己看。**本 skill 是这条规则的唯一例外**——用户说「第 N 天完成」，就是授权提交。

但例外仅限这一次触发，不延伸到其他场景。提交时仍然：

- 不 `--amend`，不 `--no-verify`，不 `--force`
- 有 hook 失败就修根因，不绕过
- 把 `git status` 和定好的提交信息一起展示给用户，展示与执行在同一条消息里完成

## 第一步：确认是哪一天

天数编号以桌面清单为准：`D:\desktop\全栈30天冲刺清单.html`，范围 D0–D30，共 31 项。**D0 是准备日，不计入打卡总数，分母固定 30。**每天标题见 `references/checklist.md`。

不要把它和项目的 M1/M2/M3 里程碑编号混用——两套完全不同的东西，对照表在 `references/checklist.md`。

用户没说清是哪天时，读 `.workbuddy/day-progress.json`（本 skill 的台账）：

- 存在则取 `last_completed + 1`
- 不存在或日期对不上，直接问用户「今天是第几天」，不要猜

**补齐规则（用户 2026-11-06 明确要求）**：说「第 N 天完成」，就把 N 以及 N 之前所有还没记进台账的天数**一并记上**，不要只记 N。比如台账停在 D2、用户说「D4 完成」，就要补 D3 和 D4 两条，壁纸按 D4 出，D3 不单独出图。

补齐时日期按实际学习的那天填。查不到就问一句，别按天数硬推。

## 第二步：提交代码

```bash
cd /e/newProject/ticket-platform
git status --short
git diff --stat
```

先看改了什么。**如果暂存区里出现 `.env`、密钥、证书、`.data/`、`uploads/`，立刻停下报告，不要提交。**（`.gitignore` 已覆盖这些，但用户可能手动 `git add` 过。）

提交信息按 `docs/conventions.md`：Conventional Commits，中文描述，scope 取 `api` / `web` / `worker` / `shared` / `infra` / `docs`。

```
<type>(<scope>): <一句话说清改了什么>

<为什么这么改，一到两句>
```

正例：

```
feat(api): 落地工单查询接口与统一响应信封

查询条件按 org_id 隔离，分页用游标避免深翻页。
异常统一走 AllExceptionsFilter，响应结构对齐 docs/response-format.md。
```

反例：`update`、`fix bug`、`第2天完成`。

一次触发只做一个提交，把当天改动全部收进去。提交后 `git push` 到当前分支（`master`）。

推送失败（无网络、无凭据）不算任务失败：报告失败原因、保留本地提交，继续走后面三步。

## 第三步：生成并替换壁纸

输出目录固定 `C:\Users\Tian\AppData\Local\WorkBuddyWallpapers\`，文件名 `day-NN.png`，历史文件保留不覆盖。

### 3.1 先生成背景图（可选）

用 ImageGen 生成一张 16:10、3200×2000 的背景图，主题跟当天学的东西相关（SQL 就抽象一点的数据网格，Docker 就容器意象）。存到 `C:\Users\Tian\AppData\Local\WorkBuddyWallpapers\bg\dNN.png`。

要求：

- **不要让模型画任何文字**，文字一律由脚本叠，模型画中文会糊成一团
- 构图留出左侧和底部，那里要放字
- 暗色调，方便压蒙版后保持对比度

生成失败或嫌麻烦就跳过，脚本会自己画渐变底，效果同样可用。

### 3.2 叠文字

```bash
PY="C:/Users/Tian/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
"$PY" "E:/newProject/ticket-platform/.workbuddy/skills/day-complete/scripts/make_wallpaper.py" \
  --day 5 --title "事务与并发" \
  --next-day 6 --next-title "Node 连库" \
  --done 4 --total 30 --date "2026-11-06" \
  --out "C:/Users/Tian/AppData/Local/WorkBuddyWallpapers/day-05.png"
```

上面这个命令是 D4 完成后的实际调用：`last_completed` 是 4，所以 `--day` 取 5、`--done` 取 4。`--bg` 参数只是可选背景图，不给就用脚本画的渐变底。

参数说明：

| 参数 | 含义 |
|---|---|
| `--day` | **即将开始/正在学的那一天**（`last_completed + 1`），不是刚完成的那天 |
| `--title` | 这一天的标题，取自清单，可精简 |
| `--next-day` / `--next-title` | `--day + 1`；D30 之后传 `--next-day -1` |
| `--done` / `--total` | 已完整完成的天数 / **固定 30**。D0 是准备日不计入，只数 D1–D30 |
| `--date` | 壁纸上显示的日期，填 `--day` 那天 |
| `--bg` | 背景图路径，不给则用渐变 |
| `--out` | 输出路径 |

**壁纸的语义（用户 2026-11-06 明确要求）**：它是「接下来干什么」的提示，不是「昨天干完了」的总结。所以 D4 完成之后出的图应该是「第 5 天 + 已完成 4 天 + 明天 D6」，而不是「第 4 天 + 已完成 5 天 + 明天 D5」。

如果 `--day` 那天已经学完（比如深夜补图），照样按 `last_completed + 1` 出，保持和用户预期一致。

`--done` 按台账里实际完成的天数填，不要硬算。

生成后**用 ViewImage 看一遍**，确认没有文字被裁掉、没有压到卡片上。有问题就调 `--title` 长度或字号，别硬发。

### 3.3 应用

用 PowerShell 工具执行，不要从 bash 里调 powershell：

```powershell
& "E:\newProject\ticket-platform\.workbuddy\skills\day-complete\scripts\set_wallpaper.ps1" -Path "C:\Users\Tian\AppData\Local\WorkBuddyWallpapers\day-02.png"
```

返回 `OK <path>` 才算成功。脚本走注册表 + `rundll32` 刷新，不需要 `Add-Type`，在编译被禁的环境里也能用。

## 第四步：讲解下一天

从清单取出 D{N+1} 的 `tasks` 和 `accept` 原文（标题见 `references/checklist.md`，任务细节直接读 HTML）。

讲解按这个顺序，不要写成教科书：

1. **这一天要产出什么**——一句话说清，落到能看见的东西上（一个能跑的接口、一张能查的表）。
2. **每个知识点**——它是什么、为什么需要它、在 ticket-platform 里对应哪块。用项目里的真实表名和字段举例，别用 `users` / `products` 这种玩具表。
3. **面试会怎么问**——挑 1–2 个高频问题，给出该有的答题骨架。
4. **明天动手的第一步**——具体到命令或文件名，让人一坐下来就能开始。

篇幅控制在一屏多一点。**不要一次把整天的内容倒完**，讲完主体后停下，问「先从哪块开始」，等回应再展开。

讲解质量的标准：用户读完能自己写出第一行代码，而不是只知道「今天要学窗口函数」。

## 第五步：记台账

写 `.workbuddy/day-progress.json`：

```json
{
  "last_completed": 2,
  "days": {
    "2": { "date": "2026-11-03", "commit": "<sha>", "wallpaper": "day-02.png" }
  }
}
```

只增不改历史条目。

补记的天数（见第一步的补齐规则）如果没有对应提交，`commits` 留空数组，`wallpaper` 填 `null`——不要编造。

最后提醒一句：清单网页的勾选状态存在浏览器 localStorage 里，agent 改不了，**需要用户自己去页面上勾**。别默默跳过这件事。

## 出错时

| 情况 | 处理 |
|---|---|
| 工作区有不该提交的文件 | 停下报告，不提交，其余步骤照做 |
| `git push` 失败 | 保留本地提交，报告原因，继续壁纸和讲解 |
| 壁纸脚本报 `bg not found` | 去掉 `--bg` 重跑，用渐变底 |
| 设置壁纸返回非 0 | 把脚本报错原样贴给用户，不要静默跳过 |
| 无法确定是第几天 | 问用户，不要按日期猜 |

## 参考

- `references/checklist.md`——D0–D30 全部标题、学习计划编号与项目里程碑编号对照、HTML 结构说明
- `scripts/make_wallpaper.py`——壁纸合成，`--help` 看全参数
- `scripts/set_wallpaper.ps1`——应用壁纸，纯 ASCII，走注册表
- 项目文档：`docs/conventions.md`（提交信息规范）、`docs/erd.md`（表结构，讲解时引用）
