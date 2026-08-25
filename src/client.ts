import { inflateRawSync } from 'node:zlib'

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

export interface RepositoryCreateResult {
  ok: boolean
  fullName?: string
  url?: string
  reason?: string
}

export interface RepoTopicResult {
  ok: boolean
  names?: string[]
  reason?: string
}

export interface GistItem {
  id: string
  description: string
  files: string[]
  owner: string | null
  public: boolean
  createdAt: string
  updatedAt: string
  url: string
}

export interface GistCreateResult {
  ok: boolean
  id?: string
  url?: string
  reason?: string
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

export interface PullRequestDetail {
  number: number
  title: string
  state: string
  draft: boolean
  author: string
  headRef: string
  headSha: string
  baseRef: string
  baseSha: string
  body: string
  mergeable: boolean | null
  merged: boolean
  reviewDecision: string | null
  additions: number
  deletions: number
  changedFiles: number
  createdAt: string
  updatedAt: string
  mergedAt: string | null
  url: string
}

export interface PullRequestReviewItem {
  id: number
  author: string
  state: string
  body: string
  submittedAt: string
  commitSha: string | null
  url: string
}

export interface PrReviewersResult {
  ok: boolean
  prNumber?: number
  reviewers?: string[]
  reason?: string
}

export interface PrReviewSubmitResult {
  ok: boolean
  prNumber?: number
  reviewId?: number
  state?: string
  url?: string
  reason?: string
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

export interface UserInfo {
  login: string
  name: string | null
  bio: string | null
  followers: number
  following: number
  publicRepos: number
  location: string | null
  blog: string | null
  url: string
}

export interface WorkflowRunItem {
  id: number
  workflowName: string
  headBranch: string
  status: string
  conclusion: string | null
  createdAt: string
  url: string
}

export interface WorkflowItem {
  id: number
  name: string
  path: string
  state: string
  updatedAt: string
  url: string
}

export interface WorkflowRunDetail {
  id: number
  workflowId: number
  workflowName: string
  displayTitle: string
  headBranch: string
  headSha: string
  status: string
  conclusion: string | null
  event: string
  actor: string
  createdAt: string
  updatedAt: string
  runStartedAt: string | null
  url: string
}

export interface WorkflowJobStep {
  number: number
  name: string
  status: string
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
}

export interface WorkflowJobItem {
  id: number
  name: string
  status: string
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
  steps: WorkflowJobStep[]
  url: string
}

export interface WorkflowLogsResult {
  found: boolean
  logs?: string
  truncated?: boolean
  totalChars?: number
}

export interface WorkflowActionResult {
  ok: boolean
  runId?: number
  reason?: string
}

export interface WorkflowDispatchResult {
  ok: boolean
  workflowId?: number
  reason?: string
}

export interface BranchCreateResult {
  ok: boolean
  name?: string
  reason?: string
}

export interface FileWriteResult {
  ok: boolean
  path?: string
  commitSha?: string
  reason?: string
}

export interface ReadmeInfo {
  found: boolean
  content?: string
  size?: number
  url?: string
}

export interface TagItem {
  name: string
  commitSha: string
}

export interface StarResult {
  ok: boolean
  reason?: string
}

export interface ReleaseCreateResult {
  ok: boolean
  id?: number
  url?: string
  reason?: string
}

export type IssueState = 'open' | 'closed' | 'all'

export class GithubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function parseWorkflowLogZip(buffer: ArrayBuffer): string {
  const bytes = Buffer.from(buffer)
  const endMarker = 0x06054b50
  let endOffset = -1
  const start = Math.max(0, bytes.length - 0xffff - 22)
  for (let i = bytes.length - 22; i >= start; i -= 1) {
    if (bytes.readUInt32LE(i) === endMarker) {
      endOffset = i
      break
    }
  }
  if (endOffset < 0) throw new GithubError('Workflow logs archive is invalid', 502)

