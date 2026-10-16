/**
 * Demo mode: writes a fake Claude Code home (skills, plugins, 30 days of transcripts) to a temp
 * directory, keeps one session appending in real time, and starts the server against it.
 *
 *   npm run demo            # http://localhost:4317
 *
 * Output is seeded, so the history looks the same on every start (relative to today).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = path.join(os.tmpdir(), 'skill-trace-demo')
const CODE = path.join(HOME, 'code')

// ---------------------------------------------------------------------------------------------
// Seeded randomness

let seed = 0x5eed
function rand() {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const between = (a: number, b: number) => a + rand() * (b - a)
const int = (a: number, b: number) => Math.floor(between(a, b + 1))
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]
const chance = (p: number) => rand() < p
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('')
const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`
const toolId = () => `toolu_${hex(24)}`

// ---------------------------------------------------------------------------------------------
// Projects and skills

const PROJECTS = ['atlas-web', 'billing-api', 'infra', 'notes'] as const
type Project = (typeof PROJECTS)[number]
const cwdOf = (p: Project) => path.join(CODE, p)

/** A moment where the skill stops for the person. */
type Interaction =
  | { ask: { question: string; header: string; options: [string, string][]; multiSelect?: boolean }[]; answers: () => string[]; p?: number }
  | { plan: string; reject?: { p: number; feedback: string }; p?: number }
  | { confirm: string; replies: string[]; p?: number }
  | { steer: string[]; p?: number }

interface Step {
  tool: string
  input: () => Record<string, unknown>
  /** Seconds. */
  dur: [number, number]
  output: () => string
  errorRate?: number
  errorOutput?: () => string
  count?: [number, number]
  /** Chance the person declines this call at the permission prompt, and what they say. */
  reject?: { p: number; reason: string }
}

interface DemoSkill {
  name: string
  source: 'user' | 'project' | 'plugin'
  plugin?: string
  project?: Project
  description: string
  body: string
  files?: Record<string, string>
  /** Relative popularity. */
  weight: number
  prompts: string[]
  slashArgs?: string[]
  projects: Project[]
  notes: string[]
  flow: (Step | Interaction)[]
  /** Final replies, markdown. */
  conclusions: string[]
}

const files = ['src/app/router.tsx', 'src/components/Invoice.tsx', 'src/lib/money.ts', 'src/api/client.ts', 'src/hooks/useBilling.ts', 'package.json', 'src/server/handlers.ts']
const read = (paths = files): Step => ({
  tool: 'Read',
  input: () => ({ file_path: pick(paths) }),
  dur: [0.02, 0.09],
  output: () => '     1\timport { z } from "zod"\n     2\t\n     3\texport const Invoice = z.object({ id: z.string(), total: z.number() })\n',
  count: [1, 4],
})
const grep = (patterns: string[]): Step => ({
  tool: 'Grep',
  input: () => ({ pattern: pick(patterns), path: 'src' }),
  dur: [0.05, 0.4],
  output: () => `src/lib/money.ts:14\nsrc/api/client.ts:${int(10, 200)}`,
  count: [1, 2],
})
const bash = (
  description: string,
  command: string,
  dur: [number, number],
  output: string,
  errorRate = 0,
  errorOutput = 'Error: process exited with code 1',
  reject?: Step['reject'],
): Step => ({
  tool: 'Bash',
  input: () => ({ command, description }),
  dur,
  output: () => output,
  errorRate,
  errorOutput: () => errorOutput,
  reject,
})
/** A Write that creates `file_path` with `content`. */
const create = (file_path: string, content: string): Step => ({
  tool: 'Write',
  input: () => ({ file_path, content }),
  dur: [0.02, 0.07],
  output: () => `File created successfully at: ${file_path}`,
})
/** An Edit replacing `old_string` with `new_string`. */
const edit = (file_path: string, old_string: string, new_string: string): Step => ({
  tool: 'Edit',
  input: () => ({ file_path, old_string, new_string }),
  dur: [0.02, 0.06],
  output: () => `The file ${file_path} has been updated successfully.`,
})
const mcp = (tool: string, input: () => Record<string, unknown>, dur: [number, number] = [0.4, 2.5]): Step => ({
  tool,
  input,
  dur,
  output: () => '{"ok": true}',
})

