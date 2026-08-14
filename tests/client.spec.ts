import { describe, expect, it, vi } from 'vitest'
import { GithubClient, GithubError } from '../src/client.ts'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('GithubClient', () => {
  it('fetches repo metadata with auth header and base URL', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      full_name: 'deepseek-ai/deepseek-harness',
      description: 'agent harness',
      stargazers_count: 25000,
      language: 'TypeScript',
      license: { spdx_id: 'MIT' },
      homepage: 'https://deepseek.com',
      updated_at: '2026-08-13T00:00:00Z',
    }))
    const client = new GithubClient({ token: 'ghp_test', fetchImpl })
    const repo = await client.getRepo('deepseek-ai', 'deepseek-harness')

    expect(repo).toEqual({
      owner: 'deepseek-ai',
      name: 'deepseek-harness',
      description: 'agent harness',
      stars: 25000,
      language: 'TypeScript',
      license: 'MIT',
      homepage: 'https://deepseek.com',
      updatedAt: '2026-08-13T00:00:00Z',
    })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/deepseek-ai/deepseek-harness')
    expect(init.headers).toMatchObject({ authorization: 'Bearer ghp_test' })
  })

  it('throws GithubError with status 404 when repo does not exist', async () => {
    const client = new GithubClient({ fetchImpl: vi.fn(async () => jsonResponse(404, {})) })
    await expect(client.getRepo('nope', 'missing')).rejects.toThrow(GithubError)
  })

  it('throws GithubError 401 when token is invalid', async () => {
    const client = new GithubClient({ fetchImpl: vi.fn(async () => jsonResponse(401, {})) })
    await expect(client.getRepo('a', 'b')).rejects.toMatchObject({ status: 401 })
  })

  it('throws GithubError 403 on rate limiting', async () => {
    const client = new GithubClient({ fetchImpl: vi.fn(async () => jsonResponse(403, {})) })
    await expect(client.getRepo('a', 'b')).rejects.toMatchObject({ status: 403 })
  })

  it('honors baseUrl override without trailing slash', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      full_name: 'a/b', description: null, stargazers_count: 0, language: null,
      license: null, homepage: null, updated_at: '2026-01-01T00:00:00Z',
    }))
    const client = new GithubClient({ baseUrl: 'https://github.example/api/', fetchImpl })
    await client.getRepo('a', 'b')
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url.startsWith('https://github.example/api/repos/')).toBe(true)
  })

  it('searchRepos builds the query string and maps items', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      total_count: 42,
      items: [{ full_name: 'deepseek-ai/deepseek-harness', description: 'agent harness', stargazers_count: 25000, language: 'TypeScript', html_url: 'https://github.com/deepseek-ai/deepseek-harness' }],
    }))
    const client = new GithubClient({ fetchImpl })
    const result = await client.searchRepos('agent harness', { sort: 'stars', order: 'desc', perPage: 5 })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/search/repositories?')
    expect(url).toContain('q=agent+harness')
    expect(url).toContain('sort=stars')
    expect(url).toContain('per_page=5')
    expect(result.total).toBe(42)
    expect(result.items[0]).toMatchObject({ fullName: 'deepseek-ai/deepseek-harness', stars: 25000 })
  })

  it('listIssues passes state, label, and per_page filters', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [
      { number: 1, title: 'Bug', state: 'open', labels: [{ name: 'bug' }], created_at: '2026-01-01T00:00:00Z', user: { login: 'alice' }, html_url: 'https://github.com/a/b/issues/1' },
    ]))
    const client = new GithubClient({ fetchImpl })
    const issues = await client.listIssues('a', 'b', { state: 'open', label: 'bug', perPage: 3 })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/repos/a/b/issues?')
    expect(url).toContain('state=open')
    expect(url).toContain('labels=bug')
    expect(url).toContain('per_page=3')
    expect(issues[0]).toMatchObject({ number: 1, title: 'Bug', labels: ['bug'], author: 'alice' })
  })

  it('searchCode requires the URLSearchParams shape and maps items', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      total_count: 7,
      items: [{ path: 'src/index.ts', repository: { full_name: 'a/b' }, html_url: 'https://github.com/a/b/blob/main/src/index.ts' }],
    }))
    const client = new GithubClient({ fetchImpl })
    const result = await client.searchCode('repo:a/b defineTool', { perPage: 5 })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/search/code?')
    expect(result.items[0]).toMatchObject({ path: 'src/index.ts', repository: 'a/b' })
  })

  it('createPrDraft POSTs draft:true and returns created result', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { number: 12, html_url: 'https://github.com/a/b/pull/12', draft: true }))
    const client = new GithubClient({ token: 'ghp_test', fetchImpl })
    const result = await client.createPrDraft('a', 'b', { title: 'My change', head: 'feat/x', base: 'main', body: 'Why' })
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ title: 'My change', head: 'feat/x', base: 'main', body: 'Why', draft: true })
    expect(result).toEqual({ created: true, number: 12, url: 'https://github.com/a/b/pull/12' })
  })

  it('createPrDraft maps 422 to a created:false business value', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(422, {}))
    const client = new GithubClient({ token: 'ghp_test', fetchImpl })
    const result = await client.createPrDraft('a', 'b', { title: 'x', head: 'feat/x', base: 'main' })
    expect(result.created).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it('hasToken reflects configured token', () => {
    expect(new GithubClient().hasToken()).toBe(false)
    expect(new GithubClient({ token: 'x' }).hasToken()).toBe(true)
  })
})

