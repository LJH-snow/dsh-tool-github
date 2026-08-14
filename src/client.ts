/** GitHub REST client with injected fetch for testability. */

export interface GithubClientOptions {
  baseUrl?: string
  token?: string
  fetchImpl?: typeof fetch
  /** Request timeout in milliseconds. 0 disables the timeout. */
  timeoutMs?: number
}

export interface RepoInfo {
  owner: string
  name: string
  description: string | null
  stars: number
  language: string | null
  license: string | null
  homepage: string | null
  updatedAt: string | null
}

export interface RepoSearchItem {
  fullName: string
  description: string | null
  stars: number
  language: string | null
  url: string
}

export interface IssueItem {
  number: number
  title: string
  state: string
  labels: string[]
  createdAt: string
  author: string
  url: string
}

export interface CodeSearchItem {
  path: string
  repository: string
  url: string
}

export interface PrDraftResult {
  created: boolean
  number?: number
  url?: string
  reason?: string
}

export interface PrItem {
  number: number
  title: string
  state: string
  draft: boolean
  author: string
  headRef: string
  baseRef: string
  createdAt: string
  url: string
}

export interface FileContent {
  name: string
  path: string
  size: number
  content: string
  encoding: string
  url: string
}

export interface CommitItem {
  sha: string
  message: string
  author: string
  date: string
  url: string
}

export interface IssueWriteResult {
  ok: boolean
  number?: number
  url?: string
  reason?: string
}

export interface ReleaseItem {
  tagName: string
  name: string
  draft: boolean
  prerelease: boolean
  author: string
  publishedAt: string
  url: string
}

export interface BranchItem {
  name: string
  sha: string
}

export interface IssueDetail {
  number: number
  title: string
  state: string
  author: string
  createdAt: string
  labels: string[]
  body: string
  url: string
}

export interface CommentItem {
  id: number
  author: string
  createdAt: string
  body: string
  url: string
}

export type IssueState = 'open' | 'closed' | 'all'

