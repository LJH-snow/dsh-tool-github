# dsh-tool-github 开发文档

> 本文档是项目的**单一真源**：先写文档，再照文档开发；每次开发推进后同步更新本文档（含时间戳的进度日志），保证文档始终与代码现状一致。

## 1. 项目概览

| 项 | 内容 |
|---|---|
| 项目名 | `dsh-tool-github` |
| 定位 | DeepSeek Harness（dsh）的**独立 GitHub 工具插件**（Cordis 插件） |
| 发布名 | `@<your-scope>/dsh-tool-github`（发布前替换 scope） |
| 架构 | 一切皆插件：通过 `ctx.tools.register(defineTool(...))` 注册模型可见工具 |
| 官方参考 | `docs/cookbook/adding-a-tool.md`、`packages/shell/tool-bash`、`docs/cordis-tutorial/` |
| 项目位置 | 本目录（与官方仓库 `deepseek-harness/` 平级，**不污染官方仓库**） |

### 1.1 目标
- 让 dsh Agent 能通过自然语言操作 GitHub：查仓库、查 Issue、搜代码、建 PR 草稿等。
- 完全符合官方 `defineTool` 契约（类型化参数、规范输出、纯函数 UI 呈现、尊重 `exec.signal`）。
- 可发布到 npm、可被 dsh 组合配置加载、可加 `dsh-plugin` topic 进入生态。

### 1.2 范围（v0.1 骨架）
| 工具名 | 功能 | 状态 |
|---|---|---|
| `github_get_repo` | 查询仓库元信息（描述、star、语言、license） | 待开发 |
| `github_search_repos` | 按关键词搜索仓库 | ✅ 已实现 |
| `github_list_issues` | 列出仓库 issue（支持 state/label 过滤） | ✅ 已实现 |
| `github_search_code` | 搜索代码（需认证；未配置 token 返回明确业务值） | ✅ 已实现 |
| `github_create_pr_draft` | 创建 PR 草稿（422 映射业务失败值） | ✅ 已实现 |

**不在范围内**：修改代码文件、合并 PR、管理仓库设置（后续版本考虑）。

## 2. 技术背景（契约要点，来自官方 adding-a-tool.md）

### 2.1 插件最小形状
```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Read a file from disk.',
    parameters: { path: { type: 'string', required: true, description: 'Absolute path' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) { /* args 已按 schema 校验；返回规范 JSON 值 */ },
  }))
}
```

### 2.2 必须遵守的规则
1. **参数自动校验**：`defineTool` 会在 `execute` 前按 schema 校验（类型/必填/字面量/联合/嵌套）；schema 表达不了的（非空字符串、正数、跨字段）在 execute 里手检。
2. **输出一个规范 JSON 值**：`output.schema` 声明根类型；不要返回 Markdown 给模型——人类可读内容放 `output.render`。
3. **抛错 = isError**：基础设施失败就 throw；业务性"不理想状态"用规范值表达（如 PR 已存在返回 `{ created: false, reason }`）。
4. **尊重 `exec.signal`**：取消时中止在途请求（fetch 用 `signal`）。
5. **UI 呈现是纯函数**：`presentCall` / `presentResult` 只允许纯函数（禁止 I/O、时钟、随机数），因为会在回放时执行。工具 UI 卡片类型：`generic` / `terminal` / `diff` / `search` / `web`；GitHub 工具用 `generic` + `search`（搜索结果）。
6. **注册即副作用**：插件 fiber 释放时工具自动注销；不要在注册后修改 schema。

