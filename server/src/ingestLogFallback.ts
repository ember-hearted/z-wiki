// ingestLogFallback.ts - ingest 日志兜底(Interaction sibling helper,同 ingestSummary.ts 模式)。
// §5 要求 agent 每次 ingest 后追加 log.md,但只是 prompt 层约定,agent 会漏记(实测发生过)。
// 双层防御(ADR-0025):ingest 开始时快照 log.md mtime,agent 回合结束后未变(漏记)
// -> server 兜底追加补记条目。补记摘要直接复用编译小结(agent 收尾文本,ADR-0024),
// 不是纯机械文案;条目在「操作」栏标注 server 补记,供事后审计区分 agent 亲写条目。

import fs from 'node:fs/promises'
import path from 'node:path'
import { withFileLock } from './agentHost.js'

/** log.md 快照(mtime ms;文件不存在为 null)。ingest 开始时取,结束后比对。 */
export async function snapshotLogMtime(kbRoot: string): Promise<number | null> {
  try {
    const st = await fs.stat(path.join(kbRoot, 'log.md'))
    return st.mtimeMs
  } catch {
    return null
  }
}

/** 本地日期 YYYY-MM-DD(log.md 条目标题格式)。 */
function localDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 构造补记条目(纯函数,可测):§5 模板,「操作」栏标注 server 补记。 */
export function buildFallbackEntry(rawName: string, summary: string, now: Date): string {
  const date = localDate(now)
  return [
    '',
    `## [${date}] ingest | ${rawName}`,
    '',
    `- **操作**: ingest(server 补记)`,
    `- **涉及文件**: raw/${rawName} (source)`,
    `- **摘要**: ${summary.trim() || '编译完成(agent 未产出编译小结)'}`,
    '',
  ].join('\n')
}

/**
 * log.md 在 ingest 期间未被 agent 更新时,server 兜底追加补记条目,返回是否补记。
 * before 为 ingest 开始时 snapshotLogMtime 的快照;已变(agent 守约)则不动作。
 * 已知边界:并发 ingest 互相会撞 mtime(另一个 ingest 的写入会让本 ingest 跳过补记),
 * 并发 ingest 本就在 ADR-0024 固有边界内,不另做串行化。
 */
export async function appendIngestLogIfUntouched(
  kbRoot: string,
  before: number | null,
  rawName: string,
  summary: string,
): Promise<boolean> {
  const after = await snapshotLogMtime(kbRoot)
  if (after !== before) return false
  const logPath = path.join(kbRoot, 'log.md')
  await withFileLock(logPath, async () => {
    await fs.appendFile(logPath, buildFallbackEntry(rawName, summary, new Date()), 'utf-8')
  })
  return true
}