export class GithubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export class GithubClient {
  private readonly baseUrl: string
  private readonly token: string | undefined
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: GithubClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/$/, '')
    this.token = options.token
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  hasToken(): boolean {
    return Boolean(this.token)
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'dsh-tool-github',
    }
    if (this.token) headers.authorization = `Bearer ${this.token}`
    return headers
  }

  private combinedSignal(signal?: AbortSignal): AbortSignal | undefined {
    if (this.timeoutMs <= 0) return signal
    const timeout = AbortSignal.timeout(this.timeoutMs)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private async request<T>(path: string, options: { signal?: AbortSignal; method?: string; body?: unknown } = {}): Promise<T> {
    const headers = this.headers()
    const init: RequestInit = { headers, method: options.method ?? 'GET', signal: this.combinedSignal(options.signal) }
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(options.body)
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, init)
    if (res.status === 404) throw new GithubError('Not found', 404)
    if (res.status === 401) throw new GithubError('Invalid or missing GitHub token', 401)
    if (res.status === 403) throw new GithubError('GitHub rate limit exceeded or forbidden', 403)
    if (!res.ok) throw new GithubError(`GitHub API error ${res.status}`, res.status)
    return (await res.json()) as T
  }

  async getRepo(owner: string, repo: string, signal?: AbortSignal): Promise<RepoInfo> {
    const data = await this.request<{
      full_name: string
      description: string | null
      stargazers_count: number
      language: string | null
      license: { spdx_id: string } | null
      homepage: string | null
      updated_at: string
    }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { signal })
    const [ownerName, name] = data.full_name.split('/')
    return {
      owner: ownerName,
      name,
      description: data.description,
      stars: data.stargazers_count,
      language: data.language,
      license: data.license?.spdx_id ?? null,
      homepage: data.homepage,
      updatedAt: data.updated_at,
    }
  }

  async searchRepos(query: string, options: { sort?: 'stars' | 'forks' | 'updated'; order?: 'asc' | 'desc'; perPage?: number; signal?: AbortSignal } = {}): Promise<{ total: number; items: RepoSearchItem[] }> {
    const params = new URLSearchParams({
      q: query,
      sort: options.sort ?? 'stars',
      order: options.order ?? 'desc',
      per_page: String(Math.max(1, Math.min(options.perPage ?? 5, 100))),
    })
    const data = await this.request<{
      total_count: number
      items: Array<{ full_name: string; description: string | null; stargazers_count: number; language: string | null; html_url: string }>
    }>(`/search/repositories?${params}`, { signal: options.signal })
    return {
      total: data.total_count,
      items: data.items.map(item => ({
        fullName: item.full_name,
        description: item.description,
        stars: item.stargazers_count,
        language: item.language,
        url: item.html_url,
      })),
    }
  }

  async listIssues(owner: string, repo: string, options: { state?: IssueState; label?: string; perPage?: number; signal?: AbortSignal } = {}): Promise<IssueItem[]> {
    const params = new URLSearchParams({
      state: options.state ?? 'open',
      per_page: String(Math.max(1, Math.min(options.perPage ?? 10, 100))),
    })
    if (options.label) params.set('labels', options.label)
    const data = await this.request<Array<{
      number: number
      title: string
      state: string
      labels: Array<{ name: string }>
      created_at: string
      user: { login: string } | null
      html_url: string
    }>>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?${params}`, { signal: options.signal })
    return data.map(item => ({
      number: item.number,
      title: item.title,
      state: item.state,
      labels: item.labels.map(label => label.name),
      createdAt: item.created_at,
      author: item.user?.login ?? 'unknown',
      url: item.html_url,
    }))
  }

  async searchCode(query: string, options: { perPage?: number; signal?: AbortSignal } = {}): Promise<{ total: number; items: CodeSearchItem[] }> {
    const params = new URLSearchParams({
      q: query,
      per_page: String(Math.max(1, Math.min(options.perPage ?? 5, 100))),
    })
    const data = await this.request<{
      total_count: number
      items: Array<{ path: string; repository: { full_name: string }; html_url: string }>
    }>(`/search/code?${params}`, { signal: options.signal })
    return {
      total: data.total_count,
      items: data.items.map(item => ({
        path: item.path,
        repository: item.repository.full_name,
        url: item.html_url,
      })),
    }
  }

  async listPrs(owner: string, repo: string, options: { state?: 'open' | 'closed' | 'all'; perPage?: number; signal?: AbortSignal } = {}): Promise<PrItem[]> {
    const params = new URLSearchParams({
      state: options.state ?? 'open',
      per_page: String(Math.max(1, Math.min(options.perPage ?? 10, 100))),
    })
    const data = await this.request<Array<{
      number: number
      title: string
      state: string
      draft: boolean
      user: { login: string } | null
      head: { ref: string }
      base: { ref: string }
      created_at: string
      html_url: string
    }>>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?${params}`, { signal: options.signal })
    return data.map(item => ({
      number: item.number,
      title: item.title,
      state: item.state,
      draft: item.draft,
      author: item.user?.login ?? 'unknown',
      headRef: item.head.ref,
      baseRef: item.base.ref,
      createdAt: item.created_at,
      url: item.html_url,
    }))
  }

  async getFile(owner: string, repo: string, path: string, options: { ref?: string; signal?: AbortSignal } = {}): Promise<FileContent> {
    const query = options.ref ? `?ref=${encodeURIComponent(options.ref)}` : ''
    const data = await this.request<{
      name: string
      path: string
      size: number
      content: string
      encoding: string
      html_url: string
    }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}${query}`, { signal: options.signal })
    return {
      name: data.name,
      path: data.path,
      size: data.size,
      content: data.content,
      encoding: data.encoding,
      url: data.html_url,
    }
  }

  async listCommits(owner: string, repo: string, options: { branch?: string; author?: string; perPage?: number; signal?: AbortSignal } = {}): Promise<CommitItem[]> {
    const params = new URLSearchParams({
      per_page: String(Math.max(1, Math.min(options.perPage ?? 10, 100))),
    })
    if (options.branch) params.set('sha', options.branch)
    if (options.author) params.set('author', options.author)
    const data = await this.request<Array<{
      sha: string
      commit: { message: string; author: { name: string; date: string } }
      html_url: string
    }>>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?${params}`, { signal: options.signal })
    return data.map(item => ({
      sha: item.sha.slice(0, 7),
      message: item.commit.message.split('\n')[0],
      author: item.commit.author.name,
      date: item.commit.author.date,
      url: item.html_url,
    }))
  }

  async createIssue(owner: string, repo: string, input: { title: string; body?: string; labels?: string[] }, signal?: AbortSignal): Promise<IssueWriteResult> {
    try {
      const data = await this.request<{ number: number; html_url: string }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
        {
          method: 'POST',
          body: { title: input.title, body: input.body ?? '', labels: input.labels ?? [] },
          signal,
        },
      )
      return { ok: true, number: data.number, url: data.html_url }
    } catch (error) {
      if (error instanceof GithubError && error.status === 422) {
        return { ok: false, reason: 'Validation failed (e.g. an issue with this title already exists, or an invalid label).' }
      }
      throw error
    }
  }

  async commentOnIssue(owner: string, repo: string, issueNumber: number, body: string, signal?: AbortSignal): Promise<IssueWriteResult> {
    try {
      const data = await this.request<{ id: number; html_url: string }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments`,
        { method: 'POST', body: { body }, signal },
      )
      return { ok: true, number: data.id, url: data.html_url }
    } catch (error) {
      if (error instanceof GithubError && error.status === 422) {
        return { ok: false, reason: 'Comment validation failed (e.g. the issue is locked or the comment is empty).' }
      }
      throw error
    }
  }

  async updateIssue(owner: string, repo: string, issueNumber: number, state: 'open' | 'closed', signal?: AbortSignal): Promise<IssueWriteResult> {
    try {
      const data = await this.request<{ number: number; html_url: string }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`,
        { method: 'PATCH', body: { state }, signal },
      )
      return { ok: true, number: data.number, url: data.html_url }
    } catch (error) {
      if (error instanceof GithubError && error.status === 404) {
        return { ok: false, reason: 'Issue not found.' }
      }
      throw error
    }
  }

  async createPrDraft(owner: string, repo: string, input: { title: string; head: string; base: string; body?: string }, signal?: AbortSignal): Promise<PrDraftResult> {
    try {
      const data = await this.request<{ number: number; html_url: string; draft: boolean }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
        {
          method: 'POST',
          body: { title: input.title, head: input.head, base: input.base, body: input.body ?? '', draft: true },
          signal,
        },
      )
      return { created: true, number: data.number, url: data.html_url }
    } catch (error) {
      if (error instanceof GithubError && error.status === 422) {
        return { created: false, reason: 'Validation failed (e.g. the head branch does not exist or a pull request already exists).' }
      }
      throw error
    }
  }

  async mergePr(owner: string, repo: string, prNumber: number, options: { mergeMethod?: 'merge' | 'squash' | 'rebase'; signal?: AbortSignal } = {}): Promise<IssueWriteResult> {
    try {
      const data = await this.request<{ merged: boolean; html_url: string }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/merge`,
        { method: 'PUT', body: { merge_method: options.mergeMethod ?? 'merge' }, signal: options.signal },
      )
      return { ok: data.merged, number: prNumber, url: data.html_url }
    } catch (error) {
      if (error instanceof GithubError && (error.status === 405 || error.status === 409)) {
        return { ok: false, number: prNumber, reason: 'Pull request is not mergeable (e.g. conflicts, pending checks, or already merged).' }
      }
      if (error instanceof GithubError && error.status === 404) {
        return { ok: false, number: prNumber, reason: 'Pull request not found.' }
      }
      throw error
    }
  }

  async listReleases(owner: string, repo: string, options: { perPage?: number; signal?: AbortSignal } = {}): Promise<ReleaseItem[]> {
    const params = new URLSearchParams({
      per_page: String(Math.max(1, Math.min(options.perPage ?? 10, 100))),
    })
    const data = await this.request<Array<{
      tag_name: string
      name: string
      draft: boolean
      prerelease: boolean
      author: { login: string } | null
      published_at: string | null
      html_url: string
    }>>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?${params}`, { signal: options.signal })
    return data.map(item => ({
      tagName: item.tag_name,
      name: item.name,
      draft: item.draft,
      prerelease: item.prerelease,
      author: item.author?.login ?? 'unknown',
      publishedAt: item.published_at ?? '',
      url: item.html_url,
    }))
  }

  async listBranches(owner: string, repo: string, options: { perPage?: number; signal?: AbortSignal } = {}): Promise<BranchItem[]> {
    const params = new URLSearchParams({
      per_page: String(Math.max(1, Math.min(options.perPage ?? 20, 100))),
    })
    const data = await this.request<Array<{ name: string; commit: { sha: string } }>>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?${params}`,
      { signal: options.signal },
    )
    return data.map(item => ({ name: item.name, sha: item.commit.sha.slice(0, 7) }))
  }

  async getIssue(owner: string, repo: string, issueNumber: number, signal?: AbortSignal): Promise<IssueDetail> {
    const data = await this.request<{
      number: number
      title: string
      state: string
      user: { login: string } | null
      created_at: string
      labels: Array<{ name: string }>
      body: string | null
      html_url: string
    }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`, { signal })
    return {
      number: data.number,
      title: data.title,
      state: data.state,
      author: data.user?.login ?? 'unknown',
      createdAt: data.created_at,
      labels: data.labels.map(label => label.name),
      body: data.body ?? '',
      url: data.html_url,
    }
  }

  async listIssueComments(owner: string, repo: string, issueNumber: number, options: { perPage?: number; signal?: AbortSignal } = {}): Promise<CommentItem[]> {
    const params = new URLSearchParams({
      per_page: String(Math.max(1, Math.min(options.perPage ?? 20, 100))),
    })
    const data = await this.request<Array<{
      id: number
      user: { login: string } | null
      created_at: string
      body: string
      html_url: string
    }>>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments?${params}`, { signal: options.signal })
    return data.map(item => ({
      id: item.id,
      author: item.user?.login ?? 'unknown',
      createdAt: item.created_at,
      body: item.body,
      url: item.html_url,
    }))
  }

  async listPrComments(owner: string, repo: string, prNumber: number, options: { perPage?: number; signal?: AbortSignal } = {}): Promise<CommentItem[]> {
    const params = new URLSearchParams({
      per_page: String(Math.max(1, Math.min(options.perPage ?? 20, 100))),
    })
    const data = await this.request<Array<{
      id: number
      user: { login: string } | null
      created_at: string
      body: string
      html_url: string
    }>>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/comments?${params}`, { signal: options.signal })
    return data.map(item => ({
      id: item.id,
      author: item.user?.login ?? 'unknown',
      createdAt: item.created_at,
      body: item.body,
      url: item.html_url,
    }))
  }
}