### 2.3 依赖
- 运行时 peer：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`（官方发布在 npm，版本 `0.1.0-rc.*`）
- 认证：插件配置 `token`（GitHub PAT，只读 scope 优先），走 `ctx` 配置注入；不落盘、不打印。

## 3. 开发计划（阶段与验收）

### 阶段 0：文档先行（本文档）
- [x] 研读官方 `adding-a-tool.md` 与 `tool-bash` 参考包
- [x] 编写本开发文档
- 验收：文档覆盖技术契约、脚手架、测试、发布、日志。

### 阶段 1：脚手架
- [x] `package.json`（type: module，exports 指向 lib，peerDeps cordis/dsh-tools）
- [x] `tsconfig.json`（module: NodeNext，strict，declaration，outDir lib/）
- [x] 最小可加载插件：注册 `github_get_repo`（直连 GitHub REST API，fetch 可注入）
- [x] 验收：`tsc --noEmit` 通过；vitest 4 个单测通过（mock fetch）；`node` 加载产物确认导出 apply/inject/name。

### 阶段 2：核心工具实现
- [x] 实现 `github_search_repos`、`github_list_issues`（支持过滤参数）
- [x] `github_search_code`（认证必填，未配置 token 时返回 `{ authenticated: false }` 业务值）
- [x] `github_create_pr_draft`（POST draft:true；422 映射为 `{ created: false, reason }`）
- [x] 统一 GitHub REST 客户端封装（base url、headers、超时 15s 可配、401/403/404/422 错误映射、POST 支持、`AbortSignal` 合并）
- [x] 验收：18 个单测全过（client 11 + tools 7）；错误路径 401/403/404/422 均有测试；`tsc --noEmit` 通过；build 产物可加载（导出 apply/createTools/inject/name）。

### 阶段 3：UI 呈现与打磨
- [x] `presentCall`/`presentResult` 返回 `generic` 卡片（含 kind 图标）
- [x] `search` 卡片用于代码搜索（`card: 'search', shape: 'paths'`）
- [x] 验收：present 纯函数测试（22/22 全过）；确认 `defineTool` 对 presentCall/presentResult 做 args 软校验，非法 args 返回 undefined 而非抛错（replay 安全）。

### 阶段 4：文档与发布准备
- [x] README（安装、配置 token、组合示例 cordis.yml）
- [x] LICENSE（MIT）
- [x] 发布流程说明：`npm publish` + GitHub topic `dsh-plugin`
- [x] 验收：README 与 5 个工具实际行为一致（22/22 测试佐证）；`npm pack --dry-run` 打包内容正确（lib+types+README 中英+LICENSE，9.0 kB）；本文档日志更新完毕。

## 4. 环境与命令

```sh
# 依赖安装（官方仓库固定 pnpm@11.7.0；本插件独立项目）
pnpm install

# 类型检查
pnpm exec tsc --noEmit

# 测试
pnpm vitest run

# 本地构建
pnpm build
```

## 5. 开发日志（每次推进后追加，带时间戳）

### 2026-08-13（阶段 0）
- 阅读官方 `docs/cookbook/adding-a-tool.md`：确认 `defineTool` 最小形状、execute 契约、UI 呈现纯函数规则。
- 阅读 `packages/shell/tool-bash/package.json`：确认官方工具包结构（src + tests、exports 指向 lib、peerDependencies 声明 cordis/dsh-tools）。
- 建立本目录结构：`src/`、`tests/`、`DEVELOPMENT.md`。
- 决策：插件独立于官方仓库开发（官方暂不接受外部 PR，插件生态是官方推荐路径）。

### 2026-08-13（阶段 1：脚手架完成）
- 建立 `package.json`（type: module、exports 指向 lib、peerDeps cordis/dsh-tools）。
- 建立 `tsconfig.json`（NodeNext、strict、declaration 输出到 lib/types）。
- 实现 `src/client.ts`：`GithubClient`（注入式 fetch、baseUrl/token 配置、401/403/404 错误映射、`AbortSignal` 透传）。
- 实现 `src/index.ts`：插件 `apply(ctx, config)` 注册 `github_get_repo`；404 返回 `{ found: false }`（业务结果用规范值），401/403 抛错（基础设施错误）；`output.render` 输出人类可读文本。
- 编写 `tests/client.spec.ts`：4 个用例（成功/404/401/baseUrl）全过。
- 环境适配：npm 上 `@deepseek-ai/cordis@4.0.1`、`@deepseek-ai/dsh-tools@0.1.0-rc.6`（仓库 workspace 版本号不直接对应 npm 版本）；补装 `@types/node`。
- 验证：typecheck ✅、vitest 4/4 ✅、build ✅、`node -e import(lib)` 导出 `apply/inject/name` ✅。
- 新增 README.md（安装/配置/工具表）、LICENSE（MIT）、.gitignore。

### 2026-08-13（阶段 2：核心工具完成）
- `src/client.ts` 扩展：`searchRepos`（sort/order/perPage + URLSearchParams）、`listIssues`（state/label/perPage）、`searchCode`、`createPrDraft`（POST、draft:true、422→`{created:false,reason}`）、`hasToken()`；`request` 支持 method/body，超时默认 15s（`AbortSignal.timeout` + `AbortSignal.any` 与 exec.signal 合并）。
- `src/index.ts` 重构：提取 `createTools(client)`（导出，便于测试），`apply` 循环注册；新增 4 个工具，全部遵循契约：参数 schema 校验、输出规范 JSON 值、render 纯函数、exec.signal 透传。
- 错误语义：404 → `{found:false}`（业务值）；401/403/其他 → throw（基础设施错误）；search_code 无 token → `{authenticated:false}` 业务值。
- 测试：`tests/client.spec.ts` 11 例（含 403 限流、422 映射、查询串断言、POST body 断言）；`tests/tools.spec.ts` 7 例（5 工具注册齐、404 业务值、未认证提示、limit 上限 20、render 纯函数）。共 18 例全过。
- 验证：typecheck ✅、vitest 18/18 ✅、build ✅、产物导出 apply/createTools ✅。
- README 工具表同步更新（5 个工具 + token 需求列）。

### 2026-08-13（阶段 3：UI 呈现完成）
- 为全部 5 个工具添加 `presentCall`/`presentResult`（纯函数、无 I/O，回放安全）：
  - `github_get_repo`：pending `{card:'generic', kind:'read', title:'Fetch repo a/b'}`；result 显示 `a/b` + stars/language，未找到显示 `Repo not found`。
  - `github_search_repos`：pending `kind:'search'`；result 显示总数 + 列表，空结果显示 `No repos for "..."`。
  - `github_list_issues`：pending `kind:'search'`（含 label 提示）；result 显示条数 + `#n title` 列表。
  - `github_search_code`：pending `kind:'search'`；result 用 `card:'search', shape:'paths'` 卡片（含 truncated/total 信号），未认证显示提示。
  - `github_create_pr_draft`：pending `kind:'edit'`；result 显示 `Draft PR #n` + URL，失败显示原因。
