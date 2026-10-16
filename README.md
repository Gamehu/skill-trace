# skill-trace

Live visualization of Claude Code skill runs.

在本地查看你的 Claude Code Skill，以及每一次 Skill 调用的完整工作过程：调用了哪些工具、各花了多久、哪里出错、消耗多少 token。正在运行的 Skill 会实时出现在页面上。

## 运行

```bash
npm install
npm run build   # 构建前端
npm start       # http://localhost:4317
```

开发模式（前端热更新，API 改动自动重启）：

```bash
npm run dev     # http://localhost:5173
```

可选环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `4317` | 服务端口，也可用 `npm start -- --port 5000` |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code 数据目录 |

## 数据从哪来

不需要埋点，也不修改 Claude Code 配置，只读取本地已有的文件：

- **Skill 列表**：`~/.claude/skills/*/SKILL.md`（user）、`~/.claude/plugins/**`（plugin）、各项目的 `.claude/skills/`（project）。内置 Skill 磁盘上没有 SKILL.md，内容取自会话记录中加载时注入的文本。
- **运行过程**：`~/.claude/projects/*/*.jsonl` 会话记录。一次 Skill 运行从 `Skill` 工具调用（或 `/skill-name` 命令）开始，到下一条用户输入、下一次 Skill 调用或本轮回复结束为止，中间的工具调用、回复都算在这次运行里。
- **实时更新**：用 Node 原生 `fs.watch`（递归模式，macOS 下走 FSEvents）监听上述目录，有变化就通过 SSE 推送到页面。

## 页面

- **Overview**：总览。运行数、工具调用、token 走势，正在运行的 Skill（实时计时），星期 × 小时活跃热力图，最常用 Skill 排行和工具类型占比。
- **Skills**：本机所有 Skill，按来源筛选。用过的以卡片展示（调用次数、平均耗时、14 天走势），没用过的折叠成紧凑列表。点进去可以看到渲染后的 SKILL.md、附带文件、30 天调用分布和历史运行。
- **Runs**：所有 Skill 运行，每行带一个按时间排布的工具调用缩略图。
- **Trace**：单次运行的瀑布图，按工具类型着色；点任意一步可以在右侧查看完整输入和输出。

## 技术栈

Node + TypeScript · Hono · fs.watch · SSE · Vite · React · Tailwind CSS v4 · Shiki · d3-scale · Geist / Instrument Serif

```
server/   API、Skill 扫描、会话记录解析、文件监听
web/      前端（Vite root）
bin/      CLI 入口
```

```bash
npm test          # 解析器单元测试
npm run typecheck
```
