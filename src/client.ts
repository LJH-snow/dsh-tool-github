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
}
