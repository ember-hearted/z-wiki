// server/src/dirPicker.ts
import { readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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

/** 校验 wire 传来的 path 值:只接受绝对路径;含 .. 段拒绝;空缺省(home)。绝不 resolve 到 cwd。 */
export function validateDirPath(raw: unknown): { path: string } | { error: string } {
  if (raw === undefined || raw === null || raw === '') return { path: '' }
  if (typeof raw !== 'string') return { error: 'path 必须是字符串' }
  if (!path.isAbsolute(raw))
    return { error: `path 必须是绝对路径(拒绝相对路径,绝不 resolve):${raw}` }
  // 在 normalize 前按分隔符切段检测 `..`,否则 `/a/../b` 会被归一化掉而漏检。
  const segs = raw.split(/[\\/]/).filter(Boolean)
  if (segs.includes('..')) return { error: `path 含 .. 段,拒绝:${raw}` }
  return { path: raw }
}

/** 校验建目录名:单一非空段,不含路径分隔符、. 或 ..。 */
export function validateDirName(raw: unknown): { name: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'name 必须是字符串' }
  const name = raw.trim()
  if (!name) return { error: 'name 不能为空' }
  if (name === '.' || name === '..') return { error: 'name 不能是 . 或 ..' }
  if (name.includes('/') || name.includes('\\')) return { error: `name 不能含路径分隔符:${name}` }
  return { name }
}

/** 从文件系统根到目标的 breadcrumbs(每段一个绝对路径)。 */
export function buildCrumbs(absPath: string): Array<{ name: string; path: string }> {
  const parsed = path.parse(absPath)
  const root = parsed.root || path.sep
  // 用正斜杠或反斜杠分割,兼容 POSIX 与 Windows(win32 的 path.sep 是 \ 但输入也可能带 /)。
  const segs = absPath.slice(parsed.root.length).split(/[\\/]/).filter(Boolean)
  // 取输入实际出现的段分隔符,保证拼接出的 crumb path 与原输入风格一致(测试以正斜杠断言)。
  const sep = absPath.includes('\\') ? '\\' : '/'
  const crumbs: Array<{ name: string; path: string }> = [
    { name: root === path.sep ? '/' : root, path: root },
  ]
  let cur = root
  for (const seg of segs) {
    cur = cur.endsWith(sep) ? cur + seg : cur + sep + seg
    crumbs.push({ name: seg, path: cur })
  }
  return crumbs
}

/** 枚举目录,只回目录(isDirectory 或 symlink-to-dir),按名排序,hidden=点前缀,maxEntries 截断。 */
export async function listDirectory(
  absPath: string,
  opts: { maxEntries?: number } = {},
): Promise<DirListing> {
  const maxEntries = opts.maxEntries ?? 200
  const den = await readdir(absPath, { withFileTypes: true })
  const dirs: DirEntry[] = []
  for (const de of den) {
    let isDir = de.isDirectory()
    if (de.isSymbolicLink()) {
      try {
        isDir = (await stat(path.join(absPath, de.name))).isDirectory()
      } catch {
        isDir = false // broken/cyclic symlink 跳过
      }
    }
    if (!isDir) continue
    dirs.push({ name: de.name, path: path.join(absPath, de.name), hidden: de.name.startsWith('.') })
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name))
  const truncated = dirs.length > maxEntries
  const entries = truncated ? dirs.slice(0, maxEntries) : dirs
  return {
    path: absPath,
    home: os.homedir(),
    crumbs: buildCrumbs(absPath),
    entries,
    truncated,
  }
}