const SKILLS: DemoSkill[] = [
  {
    name: 'pr-review',
    source: 'user',
    description: 'Review a pull request against the team checklist: correctness, tests, naming, and risky migrations. Posts inline comments on GitHub.',
    weight: 9,
    projects: ['atlas-web', 'billing-api'],
    prompts: ['帮我 review 一下 #482', 'review PR 1371, focus on the migration', '看看这个 PR 有没有问题 https://github.com/acme/atlas-web/pull/519', 'Review the open PR on this branch'],
    slashArgs: ['482', '1371', '519'],
    notes: ['先拉 diff。', 'money 相关的 helper 改了，逐个检查调用方。'],
    flow: [
      bash('Fetch the PR diff', 'gh pr diff 482', [0.8, 2.4], 'diff --git a/src/lib/money.ts b/src/lib/money.ts\n@@ -12,7 +12,9 @@'),
      read(),
      grep(['formatMoney', 'toCents(', 'useBilling']),
      { tool: 'Agent', input: () => ({ description: 'Check test coverage for changed files', subagent_type: 'Explore' }), dur: [18, 55], output: () => 'Coverage is missing for the rounding branch in toCents().', count: [0, 1] },
      {
        ask: [
          {
            question: '发现 2 个需要处理的问题，怎么反馈给作者？',
            header: '反馈方式',
            options: [
              ['逐行评论', '在 PR 对应行上留 inline comment'],
              ['只给我总结', '不在 GitHub 上留痕，我自己去沟通'],
              ['评论并 Request changes', '阻止合并直到修复'],
            ],
          },
        ],
        answers: () => [pick(['逐行评论', '逐行评论', '只给我总结', '评论并 Request changes', '逐行评论，但语气温和一点，是新同学'])],
        p: 0.85,
      },
      mcp('mcp__github__add_comment_to_pending_review', () => ({ path: 'src/lib/money.ts', line: int(10, 80), body: 'Rounding here drops sub-cent values.' })),
    ],
    conclusions: [
      `## Review：#482 fix rounding in invoices

**结论：需要修改后再合并**

| 级别 | 位置 | 问题 |
|---|---|---|
| 🔴 阻塞 | \`src/lib/money.ts:41\` | \`toCents()\` 用 \`Math.floor\`，负数金额会多扣 1 分 |
| 🟡 建议 | \`src/hooks/useBilling.ts:88\` | 新分支没有测试覆盖 |

已在 PR 上留了 2 条 inline comment。修完后我可以再看一遍。`,
      `## Review summary

The change is correct for positive totals but **breaks refunds**: \`toCents(-0.015)\` returns \`-2\`.

- Blocking: rounding mode in \`money.ts\`
- Nice to have: a table-driven test for \`toCents\`

Comments are posted as a pending review.`,
    ],
    body: `# PR review

Review the pull request the way a careful senior engineer on this team would.

## Checklist

1. **Correctness** — trace every changed function to its callers.
2. **Tests** — new branches need a test; flaky patterns get flagged.
3. **Migrations** — anything that locks a table over 1M rows is a blocker.
4. **Naming** — follow \`docs/naming.md\`.

## Before posting

Ask how the findings should be delivered (inline comments, summary only, or request changes).

\`\`\`bash
gh pr diff "$PR" --patch > /tmp/pr.patch
\`\`\`

> Never approve. A human approves.
`,
    files: { 'checklist.md': '# Checklist\n\n- [ ] Correctness\n- [ ] Tests\n', 'scripts/fetch-diff.sh': '#!/usr/bin/env bash\ngh pr diff "$1" --patch\n' },
  },
  {
    name: 'release-notes',
    source: 'user',
    description: 'Draft release notes from merged PRs since the last tag, grouped by area, in the house voice.',
    weight: 5,
    projects: ['atlas-web', 'billing-api'],
    prompts: ['写一下这次的 release notes', 'Draft release notes for this week', '生成本周的更新日志'],
    slashArgs: ['v2.4.0', 'v2.5.0', 'v1.18.2'],
    notes: ['先找上一个 tag。', '23 个 PR 按领域分组。'],
    flow: [
      bash('Find the previous release tag', 'git describe --tags --abbrev=0', [0.1, 0.4], 'v2.3.1'),
      bash('List merged PRs since the tag', 'gh pr list --state merged --search "merged:>2026-10-01" --json number,title,labels', [1.2, 3.5], '[{"number":482,"title":"Fix rounding in invoices"}]'),
      {
        ask: [
          { question: '这次版本号怎么升？', header: '版本', options: [['v2.4.0', 'minor：有 3 个新功能'], ['v2.3.2', 'patch：只算修复'], ['v3.0.0', 'major：账单 API 有破坏性变更']] },
          { question: '要包含哪些分组？', header: '分组', multiSelect: true, options: [['Features', '新功能'], ['Fixes', '问题修复'], ['Internal', '重构、依赖升级']] },
        ],
        answers: () => [pick(['v2.4.0', 'v2.4.0', 'v2.3.2']), pick(['Features, Fixes', 'Features, Fixes, Internal'])],
      },
      read(['CHANGELOG.md', 'docs/voice.md']),
      edit(
        'CHANGELOG.md',
        '# Changelog\n',
        '# Changelog\n\n## v2.4.0 — 2026-10-16\n\n### Features\n- Invoices can be exported as PDF from the billing page\n- Plan cards show the yearly price next to the monthly one\n- New `currency` field on invoices\n\n### Fixes\n- Totals no longer drop sub-cent amounts on refunds\n- The billing page keeps its scroll position after saving\n',
      ),
      { confirm: '已写入 CHANGELOG.md。要我顺便打上 `v2.4.0` tag 并推送吗？', replies: ['好', '确认', '先不用，我自己打'], p: 0.8 },
    ],
    conclusions: [
      `## v2.4.0 release notes 已就绪

写入了 \`CHANGELOG.md\`，共 **5 条**：3 个新功能、2 个修复。

> Invoices can be exported as PDF from the billing page.

亮点放在了第一条；内部重构按你的选择没有列出。`,
      `Release notes for **v2.4.0** are in \`CHANGELOG.md\` — 3 features, 2 fixes, grouped and written in the house voice.`,
    ],
    body: `# Release notes

Turn merged pull requests into release notes people actually read.

## Steps

- Find the previous tag with \`git describe --tags\`.
- Ask which version to cut and which sections to include.
- Write one line per change, user-facing language, no PR jargon.
- Offer to tag the release; never push a tag without a yes.
`,
    files: { 'templates/release.md': '## {{version}}\n\n### Features\n\n### Fixes\n' },
  },
  {
    name: 'db-migrate',
    source: 'user',
    description: 'Write and dry-run a Postgres migration, checking lock impact before anything touches production.',
    weight: 4,
    projects: ['billing-api'],
    prompts: ['给 invoices 表加一个 currency 字段', 'Add an index on payments(customer_id, created_at)', 'migrate: split address into its own table'],
    notes: ['先看现有 schema。'],
    flow: [
      read(['db/schema.sql', 'db/migrations/0042_payments.sql']),
      {
        plan: '## Migration plan\n\n1. `ALTER TABLE invoices ADD COLUMN currency char(3)` (nullable, no default)\n2. Backfill `currency = \'USD\'`\n3. `SET NOT NULL` after the backfill\n\nEstimated lock: < 200ms on 4.2M rows.',
        reject: { p: 0.45, feedback: '第 2 步别一次性 UPDATE，按 1 万行一批 backfill' },
      },
      create('db/migrations/0043_invoice_currency.sql', "ALTER TABLE invoices ADD COLUMN currency char(3);\n\n-- backfill in batches of 10k\nDO $$\nBEGIN\n  LOOP\n    UPDATE invoices SET currency = 'USD'\n    WHERE id IN (SELECT id FROM invoices WHERE currency IS NULL LIMIT 10000);\n    EXIT WHEN NOT FOUND;\n  END LOOP;\nEND $$;\n\nALTER TABLE invoices ALTER COLUMN currency SET NOT NULL;\n"),
      bash('Dry-run the migration', 'npm run db:migrate -- --dry-run', [2, 7], 'Would apply 0043_invoice_currency.sql (est. lock 120ms)', 0.25, 'error: column "currency" of relation "invoices" already exists'),
      { confirm: '干跑通过，预计锁表 120ms。要在 dev 库上执行吗？', replies: ['确认', '执行', '好的'] },
      bash('Apply to the dev database', 'npm run db:migrate', [1.5, 5], 'Applied 1 migration.'),
    ],
    conclusions: [
      `## 迁移已在 dev 库执行

- 新文件 \`db/migrations/0043_invoice_currency.sql\`
- 按你的要求 **每批 1 万行** backfill，4.2M 行约 7 分钟
- 实测锁表 **118ms**

上生产前建议在 staging 再跑一次 \`npm run db:migrate -- --dry-run\`。`,
    ],
    body: `# Database migrations

Every migration is written, dry-run and lock-checked before it is applied.

## Rules

- Propose the plan first and wait for approval.
- Large tables (> 1M rows): add columns as nullable, backfill in batches.
- Confirm before applying to any database.

\`\`\`sql
ALTER TABLE invoices ADD COLUMN currency char(3);
\`\`\`
`,
    files: { 'scripts/lock-check.sql': 'SELECT relation::regclass, mode FROM pg_locks;\n' },
  },
  {
    name: 'incident-triage',
    source: 'user',
    description: 'First 10 minutes of an incident: pull logs, correlate deploys, find the blast radius, and draft the status update.',
    weight: 3,
    projects: ['infra'],
    prompts: ['checkout-api 5xx 飙升，帮我看看', 'Latency alert on payments, triage it', '线上 OOM 了，查一下原因'],
    notes: ['拉最近 15 分钟日志。', '错误峰值和 14:02 的发布时间吻合。'],
    flow: [
      bash('Tail error logs from the last 15 minutes', 'kubectl logs deploy/checkout-api --since=15m | grep -i error', [2, 9], 'ERROR upstream timeout after 3000ms (x412)', 0.15, 'error: You must be logged in to the server (Unauthorized)'),
      bash('List recent deploys', 'kubectl rollout history deploy/checkout-api', [0.6, 2], 'REVISION  CHANGE-CAUSE\n41  deploy 2f9c1e'),
      { steer: ['顺便看下 payments 服务有没有被连带影响', '先别动生产，只读排查'], p: 0.4 },
      grep(['timeout', 'retry_budget']),
      { tool: 'Agent', input: () => ({ description: 'Compare config between revisions 40 and 41', subagent_type: 'general-purpose' }), dur: [25, 70], output: () => 'Revision 41 lowered the upstream timeout from 5s to 3s.', count: [0, 1] },
      bash('Roll back to revision 40', 'kubectl rollout undo deploy/checkout-api --to-revision=40', [3, 8], 'deployment.apps/checkout-api rolled back', 0, '', { p: 0.55, reason: '先别回滚，我在跟值班同学确认影响面' }),
      {
        ask: [{ question: '事故等级定为？', header: '等级', options: [['SEV2', '部分用户结账失败'], ['SEV3', '性能下降，无数据损失'], ['SEV1', '全站不可用']] }],
        answers: () => [pick(['SEV2', 'SEV2', 'SEV3'])],
      },
      create('incidents/2026-10-checkout.md', '# Checkout 5xx — 2026-10-16\n\n**Severity:** SEV2\n**Started:** 14:05 UTC\n\n## Timeline\n- 14:02 deploy 2f9c1e (revision 41)\n- 14:05 5xx rate 12%\n\n## Suspected cause\nUpstream timeout lowered from 5s to 3s in revision 41.\n'),
    ],
    conclusions: [
      `## 初步结论（SEV2）

**根因（高置信）**：revision 41 把上游超时从 5s 调到 3s，支付网关 p99 是 3.4s。

| 时间 | 事件 |
|---|---|
| 14:02 | 发布 2f9c1e |
| 14:05 | 5xx 升至 12% |

回滚命令已准备好，等你确认后执行。状态更新草稿：

> [Investigating] Elevated errors on checkout since 14:05 UTC. Next update in 30 minutes.`,
    ],
    body: `# Incident triage

You are on call. Be fast and factual; never guess at root cause in the status update.

## First ten minutes

1. Logs for the affected service, last 15 minutes.
2. Deploys and config changes in the last 2 hours.
3. Ask for the severity before writing the status update.

Never roll back without an explicit yes.
`,
    files: { 'runbooks/k8s.md': '# Kubernetes\n\n`kubectl logs`, `kubectl rollout undo`\n', 'templates/status.txt': '[Investigating] ...\n' },
  },
  {
    name: 'weekly-report',
    source: 'user',
    description: 'Compile the weekly engineering report from Linear, GitHub and Notion into the team template.',
    weight: 2,
    projects: ['notes'],
    prompts: ['写这周的周报', 'Weekly report please', '整理一下本周进展发到 Notion'],
    notes: ['汇总关闭的 issue 和合并的 PR。'],
    flow: [
      mcp('mcp__linear__list_issues', () => ({ state: 'done', updatedAfter: '-7d' })),
      bash('List merged PRs this week', 'gh search prs --merged ">=2026-10-09" --author @me', [1, 3], '12 pull requests'),
      { steer: ['记得把上周遗留的 billing 风险也写进去'], p: 0.5 },
      { tool: 'WebFetch', input: () => ({ url: 'https://status.acme.dev/api/uptime?range=7d' }), dur: [0.8, 3], output: () => '99.97%' },
      {
        ask: [{ question: '发到 Notion 哪里？', header: '位置', options: [['Weekly reports', '团队周报数据库'], ['我的草稿', '先放私人页面'], ['不发 Notion', '只在这里给我']] }],
        answers: () => [pick(['Weekly reports', 'Weekly reports', '我的草稿'])],
      },
      mcp('mcp__notion__notion-create-pages', () => ({ parent: 'Weekly reports', title: 'Week 42' }), [1, 3]),
    ],
    conclusions: [
      `## Week 42 周报已发布到 Notion

**Shipped**
- 发票 PDF 导出（#482、#490）
- 结账超时问题修复

**Risks**
- billing 迁移还差 staging 验证（上周遗留）

**Numbers**：12 个 PR 合并 · 9 个 issue 关闭 · 可用性 99.97%`,
    ],
    body: `# Weekly report

Sections: **Shipped**, **In flight**, **Risks**, **Numbers**.
Keep each bullet under 15 words. Link every item. Ask where to publish.
`,
  },
  {
    name: 'figma-to-react',
    source: 'project',
    project: 'atlas-web',
    description: 'Turn a Figma frame into React components that use our design tokens and pass the visual test.',
    weight: 6,
    projects: ['atlas-web'],
    prompts: ['把这个 Figma 设计稿转成组件 https://figma.com/design/x1/Atlas?node-id=42', 'Implement the new billing settings screen from Figma', '实现一下设置页的新卡片样式'],
    notes: ['读设计稿和它用到的 token。'],
    flow: [
      mcp('mcp__figma__get_design_context', () => ({ nodeId: `${int(1, 90)}:${int(1, 400)}` }), [1.5, 4]),
      read(['src/styles/tokens.css', 'src/components/Card.tsx']),
      { plan: '## Plan\n\n- `PlanCard` (new) — price, features, CTA\n- `BillingSettings` — grid of PlanCards + current plan banner\n- Visual snapshot test for both themes', p: 0.6 },
      {
        ask: [{ question: '移动端 PlanCard 怎么排？', header: '移动端', options: [['纵向堆叠', '一屏一张，最稳'], ['横向滑动', '像设计稿里的轮播'], ['折叠成列表', '只显示价格和按钮']] }],
        answers: () => [pick(['纵向堆叠', '横向滑动', '横向滑动，但要有分页圆点'])],
        p: 0.7,
      },
      create('src/components/PlanCard.tsx', "import { tokens } from '../styles/tokens'\n\nexport function PlanCard({ plan }: { plan: Plan }) {\n  return (\n    <article className=\"plan-card\">\n      <h3>{plan.name}</h3>\n      <p className=\"price\">{plan.price}</p>\n      <button>Choose</button>\n    </article>\n  )\n}\n"),
      edit('src/components/BillingSettings.tsx', '  <CurrentPlan />\n', '  <CurrentPlan />\n  <div className="plan-grid">\n    {plans.map((p) => <PlanCard key={p.id} plan={p} />)}\n  </div>\n'),
      bash('Run the visual tests', 'npm run test:visual -- PlanCard', [6, 22], '✓ 4 snapshots match', 0.2, '✕ PlanCard › matches snapshot (diff 2.4%)'),
    ],
    conclusions: [
      `## 设置页卡片已实现

- 新组件 \`PlanCard\`，颜色和间距全部来自 tokens
- \`BillingSettings\` 改为卡片网格
- 视觉测试 **4/4 通过**（亮色 + 暗色，1x + 2x）

移动端按你选的方式实现。`,
    ],
    body: `# Figma to React

Components must use tokens from \`src/styles/tokens.css\`; never hard-code a color or spacing value.

## Done means

- Matches the frame at 1x and 2x.
- Has a visual snapshot test.
- Works in dark mode.
`,
    files: { 'tokens-map.json': '{ "Primary/500": "--accent" }\n' },
  },
  {
    name: 'frontend-design',
    source: 'plugin',
    plugin: 'design-kit',
    description: 'Create distinctive, production-grade frontend interfaces with high design quality.',
    weight: 3,
    projects: ['atlas-web'],
    prompts: ['做一个 pricing 页面，要有设计感', 'Make the empty state feel less generic'],
    notes: [],
    flow: [
      {
        ask: [{ question: '选一个设计方向', header: '方向', options: [['Editorial', '衬线标题、大留白'], ['Brutalist', '粗边框、等宽字体'], ['Soft UI', '柔和阴影、圆角']] }],
        answers: () => [pick(['Editorial', '偏 Editorial，但按钮要更圆一点', 'Brutalist'])],
      },
      read(['src/app/pricing/page.tsx']),
      create('src/app/pricing/pricing.css', '.pricing h1 { font-family: "Instrument Serif"; font-size: 64px; }\n'),
      bash('Start the dev server and screenshot', 'npm run shot -- /pricing', [3, 8], 'saved shot.png'),
    ],
    conclusions: ['## Pricing 页面完成\n\n采用你选的方向：衬线大标题 + 大留白，三个方案卡片等高对齐。截图在 `shot.png`。'],
    body: `# Frontend design

Commit to a clear aesthetic direction before writing code. Typography first, then color, then motion.
`,
  },
  {
    name: 'commit-helper',
    source: 'plugin',
    plugin: 'git-kit',
    description: 'Write conventional commit messages from the staged diff.',
    weight: 4,
    projects: ['atlas-web', 'billing-api', 'infra'],
    prompts: ['提交一下', 'commit this', 'write the commit message'],
    notes: [],
    flow: [
      bash('Show the staged diff', 'git diff --staged --stat', [0.1, 0.4], ' 3 files changed, 41 insertions(+)'),
      { confirm: '提交信息：\n\n`fix(billing): round invoice totals to cents`\n\n确认提交吗？', replies: ['确认', 'ok', 'y', '好'] },
      bash('Commit', 'git commit -m "fix(billing): round invoice totals to cents"', [0.2, 0.8], '[main 2f9c1e] fix(billing): round invoice totals'),
    ],
    conclusions: ['已提交 `2f9c1e`：**fix(billing): round invoice totals to cents**（3 个文件，+41）。', 'Committed `2f9c1e`.'],
    body: '# Commit helper\n\nConventional commits. Subject under 60 characters, imperative mood. Show the message and wait for a yes.\n',
  },
  {
    name: 'api-docs',
    source: 'user',
    description: 'Generate reference docs for HTTP handlers from their zod schemas.',
    weight: 0,
    projects: [],
    prompts: [],
    notes: [],
    flow: [],
    conclusions: [],
    body: '# API docs\n\nRead each handler, derive the request and response shape from its zod schema.\n',
  },
  {
    name: 'i18n-sync',
    source: 'plugin',
    plugin: 'git-kit',
    description: 'Find untranslated strings and sync locale files.',
    weight: 0,
    projects: [],
    prompts: [],
    notes: [],
    flow: [],
    conclusions: [],
    body: '# i18n sync\n\nKeep every locale file in step with en.json.\n',
  },
]