describe('GithubClient extended tools', () => {
  it('listPrs maps items and passes state/per_page', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [
      { number: 5, title: 'Fix', state: 'open', draft: true, user: { login: 'bob' }, head: { ref: 'feat/x' }, base: { ref: 'main' }, created_at: '2026-01-02T00:00:00Z', html_url: 'https://github.com/a/b/pull/5' },
    ]))
    const client = new GithubClient({ fetchImpl })
    const prs = await client.listPrs('a', 'b', { state: 'open', perPage: 5 })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/repos/a/b/pulls?')
    expect(url).toContain('state=open')
    expect(url).toContain('per_page=5')
    expect(prs[0]).toMatchObject({ number: 5, draft: true, headRef: 'feat/x', baseRef: 'main', author: 'bob' })
  })

  it('getFile requests the contents endpoint with optional ref', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      name: 'index.ts', path: 'src/index.ts', size: 42, content: 'aGVsbG8=', encoding: 'base64', html_url: 'https://x',
    }))
    const client = new GithubClient({ fetchImpl })
    const file = await client.getFile('a', 'b', 'src/index.ts', { ref: 'dev' })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/repos/a/b/contents/src%2Findex.ts?ref=dev')
    expect(file).toMatchObject({ name: 'index.ts', encoding: 'base64', content: 'aGVsbG8=' })
  })

  it('listCommits maps items and passes sha/author filters', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [
      { sha: 'abcdef1234567890', commit: { message: 'Initial commit\nbody', author: { name: 'Alice', date: '2026-01-01T00:00:00Z' } }, html_url: 'https://github.com/a/b/commit/abcdef' },
    ]))
    const client = new GithubClient({ fetchImpl })
    const commits = await client.listCommits('a', 'b', { branch: 'main', author: 'alice', perPage: 3 })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/repos/a/b/commits?')
    expect(url).toContain('sha=main')
    expect(url).toContain('author=alice')
    expect(commits[0]).toMatchObject({ sha: 'abcdef1', message: 'Initial commit', author: 'Alice' })
  })
})

describe('GithubClient write operations', () => {
  it('createIssue POSTs title/body/labels and returns ok', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { number: 7, html_url: 'https://github.com/a/b/issues/7' }))
    const client = new GithubClient({ token: 'ghp_test', fetchImpl })
    const result = await client.createIssue('a', 'b', { title: 'Bug', body: 'details', labels: ['bug'] })
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ title: 'Bug', body: 'details', labels: ['bug'] })
    expect(result).toEqual({ ok: true, number: 7, url: 'https://github.com/a/b/issues/7' })
  })

  it('createIssue maps 422 to a business failure value', async () => {
    const client = new GithubClient({ token: 'ghp_test', fetchImpl: vi.fn(async () => jsonResponse(422, {})) })
    const result = await client.createIssue('a', 'b', { title: 'Duplicate' })
    expect(result.ok).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it('commentOnIssue POSTs to the comments endpoint', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { id: 99, html_url: 'https://github.com/a/b/issues/7#issuecomment-99' }))
    const client = new GithubClient({ token: 'ghp_test', fetchImpl })
    const result = await client.commentOnIssue('a', 'b', 7, 'LGTM')
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/repos/a/b/issues/7/comments')
    expect(JSON.parse(String(init.body))).toEqual({ body: 'LGTM' })
    expect(result).toEqual({ ok: true, number: 99, url: 'https://github.com/a/b/issues/7#issuecomment-99' })
  })

  it('updateIssue PATCHes the state and maps 404', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { number: 7, html_url: 'https://github.com/a/b/issues/7' }))
    const client = new GithubClient({ token: 'ghp_test', fetchImpl })
    const result = await client.updateIssue('a', 'b', 7, 'closed')
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ state: 'closed' })
    expect(result).toEqual({ ok: true, number: 7, url: 'https://github.com/a/b/issues/7' })

    const client404 = new GithubClient({ token: 'ghp_test', fetchImpl: vi.fn(async () => jsonResponse(404, {})) })
    const missing = await client404.updateIssue('a', 'b', 999, 'closed')
    expect(missing).toMatchObject({ ok: false })
  })
})

