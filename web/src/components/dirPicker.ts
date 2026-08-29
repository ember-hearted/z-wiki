export interface DirEntry {
  name: string
  path: string
  hidden: boolean
}
export interface DirListing {
  path: string
  home: string
  crumbs: Array<{ name: string; path: string }>
  entries: DirEntry[]
  truncated: boolean
}
export type DirResponse = { listing: DirListing } | { error: string }

/** 构建 GET /api/dir 请求 URL。path 为空则不拼 query(缺省 home)。 */
export function buildDirUrl(path: string): string {
  return path ? `/api/dir?path=${encodeURIComponent(path)}` : '/api/dir'
}

/** 解码 GET /api/dir 响应:有 entries 数组视为 listing;否则取 error;否则意外。 */
export function decodeDir(json: unknown): DirResponse {
  if (json && typeof json === 'object' && Array.isArray((json as DirListing).entries)) {
    return { listing: json as DirListing }
  }
  const err = (json as { error?: string } | null)?.error
  return err ? { error: err } : { error: '意外响应' }
}

/** 隐藏文件过滤:showHidden=false 时滤掉点前缀目录。 */
export function filterHidden(entries: DirEntry[], showHidden: boolean): DirEntry[] {
  return showHidden ? entries : entries.filter((e) => !e.hidden)
}