  const entryCount = bytes.readUInt16LE(endOffset + 10)
  const centralOffset = bytes.readUInt32LE(endOffset + 16)
  let offset = centralOffset
  const parts: string[] = []
  for (let i = 0; i < entryCount; i += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new GithubError('Workflow logs archive is invalid', 502)
    }
    const method = bytes.readUInt16LE(offset + 10)
    const compressedSize = bytes.readUInt32LE(offset + 20)
    const uncompressedSize = bytes.readUInt32LE(offset + 24)
    const nameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    const localOffset = bytes.readUInt32LE(offset + 42)
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    const next = offset + 46 + nameLength + extraLength + commentLength

    if (!name.endsWith('/')) {
      if (bytes.readUInt32LE(localOffset) !== 0x04034b50) {
        throw new GithubError('Workflow logs archive is invalid', 502)
      }
      const localNameLength = bytes.readUInt16LE(localOffset + 26)
      const localExtraLength = bytes.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + localNameLength + localExtraLength
      const raw = bytes.subarray(dataStart, dataStart + compressedSize)
      let content: Buffer
      if (method === 0) {
        content = Buffer.from(raw)
      } else if (method === 8) {
        content = inflateRawSync(raw)
      } else {
        throw new GithubError('Unsupported compression in workflow logs archive', 502)
      }
      if (content.length !== uncompressedSize) {
        throw new GithubError('Workflow logs archive is invalid', 502)
      }
      parts.push(`--- ${name} ---\n${content.toString('utf8')}`)
    }
    offset = next
  }
  return parts.join('\n')
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
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
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

  async getUser(username: string, signal?: AbortSignal): Promise<UserInfo> {
    const data = await this.request<{
      login: string
      name: string | null
      bio: string | null
      followers: number
      following: number
      public_repos: number
      location: string | null
      blog: string | null
      html_url: string
    }>(`/users/${encodeURIComponent(username)}`, { signal })
    return {
      login: data.login,
      name: data.name,
      bio: data.bio,
      followers: data.followers,
      following: data.following,
      publicRepos: data.public_repos,
      location: data.location,
      blog: data.blog,
      url: data.html_url,
    }
  }