describe('GithubClient stage 7', () => {
  it('mergePr PUTs merge_method and returns ok', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { merged: true, html_url: 'https://github.com/a/b/pull/5' }))
    const client = new GithubClient({ token: 'ghp_test', fetchImpl })
    const result = await client.mergePr('a', 'b', 5, { mergeMethod: 'squash' })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/repos/a/b/pulls/5/merge')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({ merge_method: 'squash' })
    expect(result).toEqual({ ok: true, number: 5, url: 'https://github.com/a/b/pull/5' })
  })

  it('mergePr maps 405 and 409 to business failures', async () => {
    for (const status of [405, 409]) {
      const client = new GithubClient({ token: 'ghp_test', fetchImpl: vi.fn(async () => jsonResponse(status, {})) })
      const result = await client.mergePr('a', 'b', 5)
      expect(result.ok).toBe(false)
      expect(result.reason).toBeTruthy()
    }
  })

  it('mergePr maps 404 to not found', async () => {
    const client = new GithubClient({ token: 'ghp_test', fetchImpl: vi.fn(async () => jsonResponse(404, {})) })
    const result = await client.mergePr('a', 'b', 999)
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('not found') })
  })

  it('listReleases maps items', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [
      { tag_name: 'v1.0.0', name: 'Release One', draft: false, prerelease: false, author: { login: 'carol' }, published_at: '2026-01-01T00:00:00Z', html_url: 'https://github.com/a/b/releases/v1' },
    ]))
    const client = new GithubClient({ fetchImpl })
    const releases = await client.listReleases('a', 'b', { perPage: 5 })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/repos/a/b/releases?')
    expect(url).toContain('per_page=5')
    expect(releases[0]).toMatchObject({ tagName: 'v1.0.0', author: 'carol' })
  })

  it('listBranches maps items with short SHA', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [
      { name: 'main', commit: { sha: 'abcdef1234567890' } },
      { name: 'dev', commit: { sha: '1234567890abcdef' } },
    ]))
    const client = new GithubClient({ fetchImpl })
    const branches = await client.listBranches('a', 'b', { perPage: 2 })
    expect(branches).toEqual([
      { name: 'main', sha: 'abcdef1' },
      { name: 'dev', sha: '1234567' },
    ])
  })
})

describe('GithubClient stage 8', () => {
  it('getIssue maps the issue detail', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      number: 3, title: 'Bug', state: 'open', user: { login: 'alice' }, created_at: '2026-01-01T00:00:00Z',
      labels: [{ name: 'bug' }], body: 'details', html_url: 'https://github.com/a/b/issues/3',
    }))
    const client = new GithubClient({ fetchImpl })
    const issue = await client.getIssue('a', 'b', 3)
    expect(issue).toEqual({
      number: 3, title: 'Bug', state: 'open', author: 'alice', createdAt: '2026-01-01T00:00:00Z',
      labels: ['bug'], body: 'details', url: 'https://github.com/a/b/issues/3',
    })
  })

  it('listIssueComments hits the issue comments endpoint', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [
      { id: 1, user: { login: 'bob' }, created_at: '2026-01-02T00:00:00Z', body: 'hi', html_url: 'https://x/1' },
    ]))
    const client = new GithubClient({ fetchImpl })
    const comments = await client.listIssueComments('a', 'b', 3, { perPage: 5 })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/repos/a/b/issues/3/comments?')
    expect(url).toContain('per_page=5')
    expect(comments[0]).toMatchObject({ id: 1, author: 'bob', body: 'hi' })
  })

  it('listPrComments hits the pulls comments endpoint', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [
      { id: 2, user: { login: 'carol' }, created_at: '2026-01-03T00:00:00Z', body: 'looks good', html_url: 'https://x/2' },
    ]))
    const client = new GithubClient({ fetchImpl })
    const comments = await client.listPrComments('a', 'b', 9, { perPage: 5 })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/repos/a/b/pulls/9/comments?')
    expect(comments[0]).toMatchObject({ id: 2, author: 'carol' })
  })
})

