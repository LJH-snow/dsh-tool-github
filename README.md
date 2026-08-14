# dsh-tool-github

[English](README.md) | [中文](README.zh.md)

A Cordis tool plugin that gives [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) GitHub capabilities. Agents can look up repositories, search code, list issues, and create draft pull requests in natural language.

Built on the official "everything is a plugin" architecture via `ctx.tools.register(defineTool(...))`, following the official [adding-a-tool](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md) contract.

## Install

Install directly from GitHub (no npm publish needed):

```sh
npm install github:LJH-snow/dsh-tool-github
# or a specific branch/tag
npm install github:LJH-snow/dsh-tool-github#main
```

Or from a local checkout:

```sh
git clone https://github.com/LJH-snow/dsh-tool-github
cd dsh-tool-github
npm install && npm run build   # builds to lib/
npm install /path/to/dsh-tool-github
```

> Once published to npm, it will also be installable as `npm install @libai168/dsh-tool-github`.

Requires `@deepseek-ai/cordis` (^4.0.1) and `@deepseek-ai/dsh-tools` (^0.1.0-rc.6) as peer dependencies, provided by the host dsh runtime.

## Configuration

Load the plugin in a dsh composition config (`cordis.yml`):

```yaml
- name: 'dsh-tool-github'
  config:
    token: 'ghp_xxx'        # GitHub PAT (optional; required for code search and PR creation)
    baseUrl: 'https://api.github.com'   # optional, override for GitHub Enterprise
    timeoutMs: 15000        # optional, request timeout in ms (default 15000)
```

Full example: [examples/cordis.yml](examples/cordis.yml).

> Security: read-only tools need no token. `github_search_code` and `github_create_pr_draft` require a token. Prefer a minimal-scope fine-grained token and never commit it.

## Tools

| Tool | Description | Token |
|---|---|---|
| `github_get_repo` | Repository metadata (description, stars, language, license, homepage, updated) | no |
| `github_search_repos` | Search repositories (sort stars/forks/updated, up to 10 results) | no |
| `github_list_issues` | List issues (state/label filters, up to 20 results) | no |
| `github_search_code` | Code search; clear hint when no token is configured | yes |
| `github_list_prs` | List pull requests (state filter, up to 20) | no |
| `github_get_file` | Read a repository file (branch/ref support, base64-decoded) | no |
| `github_list_commits` | List recent commits (branch/author filters, up to 30) | no |
| `github_create_issue` | Create an issue (title required; body/labels optional) | yes |
| `github_comment_issue` | Comment on an issue or PR | yes |
| `github_update_issue` | Open or close an issue | yes |
| `github_merge_pr` | Merge a PR (merge/squash/rebase; requires token) | yes |
| `github_list_releases` | List releases (tag, draft/prerelease, author) | no |
| `github_list_branches` | List branches with latest SHAs | no |
| `github_get_issue` | Get issue details (title, state, author, labels, body) | no |
| `github_list_issue_comments` | List issue comments (author, time, body) | no |
| `github_list_pr_comments` | List PR review comments (author, time, body) | no |
| `github_get_user` | Get user/org info (name, bio, followers, repos) | no |
| `github_list_workflow_runs` | List Actions runs (workflow, branch, status) | no* |
| `github_create_branch` | Create a branch from a ref | yes |
| `github_write_file` | Create/update a file (creates a commit) | yes |
| `github_get_readme` | Read the repository README (markdown) | no |
| `github_list_tags` | List version tags | no |
| `github_star_repo` | Star a repository | yes |
| `github_unstar_repo` | Remove a star | yes |
| `github_create_release` | Create a release for a tag | yes |
| `github_create_pr_draft` | Create a draft PR (head/base/title/body) | yes |

### Behavior contract (per the official execute contract)

- **Business failures are canonical values**: missing repo → `{ found: false }`; PR creation failure (branch missing / PR exists) → `{ created: false, reason }`.
- **Only infrastructure errors throw**: invalid token (401), rate limit (403), etc.
- **Cancellable**: every request forwards `exec.signal`, with a default 15s timeout.

## Development

```sh
npm install
npm run typecheck   # type check
npm test            # unit tests (vitest)
npm run build       # build to lib/
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for plans and decisions.

## Publishing

1. The package is published under your npm scope: `@libai168/dsh-tool-github` (npm publishing requires a granular access token with **2FA bypass** enabled, or trusted publishing).
2. `npm run build`, then `npm publish --access public`.
3. Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your GitHub repo for ecosystem discovery.

## License

[MIT](LICENSE)
