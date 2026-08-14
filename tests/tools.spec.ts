import { describe, expect, it, vi } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { GithubClient } from '../src/client.ts'
import { createTools } from '../src/index.ts'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function exec(): ToolRunContext {
  return { signal: new AbortController().signal } as unknown as ToolRunContext
}

const tools = () => Object.fromEntries(createTools(new GithubClient({ fetchImpl: globalThis.fetch })).map(t => [t.name, t]))

describe('tool definitions', () => {
  it('registers the planned tools', () => {
    expect(Object.keys(tools()).sort()).toEqual([
      'github_comment_issue',
      'github_create_branch',
      'github_create_issue',
      'github_create_pr_draft',
      'github_get_file',
      'github_get_issue',
      'github_get_repo',
      'github_get_user',
      'github_list_branches',
      'github_list_commits',
      'github_list_issue_comments',
      'github_list_issues',
      'github_list_pr_comments',
      'github_list_prs',
      'github_list_releases',
      'github_list_workflow_runs',
      'github_merge_pr',
      'github_search_code',
      'github_search_repos',
      'github_update_issue',
      'github_write_file',
    ])
  })

  it('github_get_repo returns found:false on 404', async () => {
    const client = new GithubClient({ fetchImpl: vi.fn(async () => jsonResponse(404, {})) })
    const tool = createTools(client).find(t => t.name === 'github_get_repo')!
    const result = await tool.execute({ owner: 'nope', repo: 'missing' }, exec())
    expect(result).toEqual({ found: false })
  })

  it('github_get_repo render is a pure function of the value', async () => {
    const client = new GithubClient({ fetchImpl: vi.fn(async () => jsonResponse(404, {})) })
    const tool = createTools(client).find(t => t.name === 'github_get_repo')!
    const blocks = await (tool.output as { render: (a: unknown, v: any) => unknown }).render({}, { found: true, owner: 'a', name: 'b', stars: 3, language: 'TS', license: 'MIT' })
    expect(JSON.stringify(blocks)).toContain('a/b')
    expect(JSON.stringify(blocks)).toContain('stars: 3')
  })

  it('github_search_code returns a clear unauthenticated value without a token', async () => {
    const client = new GithubClient({ fetchImpl: vi.fn() })
    const tool = createTools(client).find(t => t.name === 'github_search_code')!
    const result = await tool.execute({ query: 'defineTool' }, exec())
    expect(result).toEqual({ authenticated: false, total: 0, items: [] })
  })

  it('github_search_code renders the token hint when unauthenticated', async () => {
    const client = new GithubClient({ fetchImpl: vi.fn() })
    const tool = createTools(client).find(t => t.name === 'github_search_code')!
    const blocks = await (tool.output as { render: (a: unknown, v: any) => unknown }).render({}, { authenticated: false, total: 0, items: [] })
    expect(JSON.stringify(blocks)).toContain('token')
  })

  it('github_create_pr_draft maps 422 to created:false', async () => {
    const client = new GithubClient({ token: 'ghp_test', fetchImpl: vi.fn(async () => jsonResponse(422, {})) })
    const tool = createTools(client).find(t => t.name === 'github_create_pr_draft')!
    const result = await tool.execute({ owner: 'a', repo: 'b', title: 'x', head: 'feat/x', base: 'main' }, exec())
    expect(result).toMatchObject({ created: false })
  })

  it('github_list_issues clamps limit to 20 and maps items', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [
      { number: 1, title: 'T', state: 'open', labels: [], created_at: '2026-01-01T00:00:00Z', user: { login: 'u' }, html_url: 'https://x' },
    ]))
    const client = new GithubClient({ fetchImpl })
    const tool = createTools(client).find(t => t.name === 'github_list_issues')!
    const result = await tool.execute({ owner: 'a', repo: 'b', limit: 99 }, exec())
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('per_page=20')
    expect(result).toMatchObject({ items: [{ number: 1, title: 'T', author: 'u' }] })
  })
})

