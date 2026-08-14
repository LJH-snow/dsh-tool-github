# dsh-tool-github

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）提供 GitHub 能力的 Cordis 工具插件。Agent 可以通过自然语言查询仓库、搜索代码、查看 issue、创建 draft PR。

基于官方「一切皆插件」架构，通过 `ctx.tools.register(defineTool(...))` 注册模型可见工具，完全遵循官方 [adding-a-tool](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md) 契约。

## 安装

```sh
npm install dsh-tool-github
```

需要 `@deepseek-ai/cordis`（^4.0.1）与 `@deepseek-ai/dsh-tools`（^0.1.0-rc.6）作为 peer 依赖，由宿主 dsh 运行时提供。

## 配置

在 dsh 的组合配置（`cordis.yml`）中加载插件：

```yaml
- name: 'dsh-tool-github'
  config:
    token: 'ghp_xxx'        # GitHub PAT（可选；代码搜索与创建 PR 需要）
    baseUrl: 'https://api.github.com'   # 可选，GitHub Enterprise 可覆盖
    timeoutMs: 15000        # 可选，请求超时（毫秒），默认 15000
```

完整示例见 [examples/cordis.yml](examples/cordis.yml)。

> 安全建议：查询类工具无需 token；代码搜索（`github_search_code`）与创建 PR（`github_create_pr_draft`）需要 token。建议使用最小权限的 fine-grained token，避免把 token 写入版本库。

## 提供的工具

| 工具 | 说明 | 需要 token |
|---|---|---|
| `github_get_repo` | 查询仓库元信息（描述、star、语言、license、主页、更新时间） | 否 |
| `github_search_repos` | 按关键词搜索仓库（排序 stars/forks/updated，结果上限 10） | 否 |
| `github_list_issues` | 列出仓库 issue（state/label 过滤，结果上限 20） | 否 |
| `github_search_code` | 搜索代码；未配置 token 时返回明确提示 | 是 |
| `github_list_prs` | 列出仓库 PR（state 过滤，上限 20） | 否 |
| `github_get_file` | 读取仓库文件内容（支持分支/ref，base64 解码） | 否 |
| `github_list_commits` | 查看最近提交（分支/作者过滤，上限 30） | 否 |
| `github_create_pr_draft` | 创建 draft PR（head/base/title/body） | 是 |

### 行为约定（遵循官方 execute 契约）

- **业务失败用规范值表达**：仓库不存在 → `{ found: false }`；PR 创建失败（分支不存在/已存在）→ `{ created: false, reason }`。
- **基础设施错误才抛错**：token 无效（401）、限流（403）等直接抛出，由调用方感知。
- **取消可中断**：所有请求透传 `exec.signal`，并叠加默认 15s 超时。

## 开发

```sh
npm install
npm run typecheck   # 类型检查
npm test            # 单元测试（vitest）
npm run build       # 构建到 lib/
```

开发计划、决策记录见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 发布与生态

1. 将 `package.json` 的 `name` 改为你的 scope（如 `@your-name/dsh-tool-github`），并同步 `repository`、`homepage` 字段。
2. `npm run build` 后执行 `npm publish --access public`。
3. 为你的 GitHub 仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic，便于生态发现。

## License

[MIT](LICENSE)
