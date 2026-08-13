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