describe('tool presentation (pure render intents)', () => {
  const defs = () => Object.fromEntries(createTools(new GithubClient()).map(t => [t.name, t]))

  it('github_get_repo pending and result cards', () => {
    const t = defs()['github_get_repo'] as any
    const args = { owner: 'a', repo: 'b' }
    expect(t.presentCall(args)).toMatchObject({ card: 'generic', kind: 'read', title: 'Fetch repo a/b' })
    const res = t.presentResult(args, { found: true, owner: 'a', name: 'b', stars: 3, language: 'TS' })
    expect(res).toMatchObject({ card: 'generic', title: 'a/b' })
    expect(t.presentResult(args, { found: false })).toMatchObject({ title: 'Repo not found' })
  })

  it('github_search_repos pending and result cards', () => {
    const t = defs()['github_search_repos'] as any
    const args = { query: 'agent' }
    expect(t.presentCall(args)).toMatchObject({ card: 'generic', kind: 'search', title: 'Search repos: agent' })
    const res = t.presentResult(args, { total: 42, items: [{ fullName: 'a/b', stars: 3 }] })
    expect(res).toMatchObject({ card: 'generic', title: '42 repos for "agent"' })
    expect(t.presentResult({ query: 'x' }, { items: [] })).toMatchObject({ title: 'No repos for "x"' })
  })

  it('github_search_code emits a search paths card when authenticated', () => {
    const t = defs()['github_search_code'] as any
    const args = { query: 'defineTool' }
    expect(t.presentCall(args)).toMatchObject({ kind: 'search' })
    const res = t.presentResult(args, { authenticated: true, total: 2, items: [{ path: 'a.ts', repository: 'o/r' }] })
    expect(res).toMatchObject({ card: 'search', shape: 'paths', paths: ['o/r: a.ts'], total: 2 })
    expect(t.presentResult(args, { authenticated: false, items: [] })).toMatchObject({ title: 'Code search needs a token' })
  })

  it('github_create_pr_draft pending and result cards', () => {
    const t = defs()['github_create_pr_draft'] as any
    const args = { owner: 'a', repo: 'b', title: 'Fix x', head: 'feat/x', base: 'main' }
    expect(t.presentCall(args)).toMatchObject({ card: 'generic', kind: 'edit' })
    expect(t.presentResult(args, { created: true, number: 9, url: 'https://x' })).toMatchObject({ title: 'Draft PR #9' })
    expect(t.presentResult(args, { created: false, reason: 'nope' })).toMatchObject({ title: 'Draft PR failed' })
  })
})

describe('extended tools (stage 5)', () => {
  it('registers all twenty-one tools', () => {
    const names = Object.keys(Object.fromEntries(createTools(new GithubClient()).map(t => [t.name, t]))).sort()
    expect(names).toEqual([
      'github_comment_issue',
      'github_create_branch',
      'github_create_issue',
      'github_create_pr_draft',
      'github_get_file',
      'github_get_issue',
      'github_get_repo',
      'github_get_user',
      'github_list_branches',
      'github_list_commits',
      'github_list_issue_comments',
      'github_list_issues',
      'github_list_pr_comments',
      'github_list_prs',
      'github_list_releases',
      'github_list_workflow_runs',
      'github_merge_pr',
      'github_search_code',
      'github_search_repos',
      'github_update_issue',
      'github_write_file',
    ])
  })

  it('github_get_file returns found:false on 404 and decodes base64', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {}))
    const client = new GithubClient({ fetchImpl })
    const tool = createTools(client).find(t => t.name === 'github_get_file')!
    const missing = await tool.execute({ owner: 'a', repo: 'b', path: 'nope.txt' }, exec())
    expect(missing).toEqual({ found: false })
  })

  it('github_get_file decodes base64 content', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      name: 'hello.txt', path: 'hello.txt', size: 5, content: Buffer.from('hello').toString('base64'), encoding: 'base64', html_url: 'https://x',
    }))
    const client = new GithubClient({ fetchImpl })
    const tool = createTools(client).find(t => t.name === 'github_get_file')!
    const result = await tool.execute({ owner: 'a', repo: 'b', path: 'hello.txt' }, exec())
    expect(result).toMatchObject({ found: true, content: 'hello', size: 5 })
  })

  it('github_list_commits clamps limit to 30', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, []))
    const client = new GithubClient({ fetchImpl })
    const tool = createTools(client).find(t => t.name === 'github_list_commits')!
    await tool.execute({ owner: 'a', repo: 'b', limit: 99 }, exec())
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('per_page=30')
  })

  it('github_list_prs presentCall uses search kind', () => {
    const t = createTools(new GithubClient()).find(t => t.name === 'github_list_prs') as any
    expect(t.presentCall({ owner: 'a', repo: 'b' })).toMatchObject({ card: 'generic', kind: 'search' })
  })
})