describe('GithubClient stage 9', () => {
  it('getUser maps the user profile', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      login: 'octocat', name: 'Octo Cat', bio: 'hello', followers: 100, following: 2,
      public_repos: 10, location: 'SF', blog: 'https://blog.example', html_url: 'https://github.com/octocat',
    }))
    const client = new GithubClient({ fetchImpl })
    const user = await client.getUser('octocat')
    expect(user).toEqual({
      login: 'octocat', name: 'Octo Cat', bio: 'hello', followers: 100, following: 2,
      publicRepos: 10, location: 'SF', blog: 'https://blog.example', url: 'https://github.com/octocat',
    })
  })

  it('listWorkflowRuns hits actions/runs with filters', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      workflow_runs: [{ id: 1, name: 'CI', head_branch: 'main', status: 'completed', conclusion: 'success', created_at: '2026-01-01T00:00:00Z', html_url: 'https://x/1' }],
    }))
    const client = new GithubClient({ fetchImpl })
    const runs = await client.listWorkflowRuns('a', 'b', { branch: 'main', status: 'success', perPage: 5 })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/repos/a/b/actions/runs?')
    expect(url).toContain('branch=main')
    expect(url).toContain('status=success')
    expect(runs[0]).toMatchObject({ workflowName: 'CI', headBranch: 'main', conclusion: 'success' })
  })

  it('createBranch resolves the base ref and POSTs a new ref', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { object: { sha: 'abc123' } }))
      .mockResolvedValueOnce(jsonResponse(201, {}))
    const client = new GithubClient({ token: 'ghp_test', fetchImpl })
    const result = await client.createBranch('a', 'b', 'feat/x', 'heads/main')
    const [baseUrl, postUrl, postInit] = [fetchImpl.mock.calls[0][0] as string, fetchImpl.mock.calls[1][0] as string, fetchImpl.mock.calls[1][1] as RequestInit]
    expect(baseUrl).toContain('/git/ref/heads/main')
    expect(postUrl).toContain('/git/refs')
    expect(postInit.method).toBe('POST')
    expect(JSON.parse(String(postInit.body))).toEqual({ ref: 'refs/heads/feat/x', sha: 'abc123' })
    expect(result).toEqual({ ok: true, name: 'feat/x' })
  })

  it('createBranch maps 422 to a business failure', async () => {
    const client = new GithubClient({ token: 'ghp_test', fetchImpl: vi.fn(async () => jsonResponse(422, {})) })
    const result = await client.createBranch('a', 'b', 'feat/x', 'heads/main')
    expect(result.ok).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it('writeFile PUTs base64 content and returns the commit SHA', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { commit: { sha: 'abcdef123456' } }))
    const client = new GithubClient({ token: 'ghp_test', fetchImpl })
    const result = await client.writeFile('a', 'b', 'docs/notes.md', 'hello', { message: 'add notes', branch: 'main' })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/repos/a/b/contents/docs%2Fnotes.md')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ message: 'add notes', branch: 'main' })
    expect(body.content).toBe(Buffer.from('hello').toString('base64'))
    expect(result).toEqual({ ok: true, path: 'docs/notes.md', commitSha: 'abcdef1' })
  })

  it('writeFile maps 422/409 to a business failure', async () => {
    for (const status of [422, 409]) {
      const client = new GithubClient({ token: 'ghp_test', fetchImpl: vi.fn(async () => jsonResponse(status, {})) })
      const result = await client.writeFile('a', 'b', 'x.md', 'y', { message: 'm' })
      expect(result.ok).toBe(false)
    }
  })
})