- 发现并记录：`defineTool` 的 presentCall/presentResult 会先对 **args** 做软校验，任何 schema 不匹配都返回 `undefined`（replay 兜底，不抛错）——测试必须传合法 args。
- 测试：新增 4 个 present 用例（pending/result/未认证/失败分支），`tests/tools.spec.ts` 共 11 例；全仓 22/22 通过。
- 验证：typecheck ✅、vitest 22/22 ✅、build ✅、产物导出 apply/createTools ✅（注意：跑 node 验证前必须重新 build，旧 lib 不含 presentCall）。

### 2026-08-13（阶段 4：文档与发布准备完成）
- `README.md` 完善：安装、配置（含 timeoutMs）、5 个工具表 + token 需求、行为约定（业务失败用规范值/基础设施错误抛错/取消可中断）、开发命令、发布与生态说明。
- 新增 `README.en.md`（英文版，面向 npm 全球生态）。
- 新增 `examples/cordis.yml`：组合配置示例（token/baseUrl/timeoutMs 注释齐全）。
- `package.json` 补发布字段：`publishConfig.access: public`、`engines.node >=22.19`、`keywords`（含 `dsh-plugin`）、`repository`/`homepage` 占位（发布前替换为你的仓库）。
- 验证：`npm pack --dry-run` → 打包 8 个文件（lib/client.js、lib/index.js、lib/types/*.d.ts、README 中英、LICENSE、package.json），9.0 kB。注意本机 npm 全局缓存有 root-owned 文件问题，用 `--cache /private/tmp/npm-pack-cache` 绕过；正式发布前建议 `sudo chown -R 502:20 ~/.npm` 修复。
- 发布清单（未执行）：改 scope → `npm run build` → `npm publish --access public` → GitHub 仓库加 `dsh-plugin` topic。

## 6. 风险与决策记录

| 时间 | 决策/风险 | 说明 |
|---|---|---|
| 2026-08-13 | 独立目录开发，不并入官方仓库 | 官方 CONTRIBUTING 明确暂不收外部 PR；插件生态为主路径 |
| 2026-08-13 | 依赖 npm 上的 `@deepseek-ai/*` 发布版 | 官方 rc.5 已发布 npm，无需 workspace |
| - | 风险：npm 网络受限 | 若 pnpm install 失败，考虑从官方仓库 pnpm workspace 内联调试 |
| 2026-08-13 | npm 版本适配：cordis 4.0.1、dsh-tools 0.1.0-rc.6 | 官方仓库 workspace 版本号与 npm 发布版不一致，以 npm view 实查为准 |
| 2026-08-13 | 本机 npm 全局缓存 root-owned 文件（EPERM） | 临时用 `--cache /private/tmp/...` 绕过；正式发布前修复 `~/.npm` 权限 |