describe('write tools (stage 6)', () => {
  it('write tools return a clear business value without a token', async () => {
    const defs = Object.fromEntries(createTools(new GithubClient({ fetchImpl: vi.fn() })).map(t => [t.name, t]))
    const create = await defs['github_create_issue'].execute({ owner: 'a', repo: 'b', title: 'x' }, exec())
    expect(create).toMatchObject({ ok: false })
    expect(create.reason).toContain('token')

    const comment = await defs['github_comment_issue'].execute({ owner: 'a', repo: 'b', issueNumber: 1, body: 'hi' }, exec())
    expect(comment).toMatchObject({ ok: false })

    const update = await defs['github_update_issue'].execute({ owner: 'a', repo: 'b', issueNumber: 1, state: 'closed' }, exec())
    expect(update).toMatchObject({ ok: false })
  })

  it('write tools proceed when a token is configured', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { number: 3, html_url: 'https://github.com/a/b/issues/3' }))
    const client = new GithubClient({ token: 'ghp_test', fetchImpl })
    const defs = Object.fromEntries(createTools(client).map(t => [t.name, t]))
    const result = await defs['github_create_issue'].execute({ owner: 'a', repo: 'b', title: 'x' }, exec())
    expect(result).toEqual({ ok: true, number: 3, url: 'https://github.com/a/b/issues/3' })
  })

  it('github_create_issue presentCall uses edit kind and shows the title', () => {
    const t = createTools(new GithubClient()).find(t => t.name === 'github_create_issue') as any
    const call = t.presentCall({ owner: 'a', repo: 'b', title: 'Fix bug' })
    expect(call).toMatchObject({ card: 'generic', kind: 'edit', title: 'Create issue: Fix bug' })
  })

  it('github_update_issue presentCall reflects the target state', () => {
    const t = createTools(new GithubClient()).find(t => t.name === 'github_update_issue') as any
    expect(t.presentCall({ owner: 'a', repo: 'b', issueNumber: 5, state: 'closed' })).toMatchObject({ title: 'Close issue #5' })
    expect(t.presentCall({ owner: 'a', repo: 'b', issueNumber: 5, state: 'open' })).toMatchObject({ title: 'Open issue #5' })
  })
})