function skillDir(s: DemoSkill) {
  if (s.source === 'project') return path.join(cwdOf(s.project!), '.claude', 'skills', s.name)
  if (s.source === 'plugin') return path.join(HOME, 'plugins', 'cache', 'demo', s.plugin!, '1.0.0', 'skills', s.name)
  return path.join(HOME, 'skills', s.name)
}

function writeSkills() {
  const plugins: Record<string, { installPath: string }[]> = {}
  for (const s of SKILLS) {
    const dir = skillDir(s)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${s.name}\ndescription: ${s.description}\n---\n\n${s.body}`)
    for (const [rel, content] of Object.entries(s.files ?? {})) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
      fs.writeFileSync(path.join(dir, rel), content)
    }
    if (s.plugin) plugins[`${s.plugin}@demo`] = [{ installPath: path.join(HOME, 'plugins', 'cache', 'demo', s.plugin, '1.0.0') }]
  }
  fs.writeFileSync(path.join(HOME, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }, null, 2))
}

// ---------------------------------------------------------------------------------------------
// Transcript generation

interface Timed {
  at: number
  rec: Record<string, unknown>
}

function invokeName(s: DemoSkill) {
  return s.plugin ? `${s.plugin}:${s.name}` : s.name
}

/** Records for one prompt → skill → tools → reply turn, starting at `t0` (ms). */
function generateRun(s: DemoSkill, project: Project, sessionId: string, t0: number): { records: Timed[]; end: number } {
  const cwd = cwdOf(project)
  const base = { isSidechain: false, sessionId, cwd, version: '2.1.301', gitBranch: 'main', userType: 'external' }
  const out: Timed[] = []
  let t = t0
  let parent: string | null = null
  let cacheRead = int(18_000, 40_000)
  const push = (rec: Record<string, unknown>) => {
    const uuid_ = uuid()
    out.push({ at: t, rec: { parentUuid: parent, ...base, ...rec, uuid: uuid_, timestamp: new Date(t).toISOString() } })
    parent = uuid_
  }
  const usage = (output: number) => {
    cacheRead += int(800, 6000)
    return { input_tokens: int(2, 40), output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: int(200, 3000) }
  }
  const assistant = (id: string, content: unknown[], stop: string, output: number) =>
    push({ type: 'assistant', message: { model: 'claude-opus-5-5', id, type: 'message', role: 'assistant', content, stop_reason: stop, usage: usage(output) } })

  const slash = s.slashArgs && chance(0.3)
  if (slash) {
    const args = pick(s.slashArgs!)
    push({ type: 'user', message: { role: 'user', content: `<command-message>${s.name}</command-message>\n<command-name>/${invokeName(s)}</command-name>\n<command-args>${args}</command-args>` } })
  } else {
    push({ type: 'user', message: { role: 'user', content: pick(s.prompts) } })
    t += between(2, 6) * 1000
    const id = `msg_${hex(24)}`
    const tid = toolId()
    assistant(id, [{ type: 'tool_use', id: tid, name: 'Skill', input: { skill: invokeName(s) } }], 'tool_use', int(40, 120))
    t += between(0.2, 0.6) * 1000
    push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: `Launching skill: ${s.name}` }] }, toolUseResult: { success: true, commandName: s.name } })
  }
  push({ type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: `Base directory for this skill: ${skillDir(s)}\n\n${s.body}` }] } })

  const REJECTED = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file)."
  const human = (min: number, max: number) => (t += between(min, max) * 1000) // the person reading and deciding

  let noteIdx = 0
  for (const step of s.flow) {
    if (!('tool' in step)) {
      if (step.p !== undefined && !chance(step.p)) continue
      t += between(1.5, 6) * 1000
      if ('ask' in step) {
        const tid = toolId()
        const questions = step.ask.map((q) => ({ ...q, multiSelect: q.multiSelect ?? false, options: q.options.map(([label, description]) => ({ label, description })) }))
        assistant(`msg_${hex(24)}`, [{ type: 'tool_use', id: tid, name: 'AskUserQuestion', input: { questions } }], 'tool_use', int(120, 400))
        human(8, 70)
        const chosen = step.answers()
        const answers = Object.fromEntries(step.ask.map((q, i) => [q.question, chosen[i]]))
        const content = `The user answered: ${Object.entries(answers).map(([q, a]) => `"${q}"="${a}"`).join(', ')}. You can now continue.`
        push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content }] }, toolUseResult: { questions, answers } })
      } else if ('plan' in step) {
        const tid = toolId()
        assistant(`msg_${hex(24)}`, [{ type: 'tool_use', id: tid, name: 'ExitPlanMode', input: { plan: step.plan } }], 'tool_use', int(300, 900))
        human(15, 90)
        if (step.reject && chance(step.reject.p)) {
          push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, is_error: true, content: `${REJECTED} To tell you how to proceed, the user said:\n${step.reject.feedback}` }] } })
          t += between(4, 10) * 1000
          const rid = toolId()
          assistant(`msg_${hex(24)}`, [{ type: 'text', text: '明白，按你的意见调整了计划。' }, { type: 'tool_use', id: rid, name: 'ExitPlanMode', input: { plan: `${step.plan}\n\n_Revised: ${step.reject.feedback}_` } }], 'tool_use', int(300, 900))
          human(8, 40)
          push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: rid, content: 'User has approved your plan. You can now start coding.' }] } })
        } else {
          push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: 'User has approved your plan. You can now start coding.' }] } })
        }
      } else if ('confirm' in step) {
        assistant(`msg_${hex(24)}`, [{ type: 'text', text: step.confirm }], 'end_turn', int(80, 300))
        human(10, 120)
        push({ type: 'user', message: { role: 'user', content: pick(step.replies) } })
      } else if ('steer' in step) {
        const prompt = pick(step.steer)
        push({ type: 'attachment', attachment: { type: 'queued_command', prompt, commandMode: 'prompt', origin: { kind: 'human' } } })
      }
      continue
    }
    const [lo, hi] = step.count ?? [1, 1]
    for (let n = int(lo, hi); n > 0; n--) {
      t += between(1.2, 8) * 1000 // model thinking between calls
      const id = `msg_${hex(24)}`
      const tid = toolId()
      if (chance(0.5)) assistant(id, [{ type: 'thinking', thinking: '', signature: 'x' }], 'tool_use', int(60, 400))
      if (s.notes[noteIdx] && chance(0.55)) assistant(id, [{ type: 'text', text: s.notes[noteIdx++] }], 'tool_use', int(60, 400))
      assistant(id, [{ type: 'tool_use', id: tid, name: step.tool, input: step.input() }], 'tool_use', int(60, 400))
      if (step.reject && chance(step.reject.p)) {
        human(4, 30)
        push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, is_error: true, content: `${REJECTED} To tell you how to proceed, the user said:\n${step.reject.reason}` }] } })
        t += between(2, 5) * 1000
        assistant(`msg_${hex(24)}`, [{ type: 'text', text: '好，先不执行这一步。' }], 'tool_use', int(40, 120))
        continue
      }
      t += between(...step.dur) * 1000
      const failed = chance(step.errorRate ?? 0)
      push({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: failed ? step.errorOutput!() : step.output(), is_error: failed }] },
      })
      // A failed step is usually retried once after a short look.
      if (failed && chance(0.7)) {
        t += between(2, 6) * 1000
        const rid = toolId()
        assistant(`msg_${hex(24)}`, [{ type: 'text', text: '失败了，调整参数后重试。' }, { type: 'tool_use', id: rid, name: step.tool, input: step.input() }], 'tool_use', int(80, 300))
        t += between(...step.dur) * 1000
        push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: rid, content: step.output() }] } })
      }
    }
  }
  t += between(3, 12) * 1000
  assistant(`msg_${hex(24)}`, [{ type: 'text', text: pick(s.conclusions) }], 'end_turn', int(200, 1400))
  return { records: out, end: t }
}

function pickSkill(project?: Project): DemoSkill {
  const pool = SKILLS.filter((s) => s.weight > 0 && (!project || s.projects.includes(project)))
  const total = pool.reduce((n, s) => n + s.weight, 0)
  let r = rand() * total
  for (const s of pool) if ((r -= s.weight) < 0) return s
  return pool[0]
}

const projectDir = (p: Project) => path.join(HOME, 'projects', cwdOf(p).replace(/[/\\.]/g, '-'))

// Working-hours rhythm: busy late morning and afternoon, a few evenings.
const HOURS = [9, 10, 10, 11, 11, 11, 14, 14, 15, 15, 16, 16, 17, 18, 21, 22]

function writeHistory() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
    const day = new Date(today)
    day.setDate(day.getDate() - daysAgo)
    const weekend = day.getDay() === 0 || day.getDay() === 6
    // Usage grows over the month as more skills get written.
    const sessions = weekend ? int(0, 1) : int(1, 3) + (daysAgo < 10 ? int(0, 2) : 0)
    for (let i = 0; i < sessions; i++) {
      const project = pick(PROJECTS)
      const sessionId = uuid()
      let t = day.getTime() + (pick(HOURS) * 60 + int(0, 59)) * 60_000
      if (t > Date.now() - 20 * 60_000) continue
      const lines: Timed[] = []
      for (let r = int(1, 3); r > 0; r--) {
        const { records, end } = generateRun(pickSkill(project), project, sessionId, t)
        lines.push(...records)
        t = end + between(60, 900) * 1000
      }
      const file = path.join(projectDir(project), `${sessionId}.jsonl`)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, lines.map((l) => JSON.stringify(l.rec)).join('\n') + '\n')
      const last = new Date(lines[lines.length - 1].at)
      fs.utimesSync(file, last, last)
    }
  }
}

/** One session that keeps producing skill runs in real time. */
function startLiveSession() {
  const project: Project = 'atlas-web'
  const sessionId = uuid()
  const file = path.join(projectDir(project), `${sessionId}.jsonl`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '')

  const loop = () => {
    // Compress the run so a full one plays out in about a minute.
    const start = Date.now() + 1500
    const { records } = generateRun(pickSkill(project), project, sessionId, start)
    const span = records[records.length - 1].at - start
    const scale = Math.min(1, 60_000 / Math.max(1, span))
    for (const { at, rec } of records) {
      const when = start + (at - start) * scale
      rec.timestamp = new Date(when).toISOString()
      setTimeout(() => fs.appendFileSync(file, JSON.stringify(rec) + '\n'), when - Date.now())
    }
    setTimeout(loop, span * scale + between(8, 15) * 1000)
  }
  loop()
}

// ---------------------------------------------------------------------------------------------

fs.rmSync(HOME, { recursive: true, force: true })
for (const p of PROJECTS) fs.mkdirSync(cwdOf(p), { recursive: true })
fs.mkdirSync(path.join(HOME, 'plugins'), { recursive: true })
writeSkills()
writeHistory()

process.env.SKILL_TRACE_CLAUDE_HOME = HOME
await import('../server/index.ts')
if (!process.argv.includes('--static')) startLiveSession()
console.log(`             demo data in ${HOME}${process.argv.includes('--static') ? '' : ' (one session is live)'}`)