  async listWorkflowRuns(owner: string, repo: string, options: { branch?: string; status?: string; perPage?: number; signal?: AbortSignal } = {}): Promise<WorkflowRunItem[]> {
    const params = new URLSearchParams({
      per_page: String(Math.max(1, Math.min(options.perPage ?? 10, 100))),
    })
    if (options.branch) params.set('branch', options.branch)
    if (options.status) params.set('status', options.status)
    const data = await this.request<{ workflow_runs: Array<{
      id: number
      name: string
      head_branch: string
      status: string
      conclusion: string | null
      created_at: string
      html_url: string
    }> }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?${params}`, { signal: options.signal })
    return data.workflow_runs.map(item => ({
      id: item.id,
      workflowName: item.name,
      headBranch: item.head_branch,
      status: item.status,
      conclusion: item.conclusion,
      createdAt: item.created_at,
      url: item.html_url,
    }))
  }

  async createBranch(owner: string, repo: string, branch: string, fromRef: string, signal?: AbortSignal): Promise<BranchCreateResult> {
    try {
      const base = await this.request<{ object: { sha: string } }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/${fromRef.split('/').map(encodeURIComponent).join('/')}`,
        { signal },
      )
      await this.request<unknown>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
        { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: base.object.sha }, signal },
      )
      return { ok: true, name: branch }
    } catch (error) {
      if (error instanceof GithubError && error.status === 422) {
        return { ok: false, name: branch, reason: 'Branch already exists or the ref is invalid.' }
      }
      throw error
    }
  }

  async writeFile(owner: string, repo: string, path: string, content: string, options: { message: string; branch?: string; signal?: AbortSignal }): Promise<FileWriteResult> {
    try {
      const data = await this.request<{ commit: { sha: string } }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}`,
        {
          method: 'PUT',
          body: {
            message: options.message,
            content: Buffer.from(content, 'utf8').toString('base64'),
            branch: options.branch,
          },
          signal: options.signal,
        },
      )
      return { ok: true, path, commitSha: data.commit.sha.slice(0, 7) }
    } catch (error) {
      if (error instanceof GithubError && (error.status === 422 || error.status === 409)) {
        return { ok: false, path, reason: 'Could not write the file (validation failed or the branch has conflicts).' }
      }
      throw error
    }
  }

  async getReadme(owner: string, repo: string, options: { ref?: string; signal?: AbortSignal } = {}): Promise<ReadmeInfo> {
    try {
      const query = options.ref ? `?ref=${encodeURIComponent(options.ref)}` : ''
      const data = await this.request<{ content: string; encoding: string; size: number; html_url: string }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme${query}`,
        { signal: options.signal },
      )
      const content = data.encoding === 'base64' ? Buffer.from(data.content, 'base64').toString('utf8') : data.content
      return { found: true, content, size: data.size, url: data.html_url }
    } catch (error) {
      if (error instanceof GithubError && error.status === 404) {
        return { found: false }
      }
      throw error
    }
  }

  async listTags(owner: string, repo: string, options: { perPage?: number; signal?: AbortSignal } = {}): Promise<TagItem[]> {
    const params = new URLSearchParams({
      per_page: String(Math.max(1, Math.min(options.perPage ?? 20, 100))),
    })
    const data = await this.request<Array<{ name: string; commit: { sha: string } }>>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags?${params}`,
      { signal: options.signal },
    )
    return data.map(item => ({ name: item.name, commitSha: item.commit.sha.slice(0, 7) }))
  }

  async starRepo(owner: string, repo: string, signal?: AbortSignal): Promise<StarResult> {
    try {
      await this.request<unknown>(`/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { method: 'PUT', signal })
      return { ok: true }
    } catch (error) {
      if (error instanceof GithubError && error.status === 404) {
        return { ok: false, reason: 'Repository not found.' }
      }
      throw error
    }
  }

  async unstarRepo(owner: string, repo: string, signal?: AbortSignal): Promise<StarResult> {
    try {
      await this.request<unknown>(`/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { method: 'DELETE', signal })
      return { ok: true }
    } catch (error) {
      if (error instanceof GithubError && error.status === 404) {
        return { ok: false, reason: 'Repository not found or not starred.' }
      }
      throw error
    }
  }

  async createRelease(owner: string, repo: string, input: { tagName: string; name?: string; body?: string; draft?: boolean; prerelease?: boolean }, signal?: AbortSignal): Promise<ReleaseCreateResult> {
    try {
      const data = await this.request<{ id: number; html_url: string }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`,
        {
          method: 'POST',
          body: {
            tag_name: input.tagName,
            name: input.name ?? input.tagName,
            body: input.body ?? '',
            draft: input.draft ?? false,
            prerelease: input.prerelease ?? false,
          },
          signal,
        },
      )
      return { ok: true, id: data.id, url: data.html_url }
    } catch (error) {
      if (error instanceof GithubError && error.status === 422) {
        return { ok: false, reason: 'Validation failed (e.g. the tag does not exist or the release already exists).' }
      }
      throw error
    }
  }

  async createRepository(input: { owner?: string; name: string; description?: string; privateRepo?: boolean; autoInit?: boolean }, signal?: AbortSignal): Promise<RepositoryCreateResult> {
    const path = input.owner ? `/orgs/${encodeURIComponent(input.owner)}/repos` : '/user/repos'
    try {
      const data = await this.request<{ full_name: string; html_url: string }>(path, {
        method: 'POST',
        body: {
          name: input.name,
          description: input.description ?? '',
          private: input.privateRepo ?? false,
          auto_init: input.autoInit ?? false,
        },
        signal,
      })
      return { ok: true, fullName: data.full_name, url: data.html_url }
    } catch (error) {
      if (error instanceof GithubError && (error.status === 404 || error.status === 409 || error.status === 422)) {
        return { ok: false, reason: 'Could not create the repository (missing owner, duplicate name, or invalid settings).' }
      }
      throw error
    }
  }

  async setRepoTopic(owner: string, repo: string, names: string[], signal?: AbortSignal): Promise<RepoTopicResult> {
    try {
      const data = await this.request<{ names: string[] }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/topics`,
        { method: 'PUT', body: { names }, signal },
      )
      return { ok: true, names: data.names }
    } catch (error) {
      if (error instanceof GithubError && (error.status === 404 || error.status === 422)) {
        return { ok: false, reason: 'Could not update topics (repository not found or a topic is invalid).' }
      }
      throw error
    }
  }

  async listGists(options: { perPage?: number; signal?: AbortSignal } = {}): Promise<GistItem[]> {
    const params = new URLSearchParams({
      per_page: String(Math.max(1, Math.min(options.perPage ?? 20, 100))),
    })
    const data = await this.request<Array<{
      id: string
      description: string | null
      files: Record<string, unknown>
      owner: { login: string } | null
      public: boolean
      created_at: string
      updated_at: string
      html_url: string
    }>>(`/gists?${params}`, { signal: options.signal })
    return data.map(item => ({
      id: item.id,
      description: item.description ?? '',
      files: Object.keys(item.files ?? {}),
      owner: item.owner?.login ?? null,
      public: item.public,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      url: item.html_url,
    }))
  }

  async createGist(input: { description?: string; publicGist?: boolean; files: Array<{ filename: string; content: string }> }, signal?: AbortSignal): Promise<GistCreateResult> {
    try {
      const files: Record<string, { content: string }> = {}
      for (const file of input.files) files[file.filename] = { content: file.content }
      const data = await this.request<{ id: string; html_url: string }>('/gists', {
        method: 'POST',
        body: {
          description: input.description ?? '',
          public: input.publicGist ?? false,
          files,
        },
        signal,
      })
      return { ok: true, id: data.id, url: data.html_url }
    } catch (error) {
      if (error instanceof GithubError && (error.status === 404 || error.status === 422)) {
        return { ok: false, reason: 'Could not create the gist (invalid files or description).' }
      }
      throw error
    }
  }

  async listWorkflows(owner: string, repo: string, options: { perPage?: number; signal?: AbortSignal } = {}): Promise<{ total: number; items: WorkflowItem[] }> {
    const params = new URLSearchParams({
      per_page: String(Math.max(1, Math.min(options.perPage ?? 10, 100))),
    })
    const data = await this.request<{
      total_count: number
      workflows: Array<{
        id: number
        name: string
        path: string
        state: string
        updated_at: string
        html_url: string
      }>
    }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows?${params}`, { signal: options.signal })
    return {
      total: data.total_count,
      items: data.workflows.map(item => ({
        id: item.id,
        name: item.name,
        path: item.path,
        state: item.state,
        updatedAt: item.updated_at,
        url: item.html_url,
      })),
    }
  }

  async getWorkflow(owner: string, repo: string, workflowId: number, signal?: AbortSignal): Promise<WorkflowItem> {
    const data = await this.request<{
      id: number
      name: string
      path: string
      state: string
      updated_at: string
      html_url: string
    }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${workflowId}`, { signal })
    return {
      id: data.id,
      name: data.name,
      path: data.path,
      state: data.state,
      updatedAt: data.updated_at,
      url: data.html_url,
    }
  }

  async getWorkflowRun(owner: string, repo: string, runId: number, signal?: AbortSignal): Promise<WorkflowRunDetail> {
    const data = await this.request<{
      id: number
      workflow_id: number
      name: string | null
      display_title: string
      head_branch: string
      head_sha: string
      status: string
      conclusion: string | null
      event: string
      actor: { login: string } | null
      created_at: string
      updated_at: string
      run_started_at: string | null
      html_url: string
    }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}`, { signal })
    return {
      id: data.id,
      workflowId: data.workflow_id,
      workflowName: data.name ?? data.display_title,
      displayTitle: data.display_title,
      headBranch: data.head_branch,
      headSha: data.head_sha,
      status: data.status,
      conclusion: data.conclusion,
      event: data.event,
      actor: data.actor?.login ?? 'unknown',
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      runStartedAt: data.run_started_at,
      url: data.html_url,
    }
  }

  async listWorkflowJobs(owner: string, repo: string, runId: number, options: { perPage?: number; signal?: AbortSignal } = {}): Promise<{ found: boolean; items: WorkflowJobItem[] }> {
    const params = new URLSearchParams({
      per_page: String(Math.max(1, Math.min(options.perPage ?? 30, 100))),
    })
    const data = await this.request<{ jobs: Array<{
      id: number
      name: string
      status: string
      conclusion: string | null
      started_at: string | null
      completed_at: string | null
      html_url: string
      steps: Array<{
        number: number
        name: string
        status: string
        conclusion: string | null
        started_at: string | null
        completed_at: string | null
      }>
    }> }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/jobs?${params}`, { signal: options.signal })
    return {
      found: true,
      items: data.jobs.map(job => ({
        id: job.id,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        steps: (job.steps ?? []).map(step => ({
          number: step.number,
          name: step.name,
          status: step.status,
          conclusion: step.conclusion,
          startedAt: step.started_at,
          completedAt: step.completed_at,
        })),
        url: job.html_url,
      })),
    }
  }

  async getWorkflowRunLogs(owner: string, repo: string, runId: number, options: { maxChars?: number; signal?: AbortSignal } = {}): Promise<WorkflowLogsResult> {
    const url = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/logs`
    const res = await this.fetchImpl(`${this.baseUrl}${url}`, {
      headers: this.headers(),
      method: 'GET',
      signal: this.combinedSignal(options.signal),
    })
    if (res.status === 404) throw new GithubError('Not found', 404)
    if (res.status === 401) throw new GithubError('Invalid or missing GitHub token', 401)
    if (res.status === 403) throw new GithubError('GitHub rate limit exceeded or forbidden', 403)
    if (!res.ok) throw new GithubError(`GitHub API error ${res.status}`, res.status)

    const logs = parseWorkflowLogZip(await res.arrayBuffer())
    const maxChars = options.maxChars && options.maxChars > 0 ? options.maxChars : 200_000
    if (logs.length > maxChars) {
      return { found: true, logs: logs.slice(0, maxChars), truncated: true, totalChars: logs.length }
    }
    return { found: true, logs, totalChars: logs.length }
  }

  async rerunWorkflowRun(owner: string, repo: string, runId: number, signal?: AbortSignal): Promise<WorkflowActionResult> {
    try {
      await this.request<unknown>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/rerun`,
        { method: 'POST', body: {}, signal },
      )
      return { ok: true, runId }
    } catch (error) {
      if (error instanceof GithubError && (error.status === 404 || error.status === 409)) {
        return { ok: false, runId, reason: 'Cannot rerun this workflow run (not found or another run is already in progress).' }
      }
      throw error
    }
  }

  async cancelWorkflowRun(owner: string, repo: string, runId: number, signal?: AbortSignal): Promise<WorkflowActionResult> {
    try {
      await this.request<unknown>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/cancel`,
        { method: 'POST', body: {}, signal },
      )
      return { ok: true, runId }
    } catch (error) {
      if (error instanceof GithubError && (error.status === 404 || error.status === 409)) {
        return { ok: false, runId, reason: 'Cannot cancel this workflow run (not found or the run is already complete).' }
      }
      throw error
    }
  }

  async dispatchWorkflow(owner: string, repo: string, workflowId: number, input: { ref: string; inputs?: Record<string, string> }, signal?: AbortSignal): Promise<WorkflowDispatchResult> {
    try {
      const body: Record<string, unknown> = { ref: input.ref }
      if (input.inputs && Object.keys(input.inputs).length > 0) {
        body.inputs = input.inputs
      }
      await this.request<unknown>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${workflowId}/dispatches`,
        { method: 'POST', body, signal },
      )
      return { ok: true, workflowId }
    } catch (error) {
      if (error instanceof GithubError && (error.status === 404 || error.status === 422)) {
        return { ok: false, workflowId, reason: 'Cannot dispatch this workflow (not found, or the ref/inputs are invalid).' }
      }
      throw error
    }
  }

  async getPullRequest(owner: string, repo: string, prNumber: number, signal?: AbortSignal): Promise<PullRequestDetail> {
    const data = await this.request<{
      number: number
      title: string
      state: string
      draft: boolean
      user: { login: string } | null
      head: { ref: string; sha: string }
      base: { ref: string; sha: string }
      body: string | null
      mergeable: boolean | null
      merged: boolean
      review_decision: string | null
      additions: number
      deletions: number
      changed_files: number
      created_at: string
      updated_at: string
      merged_at: string | null
      html_url: string
    }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}`, { signal })
    return {
      number: data.number,
      title: data.title,
      state: data.state,
      draft: data.draft,
      author: data.user?.login ?? 'unknown',
      headRef: data.head.ref,
      headSha: data.head.sha,
      baseRef: data.base.ref,
      baseSha: data.base.sha,
      body: data.body ?? '',
      mergeable: data.mergeable,
      merged: data.merged,
      reviewDecision: data.review_decision,
      additions: data.additions,
      deletions: data.deletions,
      changedFiles: data.changed_files,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      mergedAt: data.merged_at,
      url: data.html_url,
    }
  }

  async listPullRequestReviews(owner: string, repo: string, prNumber: number, options: { perPage?: number; signal?: AbortSignal } = {}): Promise<PullRequestReviewItem[]> {
    const params = new URLSearchParams({
      per_page: String(Math.max(1, Math.min(options.perPage ?? 20, 100))),
    })
    const data = await this.request<Array<{
      id: number
      user: { login: string } | null
      state: string
      body: string | null
      submitted_at: string
      commit_id: string
      html_url: string
    }>>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/reviews?${params}`, { signal: options.signal })
    return data.map(item => ({
      id: item.id,
      author: item.user?.login ?? 'unknown',
      state: item.state,
      body: item.body ?? '',
      submittedAt: item.submitted_at,
      commitSha: item.commit_id || null,
      url: item.html_url,
    }))
  }

  async requestPrReviewers(owner: string, repo: string, prNumber: number, input: { reviewers?: string[]; teamReviewers?: string[] }, signal?: AbortSignal): Promise<PrReviewersResult> {
    try {
      const body: Record<string, string[]> = {}
      if (input.reviewers && input.reviewers.length > 0) body.reviewers = input.reviewers
      if (input.teamReviewers && input.teamReviewers.length > 0) body.team_reviewers = input.teamReviewers
      const data = await this.request<{
        number: number
        requested_reviewers: Array<{ login: string }>
      }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/requested_reviewers`,
        { method: 'POST', body, signal },
      )
      return { ok: true, prNumber: data.number, reviewers: data.requested_reviewers.map(reviewer => reviewer.login) }
    } catch (error) {
      if (error instanceof GithubError && (error.status === 404 || error.status === 422)) {
        return { ok: false, prNumber, reason: 'Could not request reviewers (PR not found or a reviewer is invalid).' }
      }
      throw error
    }
  }

  async submitPrReview(owner: string, repo: string, prNumber: number, input: { body: string; event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' }, signal?: AbortSignal): Promise<PrReviewSubmitResult> {
    try {
      const data = await this.request<{ id: number; state: string; html_url: string }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/reviews`,
        { method: 'POST', body: { body: input.body, event: input.event }, signal },
      )
      return { ok: true, reviewId: data.id, state: data.state, url: data.html_url }
    } catch (error) {
      if (error instanceof GithubError && (error.status === 404 || error.status === 422)) {
        return { ok: false, prNumber, reason: 'Could not submit the review (PR not found or the review payload is invalid).' }
      }
      throw error
    }
  }
}