describe('stage 7 tools', () => {
  it('github_merge_pr requires a token', async () => {
    const defs = Object.fromEntries(createTools(new GithubClient({ fetchImpl: vi.fn() })).map(t => [t.name, t]))
    const result = await defs['github_merge_pr'].execute({ owner: 'a', repo: 'b', prNumber: 5 }, exec())
    expect(result).toMatchObject({ ok: false, number: 5 })
    expect(result.reason).toContain('token')
  })

  it('github_merge_pr merges with a token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { merged: true, html_url: 'https://github.com/a/b/pull/5' }))
    const client = new GithubClient({ token: 'ghp_test', fetchImpl })
    const defs = Object.fromEntries(createTools(client).map(t => [t.name, t]))
    const result = await defs['github_merge_pr'].execute({ owner: 'a', repo: 'b', prNumber: 5, mergeMethod: 'squash' }, exec())
    expect(result).toEqual({ ok: true, number: 5, url: 'https://github.com/a/b/pull/5' })
  })

  it('read-only stage 7 tools work without a token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, []))
    const client = new GithubClient({ fetchImpl })
    const defs = Object.fromEntries(createTools(client).map(t => [t.name, t]))
    const releases = await defs['github_list_releases'].execute({ owner: 'a', repo: 'b' }, exec())
    expect(releases).toEqual({ items: [] })
    const branches = await defs['github_list_branches'].execute({ owner: 'a', repo: 'b' }, exec())
    expect(branches).toEqual({ items: [] })
  })

  it('presentCall titles for stage 7 tools', () => {
    const defs = Object.fromEntries(createTools(new GithubClient()).map(t => [t.name, t])) as any
    expect(defs['github_merge_pr'].presentCall({ owner: 'a', repo: 'b', prNumber: 5 })).toMatchObject({ title: 'Merge PR #5', kind: 'edit' })
    expect(defs['github_list_releases'].presentCall({ owner: 'a', repo: 'b' })).toMatchObject({ kind: 'search' })
    expect(defs['github_list_branches'].presentCall({ owner: 'a', repo: 'b' })).toMatchObject({ kind: 'search' })
  })
})

describe('stage 9 tools', () => {
  it('write tools require a token', async () => {
    const defs = Object.fromEntries(createTools(new GithubClient({ fetchImpl: vi.fn() })).map(t => [t.name, t]))
    const branch = await defs['github_create_branch'].execute({ owner: 'a', repo: 'b', branch: 'feat/x' }, exec())
    expect(branch).toMatchObject({ ok: false })
    expect(branch.reason).toContain('token')
    const write = await defs['github_write_file'].execute({ owner: 'a', repo: 'b', path: 'x.md', content: 'y', message: 'm' }, exec())
    expect(write).toMatchObject({ ok: false })
    expect(write.reason).toContain('token')
  })

  it('read tools work without a token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      login: 'u', name: null, bio: null, followers: 0, following: 0, public_repos: 0, location: null, blog: null, html_url: 'https://x',
    }))
    const client = new GithubClient({ fetchImpl })
    const defs = Object.fromEntries(createTools(client).map(t => [t.name, t]))
    const user = await defs['github_get_user'].execute({ username: 'u' }, exec())
    expect(user).toMatchObject({ found: true, login: 'u' })
  })

  it('github_get_user returns found:false on 404', async () => {
    const client = new GithubClient({ fetchImpl: vi.fn(async () => jsonResponse(404, {})) })
    const tool = createTools(client).find(t => t.name === 'github_get_user')!
    const result = await tool.execute({ username: 'nobody' }, exec())
    expect(result).toEqual({ found: false })
  })

  it('github_write_file passes through to the client with a token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { commit: { sha: 'abc123' } }))
    const client = new GithubClient({ token: 'ghp_test', fetchImpl })
    const tool = createTools(client).find(t => t.name === 'github_write_file')!
    const result = await tool.execute({ owner: 'a', repo: 'b', path: 'x.md', content: 'y', message: 'm' }, exec())
    expect(result).toEqual({ ok: true, path: 'x.md', commitSha: 'abc123' })
  })

  it('presentCall for stage 9 tools', () => {
    const defs = Object.fromEntries(createTools(new GithubClient()).map(t => [t.name, t])) as any
    expect(defs['github_get_user'].presentCall({ username: 'u' })).toMatchObject({ kind: 'read' })
    expect(defs['github_list_workflow_runs'].presentCall({ owner: 'a', repo: 'b' })).toMatchObject({ kind: 'search' })
    expect(defs['github_create_branch'].presentCall({ owner: 'a', repo: 'b', branch: 'feat/x' })).toMatchObject({ kind: 'edit' })
    expect(defs['github_write_file'].presentCall({ owner: 'a', repo: 'b', path: 'x.md', content: '', message: '' })).toMatchObject({ kind: 'edit' })
  })
})
