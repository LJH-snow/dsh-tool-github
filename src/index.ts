import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallView, ToolResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { GithubClient, GithubError } from './client.js'

export const name = 'dsh-tool-github'
export const inject = ['tools']

export interface GithubPluginConfig {
  /** GitHub Personal Access Token. Read-only scopes are enough for v0.1 tools. */
  token?: string
  /** API base URL override (e.g. GitHub Enterprise). */
  baseUrl?: string
  /** Request timeout in milliseconds. */
  timeoutMs?: number
}

export function apply(ctx: Context, config: GithubPluginConfig = {}) {
  const client = new GithubClient({ baseUrl: config.baseUrl, token: config.token, timeoutMs: config.timeoutMs })
  for (const tool of createTools(client)) {
    ctx.tools.register(tool)
  }
}

/** Build the tool definitions for a client. Exported so tests can drive execute/render directly. */
export function createTools(client: GithubClient) {
  return [
    defineTool({
      name: 'github_get_repo',
      description: 'Get metadata about a GitHub repository: owner, description, star count, language, license, homepage, and last update time.',
      parameters: {
        owner: { type: 'string', required: true, description: 'Repository owner (user or organization), e.g. deepseek-ai' },
        repo: { type: 'string', required: true, description: 'Repository name, e.g. deepseek-harness' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean', description: 'Whether the repository exists' },
            owner: { type: 'string', description: 'Repository owner' },
            name: { type: 'string', description: 'Repository name' },
            description: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Repository description' },
            stars: { type: 'integer', description: 'Star count' },
            language: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Primary language' },
            license: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'SPDX license identifier' },
            homepage: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Homepage URL' },
            updatedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'ISO last-update timestamp' },
          },
        },
        render: (_args, value) => {
          if (!value.found) return [{ type: 'text', text: 'Repository not found.' }]
          const lines = [
            `${value.owner}/${value.name}`,
            value.description ?? '',
            `stars: ${value.stars ?? 0}`,
            `language: ${value.language ?? 'n/a'}`,
            `license: ${value.license ?? 'n/a'}`,
            value.homepage ? `homepage: ${value.homepage}` : '',
            value.updatedAt ? `updated: ${value.updatedAt}` : '',
          ].filter(Boolean)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Fetch repo ${args.owner}/${args.repo}`, kind: 'read' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { found?: boolean; owner?: string; name?: string; stars?: number; language?: string | null }
        if (!v.found) return { card: 'generic', title: 'Repo not found' }
        return {
          card: 'generic',
          title: `${v.owner}/${v.name}`,
          content: [{ type: 'text', text: `${v.stars ?? 0} stars · ${v.language ?? 'n/a'}` }],
        }
      },
      async execute(args, exec) {
        try {
          const info = await client.getRepo(args.owner, args.repo, exec.signal)
          return { found: true, ...info }
        } catch (error) {
          if (error instanceof GithubError && error.status === 404) {
            return { found: false }
          }
          throw error
        }
      },
    }),

    defineTool({
      name: 'github_search_repos',
      description: 'Search GitHub repositories by keyword, sorted by stars by default. Returns full names, descriptions, star counts, languages, and URLs.',
      parameters: {
        query: { type: 'string', required: true, description: 'Search query, e.g. "agent harness" or "deepseek"' },
        sort: { type: 'string', enum: ['stars', 'forks', 'updated'], description: 'Sort criterion (default stars)' },
        order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order (default desc)' },
        limit: { type: 'integer', description: 'Maximum results, 1-10 (default 5)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            total: { type: 'integer', description: 'Total number of matches on GitHub' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  fullName: { type: 'string', description: 'Owner/name' },
                  description: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Repository description' },
                  stars: { type: 'integer', description: 'Star count' },
                  language: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Primary language' },
                  url: { type: 'string', description: 'Repository URL' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No repositories found.' }]
          const lines = items.map(item => {
            const stars = item.stars ?? 0
            const language = item.language ?? 'n/a'
            const description = item.description ? ` — ${item.description}` : ''
            return `${item.fullName} (${stars}★, ${language})${description}`
          })
          return [{ type: 'text', text: `Found ${value.total ?? 0} repositories:\n${lines.join('\n')}` }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Search repos: ${args.query}`, kind: 'search' }
      },
      presentResult(args, result): ToolResultView | undefined {
        const v = result as unknown as { total?: number; items?: Array<{ fullName: string; stars?: number }> }
        const items = v.items ?? []
        if (items.length === 0) return { card: 'generic', title: `No repos for "${args.query}"` }
        return {
          card: 'generic',
          title: `${v.total ?? items.length} repos for "${args.query}"`,
          content: [{ type: 'text', text: items.map(i => `${i.fullName} (${i.stars ?? 0}★)`).join('\n') }],
        }
      },
      async execute(args, exec) {
        const limit = args.limit === undefined ? 5 : Math.max(1, Math.min(args.limit, 10))
        const result = await client.searchRepos(args.query, { sort: args.sort, order: args.order, perPage: limit, signal: exec.signal })
        return result
      },
    }),

    defineTool({
      name: 'github_list_issues',
      description: 'List issues of a GitHub repository, optionally filtered by state and label.',
      parameters: {
        owner: { type: 'string', required: true, description: 'Repository owner' },
        repo: { type: 'string', required: true, description: 'Repository name' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state (default open)' },
        label: { type: 'string', description: 'Filter by label name' },
        limit: { type: 'integer', description: 'Maximum results, 1-20 (default 10)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  number: { type: 'integer', description: 'Issue number' },
                  title: { type: 'string', description: 'Issue title' },
                  state: { type: 'string', description: 'Issue state' },
                  labels: { type: 'array', items: { type: 'string' }, description: 'Label names' },
                  createdAt: { type: 'string', description: 'ISO creation timestamp' },
                  author: { type: 'string', description: 'Author login' },
                  url: { type: 'string', description: 'Issue URL' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No issues found.' }]
          const lines = items.map(item => {
            const labels = item.labels ?? []
            const labelText = labels.length > 0 ? ` [${labels.join(', ')}]` : ''
            return `#${item.number} ${item.title} (${item.state}, @${item.author})${labelText}`
          })
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      presentCall(args): ToolCallView {
        const label = args.label ? ` [${args.label}]` : ''
        return { card: 'generic', title: `Issues: ${args.owner}/${args.repo}${label}`, kind: 'search' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { items?: Array<{ number: number; title: string }> }
        const items = v.items ?? []
        if (items.length === 0) return { card: 'generic', title: 'No issues' }
        return {
          card: 'generic',
          title: `${items.length} issue(s)`,
          content: [{ type: 'text', text: items.map(i => `#${i.number} ${i.title}`).join('\n') }],
        }
      },
      async execute(args, exec) {
        const limit = args.limit === undefined ? 10 : Math.max(1, Math.min(args.limit, 20))
        const items = await client.listIssues(args.owner, args.repo, { state: args.state, label: args.label, perPage: limit, signal: exec.signal })
        return { items }
      },
    }),

    defineTool({
      name: 'github_search_code',
      description: 'Search code on GitHub. Requires a configured GitHub token. Returns file paths, repositories, and URLs.',
      parameters: {
        query: { type: 'string', required: true, description: 'Code search query, e.g. "repo:deepseek-ai/deepseek-harness language:typescript defineTool"' },
        limit: { type: 'integer', description: 'Maximum results, 1-10 (default 5)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            authenticated: { type: 'boolean', description: 'Whether a GitHub token was configured; code search requires one' },
            total: { type: 'integer', description: 'Total number of matches on GitHub' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  path: { type: 'string', description: 'File path in the repository' },
                  repository: { type: 'string', description: 'Owner/name of the repository' },
                  url: { type: 'string', description: 'File URL' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          if (!value.authenticated) return [{ type: 'text', text: 'Code search requires a GitHub token. Configure the plugin with a token (read-only scopes are enough).' }]
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No code matches found.' }]
          const lines = items.map(item => `${item.repository}: ${item.path} — ${item.url}`)
          return [{ type: 'text', text: `Found ${value.total ?? 0} matches:\n${lines.join('\n')}` }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Search code: ${args.query}`, kind: 'search' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { authenticated?: boolean; total?: number; items?: Array<{ path: string; repository: string }> }
        if (!v.authenticated) return { card: 'generic', title: 'Code search needs a token' }
        const items = v.items ?? []
        if (items.length === 0) return { card: 'generic', title: 'No code matches' }
        return {
          card: 'search',
          shape: 'paths',
          title: `${v.total ?? items.length} code match(es)`,
          paths: items.map(i => `${i.repository}: ${i.path}`),
          truncated: false,
          total: v.total ?? items.length,
        }
      },
      async execute(args, exec) {
        if (!client.hasToken()) {
          return { authenticated: false, total: 0, items: [] }
        }
        const limit = args.limit === undefined ? 5 : Math.max(1, Math.min(args.limit, 10))
        const result = await client.searchCode(args.query, { perPage: limit, signal: exec.signal })
        return { authenticated: true, ...result }
      },
    }),

    defineTool({
      name: 'github_list_prs',
      description: 'List pull requests of a GitHub repository, optionally filtered by state. Returns number, title, author, branches, and draft status.',
      parameters: {
        owner: { type: 'string', required: true, description: 'Repository owner' },
        repo: { type: 'string', required: true, description: 'Repository name' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'PR state (default open)' },
        limit: { type: 'integer', description: 'Maximum results, 1-20 (default 10)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  number: { type: 'integer', description: 'PR number' },
                  title: { type: 'string', description: 'PR title' },
                  state: { type: 'string', description: 'PR state' },
                  draft: { type: 'boolean', description: 'Whether this is a draft PR' },
                  author: { type: 'string', description: 'Author login' },
                  headRef: { type: 'string', description: 'Head branch' },
                  baseRef: { type: 'string', description: 'Base branch' },
                  createdAt: { type: 'string', description: 'ISO creation timestamp' },
                  url: { type: 'string', description: 'PR URL' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No pull requests found.' }]
          const lines = items.map(item => {
            const draft = item.draft ? ' [draft]' : ''
            return `#${item.number} ${item.title} (${item.state}, @${item.author})${draft} → ${item.headRef} -> ${item.baseRef}`
          })
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `PRs: ${args.owner}/${args.repo}`, kind: 'search' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { items?: Array<{ number: number; title: string }> }
        const items = v.items ?? []
        if (items.length === 0) return { card: 'generic', title: 'No PRs' }
        return {
          card: 'generic',
          title: `${items.length} PR(s)`,
          content: [{ type: 'text', text: items.map(i => `#${i.number} ${i.title}`).join('\n') }],
        }
      },
      async execute(args, exec) {
        const limit = args.limit === undefined ? 10 : Math.max(1, Math.min(args.limit, 20))
        const items = await client.listPrs(args.owner, args.repo, { state: args.state, perPage: limit, signal: exec.signal })
        return { items }
      },
    }),

    defineTool({
      name: 'github_get_file',
      description: 'Read a file from a GitHub repository (raw content, base64-decoded). Supports an optional branch or ref.',
      parameters: {
        owner: { type: 'string', required: true, description: 'Repository owner' },
        repo: { type: 'string', required: true, description: 'Repository name' },
        path: { type: 'string', required: true, description: 'File path in the repository, e.g. src/index.ts' },
        ref: { type: 'string', description: 'Branch or commit ref (defaults to the default branch)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean', description: 'Whether the file exists' },
            name: { type: 'string', description: 'File name' },
            path: { type: 'string', description: 'File path' },
            size: { type: 'integer', description: 'File size in bytes' },
            content: { type: 'string', description: 'File content (decoded text)' },
            url: { type: 'string', description: 'File URL' },
          },
        },
        render: (_args, value) => {
          if (!value.found) return [{ type: 'text', text: 'File not found.' }]
          const content = value.content ?? ''
          const preview = content.length > 2000 ? `${content.slice(0, 2000)}\n... [truncated, ${content.length} chars total]` : content
          return [{ type: 'text', text: `${value.path} (${value.size} bytes)\n\n${preview}` }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Read ${args.path}`, kind: 'read', locations: [{ path: args.path }] }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { found?: boolean; path?: string; size?: number; content?: string }
        if (!v.found) return { card: 'generic', title: 'File not found' }
        return { card: 'generic', title: `${v.path} (${v.size} bytes)` }
      },
      async execute(args, exec) {
        try {
          const file = await client.getFile(args.owner, args.repo, args.path, { ref: args.ref, signal: exec.signal })
          const content = file.encoding === 'base64'
            ? Buffer.from(file.content, 'base64').toString('utf8')
            : file.content
          return { found: true, name: file.name, path: file.path, size: file.size, content, url: file.url }
        } catch (error) {
          if (error instanceof GithubError && error.status === 404) {
            return { found: false }
          }
          throw error
        }
      },
    }),

    defineTool({
      name: 'github_list_commits',
      description: 'List recent commits of a GitHub repository, optionally filtered by branch and author.',
      parameters: {
        owner: { type: 'string', required: true, description: 'Repository owner' },
        repo: { type: 'string', required: true, description: 'Repository name' },
        branch: { type: 'string', description: 'Branch name (defaults to the default branch)' },
        author: { type: 'string', description: 'GitHub username or email to filter by' },
        limit: { type: 'integer', description: 'Maximum results, 1-30 (default 10)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  sha: { type: 'string', description: 'Short commit SHA' },
                  message: { type: 'string', description: 'Commit subject' },
                  author: { type: 'string', description: 'Author name' },
                  date: { type: 'string', description: 'ISO commit timestamp' },
                  url: { type: 'string', description: 'Commit URL' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No commits found.' }]
          const lines = items.map(item => `${item.sha} ${item.message} (${item.author}, ${item.date})`)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Commits: ${args.owner}/${args.repo}`, kind: 'search' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { items?: Array<{ sha: string; message: string }> }
        const items = v.items ?? []
        if (items.length === 0) return { card: 'generic', title: 'No commits' }
        return {
          card: 'generic',
          title: `${items.length} commit(s)`,
          content: [{ type: 'text', text: items.map(i => `${i.sha} ${i.message}`).join('\n') }],
        }
      },
      async execute(args, exec) {
        const limit = args.limit === undefined ? 10 : Math.max(1, Math.min(args.limit, 30))
        const items = await client.listCommits(args.owner, args.repo, { branch: args.branch, author: args.author, perPage: limit, signal: exec.signal })
        return { items }
      },
    }),

    defineTool({
      name: 'github_create_issue',
      description: 'Create an issue in a GitHub repository. WRITE operation: requires a configured token and affects the remote repository.',
      parameters: {
        owner: { type: 'string', required: true, description: 'Repository owner' },
        repo: { type: 'string', required: true, description: 'Repository name' },
        title: { type: 'string', required: true, description: 'Issue title' },
        body: { type: 'string', description: 'Issue body (Markdown)' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Label names to apply' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', description: 'Whether the issue was created' },
            number: { type: 'integer', description: 'Issue number when created' },
            url: { type: 'string', description: 'Issue URL when created' },
            reason: { type: 'string', description: 'Explanation when not created' },
          },
        },
        render: (_args, value) => {
          if (value.ok) return [{ type: 'text', text: `Created issue #${value.number}: ${value.url}` }]
          return [{ type: 'text', text: `Could not create the issue: ${value.reason}` }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Create issue: ${args.title}`, kind: 'edit' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { ok?: boolean; number?: number; url?: string; reason?: string }
        if (v.ok) return { card: 'generic', title: `Issue #${v.number} created`, content: [{ type: 'text', text: v.url ?? '' }] }
        return { card: 'generic', title: 'Create issue failed', content: [{ type: 'text', text: v.reason ?? 'Unknown' }] }
      },
      async execute(args, exec) {
        if (!client.hasToken()) {
          return { ok: false, reason: 'Creating an issue requires a GitHub token. Configure the plugin with a token.' }
        }
        return client.createIssue(args.owner, args.repo, { title: args.title, body: args.body, labels: args.labels }, exec.signal)
      },
    }),

    defineTool({
      name: 'github_comment_issue',
      description: 'Comment on a GitHub issue or pull request. WRITE operation: requires a configured token and affects the remote repository.',
      parameters: {
        owner: { type: 'string', required: true, description: 'Repository owner' },
        repo: { type: 'string', required: true, description: 'Repository name' },
        issueNumber: { type: 'integer', required: true, description: 'Issue or PR number' },
        body: { type: 'string', required: true, description: 'Comment body (Markdown)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', description: 'Whether the comment was posted' },
            number: { type: 'integer', description: 'Comment id when posted' },
            url: { type: 'string', description: 'Comment URL when posted' },
            reason: { type: 'string', description: 'Explanation when not posted' },
          },
        },
        render: (_args, value) => {
          if (value.ok) return [{ type: 'text', text: `Posted comment: ${value.url}` }]
          return [{ type: 'text', text: `Could not post the comment: ${value.reason}` }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Comment on #${args.issueNumber}`, kind: 'edit' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { ok?: boolean; url?: string; reason?: string }
        if (v.ok) return { card: 'generic', title: 'Comment posted', content: [{ type: 'text', text: v.url ?? '' }] }
        return { card: 'generic', title: 'Comment failed', content: [{ type: 'text', text: v.reason ?? 'Unknown' }] }
      },
      async execute(args, exec) {
        if (!client.hasToken()) {
          return { ok: false, reason: 'Commenting requires a GitHub token. Configure the plugin with a token.' }
        }
        return client.commentOnIssue(args.owner, args.repo, args.issueNumber, args.body, exec.signal)
      },
    }),

    defineTool({
      name: 'github_update_issue',
      description: 'Open or close a GitHub issue. WRITE operation: requires a configured token and affects the remote repository.',
      parameters: {
        owner: { type: 'string', required: true, description: 'Repository owner' },
        repo: { type: 'string', required: true, description: 'Repository name' },
        issueNumber: { type: 'integer', required: true, description: 'Issue number' },
        state: { type: 'string', enum: ['open', 'closed'], required: true, description: 'Target state' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', description: 'Whether the issue state was updated' },
            number: { type: 'integer', description: 'Issue number' },
            url: { type: 'string', description: 'Issue URL' },
            reason: { type: 'string', description: 'Explanation when not updated' },
          },
        },
        render: (_args, value) => {
          if (value.ok) return [{ type: 'text', text: `Updated issue #${value.number}: ${value.url}` }]
          return [{ type: 'text', text: `Could not update the issue: ${value.reason}` }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `${args.state === 'closed' ? 'Close' : 'Open'} issue #${args.issueNumber}`, kind: 'edit' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { ok?: boolean; number?: number; url?: string; reason?: string }
        if (v.ok) return { card: 'generic', title: `Issue #${v.number} updated`, content: [{ type: 'text', text: v.url ?? '' }] }
        return { card: 'generic', title: 'Update issue failed', content: [{ type: 'text', text: v.reason ?? 'Unknown' }] }
      },
      async execute(args, exec) {
        if (!client.hasToken()) {
          return { ok: false, reason: 'Updating an issue requires a GitHub token. Configure the plugin with a token.' }
        }
        return client.updateIssue(args.owner, args.repo, args.issueNumber, args.state, exec.signal)
      },
    }),

    defineTool({
      name: 'github_merge_pr',
      description: 'Merge a GitHub pull request. WRITE operation: requires a configured token and affects the remote repository. Only merges when the PR is mergeable.',
      parameters: {
        owner: { type: 'string', required: true, description: 'Repository owner' },
        repo: { type: 'string', required: true, description: 'Repository name' },
        prNumber: { type: 'integer', required: true, description: 'Pull request number' },
        mergeMethod: { type: 'string', enum: ['merge', 'squash', 'rebase'], description: 'Merge method (default merge)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', description: 'Whether the PR was merged' },
            number: { type: 'integer', description: 'PR number' },
            url: { type: 'string', description: 'PR URL' },
            reason: { type: 'string', description: 'Explanation when not merged' },
          },
        },
        render: (_args, value) => {
          if (value.ok) return [{ type: 'text', text: `Merged PR #${value.number}: ${value.url}` }]
          return [{ type: 'text', text: `Could not merge PR #${value.number}: ${value.reason}` }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Merge PR #${args.prNumber}`, kind: 'edit' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { ok?: boolean; number?: number; url?: string; reason?: string }
        if (v.ok) return { card: 'generic', title: `PR #${v.number} merged`, content: [{ type: 'text', text: v.url ?? '' }] }
        return { card: 'generic', title: `Merge PR #${v.number} failed`, content: [{ type: 'text', text: v.reason ?? 'Unknown' }] }
      },
      async execute(args, exec) {
        if (!client.hasToken()) {
          return { ok: false, number: args.prNumber, reason: 'Merging a PR requires a GitHub token. Configure the plugin with a token.' }
        }
        return client.mergePr(args.owner, args.repo, args.prNumber, { mergeMethod: args.mergeMethod, signal: exec.signal })
      },
    }),

    defineTool({
      name: 'github_list_releases',
      description: 'List releases of a GitHub repository, including tag, name, draft/prerelease status, author, and publish time.',
      parameters: {
        owner: { type: 'string', required: true, description: 'Repository owner' },
        repo: { type: 'string', required: true, description: 'Repository name' },
        limit: { type: 'integer', description: 'Maximum results, 1-20 (default 10)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  tagName: { type: 'string', description: 'Release tag' },
                  name: { type: 'string', description: 'Release name' },
                  draft: { type: 'boolean', description: 'Whether this is a draft release' },
                  prerelease: { type: 'boolean', description: 'Whether this is a prerelease' },
                  author: { type: 'string', description: 'Release author login' },
                  publishedAt: { type: 'string', description: 'ISO publish timestamp' },
                  url: { type: 'string', description: 'Release URL' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No releases found.' }]
          const lines = items.map(item => {
            const flags = [item.draft ? 'draft' : '', item.prerelease ? 'pre' : ''].filter(Boolean).join('+')
            const flagText = flags ? ` [${flags}]` : ''
            return `${item.tagName} — ${item.name ?? ''} (@${item.author}, ${item.publishedAt})${flagText}`
          })
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Releases: ${args.owner}/${args.repo}`, kind: 'search' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { items?: Array<{ tagName: string }> }
        const items = v.items ?? []
        if (items.length === 0) return { card: 'generic', title: 'No releases' }
        return {
          card: 'generic',
          title: `${items.length} release(s)`,
          content: [{ type: 'text', text: items.map(i => i.tagName).join('\n') }],
        }
      },
      async execute(args, exec) {
        const limit = args.limit === undefined ? 10 : Math.max(1, Math.min(args.limit, 20))
        const items = await client.listReleases(args.owner, args.repo, { perPage: limit, signal: exec.signal })
        return { items }
      },
    }),

    defineTool({
      name: 'github_list_branches',
      description: 'List branches of a GitHub repository with their latest commit SHAs.',
      parameters: {
        owner: { type: 'string', required: true, description: 'Repository owner' },
        repo: { type: 'string', required: true, description: 'Repository name' },
        limit: { type: 'integer', description: 'Maximum results, 1-50 (default 20)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', description: 'Branch name' },
                  sha: { type: 'string', description: 'Latest commit short SHA' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No branches found.' }]
          return [{ type: 'text', text: items.map(i => `${i.name} (${i.sha})`).join('\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Branches: ${args.owner}/${args.repo}`, kind: 'search' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { items?: Array<{ name: string }> }
        const items = v.items ?? []
        if (items.length === 0) return { card: 'generic', title: 'No branches' }
        return {
          card: 'generic',
          title: `${items.length} branch(es)`,
          content: [{ type: 'text', text: items.map(i => i.name).join('\n') }],
        }
      },
      async execute(args, exec) {
        const limit = args.limit === undefined ? 20 : Math.max(1, Math.min(args.limit, 50))
        const items = await client.listBranches(args.owner, args.repo, { perPage: limit, signal: exec.signal })
        return { items }
      },
    }),

    defineTool({
      name: 'github_get_issue',
      description: 'Get details of a single GitHub issue: title, state, author, labels, body, and creation time.',
      parameters: {
        owner: { type: 'string', required: true, description: 'Repository owner' },
        repo: { type: 'string', required: true, description: 'Repository name' },
        issueNumber: { type: 'integer', required: true, description: 'Issue number' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean', description: 'Whether the issue exists' },
            number: { type: 'integer', description: 'Issue number' },
            title: { type: 'string', description: 'Issue title' },
            state: { type: 'string', description: 'Issue state' },
            author: { type: 'string', description: 'Author login' },
            createdAt: { type: 'string', description: 'ISO creation timestamp' },
            labels: { type: 'array', items: { type: 'string' }, description: 'Label names' },
            body: { type: 'string', description: 'Issue body (Markdown)' },
            url: { type: 'string', description: 'Issue URL' },
          },
        },
        render: (_args, value) => {
          if (!value.found) return [{ type: 'text', text: 'Issue not found.' }]
          const labels = value.labels && value.labels.length > 0 ? ` [${value.labels.join(', ')}]` : ''
          const body = value.body ? `\n\n${value.body}` : ''
          return [{ type: 'text', text: `#${value.number} ${value.title} (${value.state}, @${value.author})${labels}${body}` }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Issue #${args.issueNumber}`, kind: 'read' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { found?: boolean; number?: number; title?: string; state?: string }
        if (!v.found) return { card: 'generic', title: 'Issue not found' }
        return { card: 'generic', title: `#${v.number} ${v.title}`, content: [{ type: 'text', text: `state: ${v.state}` }] }
      },
      async execute(args, exec) {
        try {
          const issue = await client.getIssue(args.owner, args.repo, args.issueNumber, exec.signal)
          return { found: true, ...issue }
        } catch (error) {
          if (error instanceof GithubError && error.status === 404) {
            return { found: false }
          }
          throw error
        }
      },
    }),

    defineTool({
      name: 'github_list_issue_comments',
      description: 'List comments on a GitHub issue: author, time, and body.',
      parameters: {
        owner: { type: 'string', required: true, description: 'Repository owner' },
        repo: { type: 'string', required: true, description: 'Repository name' },
        issueNumber: { type: 'integer', required: true, description: 'Issue number' },
        limit: { type: 'integer', description: 'Maximum results, 1-30 (default 10)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'integer', description: 'Comment id' },
                  author: { type: 'string', description: 'Author login' },
                  createdAt: { type: 'string', description: 'ISO creation timestamp' },
                  body: { type: 'string', description: 'Comment body' },
                  url: { type: 'string', description: 'Comment URL' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No comments found.' }]
          const lines = items.map(item => `@${item.author} (${item.createdAt}): ${(item.body ?? '').slice(0, 200)}`)
          return [{ type: 'text', text: lines.join('\n\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Comments on #${args.issueNumber}`, kind: 'search' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { items?: Array<{ author: string }> }
        const items = v.items ?? []
        if (items.length === 0) return { card: 'generic', title: 'No comments' }
        return {
          card: 'generic',
          title: `${items.length} comment(s)`,
          content: [{ type: 'text', text: items.map(i => `@${i.author}`).join('\n') }],
        }
      },
      async execute(args, exec) {
        const limit = args.limit === undefined ? 10 : Math.max(1, Math.min(args.limit, 30))
        const items = await client.listIssueComments(args.owner, args.repo, args.issueNumber, { perPage: limit, signal: exec.signal })
        return { items }
      },
    }),

    defineTool({
      name: 'github_list_pr_comments',
      description: 'List review comments on a GitHub pull request: author, time, and body.',
      parameters: {
        owner: { type: 'string', required: true, description: 'Repository owner' },
        repo: { type: 'string', required: true, description: 'Repository name' },
        prNumber: { type: 'integer', required: true, description: 'Pull request number' },
        limit: { type: 'integer', description: 'Maximum results, 1-30 (default 10)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'integer', description: 'Comment id' },
                  author: { type: 'string', description: 'Author login' },
                  createdAt: { type: 'string', description: 'ISO creation timestamp' },
                  body: { type: 'string', description: 'Comment body' },
                  url: { type: 'string', description: 'Comment URL' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No PR comments found.' }]
          const lines = items.map(item => `@${item.author} (${item.createdAt}): ${(item.body ?? '').slice(0, 200)}`)
          return [{ type: 'text', text: lines.join('\n\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `PR #${args.prNumber} comments`, kind: 'search' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { items?: Array<{ author: string }> }
        const items = v.items ?? []
        if (items.length === 0) return { card: 'generic', title: 'No PR comments' }
        return {
          card: 'generic',
          title: `${items.length} PR comment(s)`,
          content: [{ type: 'text', text: items.map(i => `@${i.author}`).join('\n') }],
        }
      },
      async execute(args, exec) {
        const limit = args.limit === undefined ? 10 : Math.max(1, Math.min(args.limit, 30))
        const items = await client.listPrComments(args.owner, args.repo, args.prNumber, { perPage: limit, signal: exec.signal })
        return { items }
      },
    }),

    defineTool({
      name: 'github_create_pr_draft',
      description: 'Create a draft pull request on GitHub. Returns the PR number and URL when created.',
      parameters: {
        owner: { type: 'string', required: true, description: 'Repository owner' },
        repo: { type: 'string', required: true, description: 'Repository name' },
        title: { type: 'string', required: true, description: 'Pull request title' },
        head: { type: 'string', required: true, description: 'Head branch name, e.g. feature/my-change' },
        base: { type: 'string', required: true, description: 'Base branch name, e.g. main' },
        body: { type: 'string', description: 'Pull request description (Markdown)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            created: { type: 'boolean', description: 'Whether the draft PR was created' },
            number: { type: 'integer', description: 'PR number when created' },
            url: { type: 'string', description: 'PR URL when created' },
            reason: { type: 'string', description: 'Explanation when not created' },
          },
        },
        render: (_args, value) => {
          if (value.created) return [{ type: 'text', text: `Created draft PR #${value.number}: ${value.url}` }]
          return [{ type: 'text', text: `Could not create the draft PR: ${value.reason}` }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Draft PR: ${args.title}`, kind: 'edit' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { created?: boolean; number?: number; url?: string; reason?: string }
        if (v.created) {
          return {
            card: 'generic',
            title: `Draft PR #${v.number}`,
            content: [{ type: 'text', text: v.url ?? '' }],
          }
        }
        return { card: 'generic', title: 'Draft PR failed', content: [{ type: 'text', text: v.reason ?? 'Unknown' }] }
      },
      async execute(args, exec) {
        return client.createPrDraft(args.owner, args.repo, { title: args.title, head: args.head, base: args.base, body: args.body }, exec.signal)
      },
    }),
  ]
}
