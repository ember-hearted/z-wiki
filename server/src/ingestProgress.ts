// ingestProgress.ts - ingest agent 事件 -> 里程碑进度百分比(ADR-0019)。
//
// ingest 是 LLM 回合,无真实百分比;用 agent 工具调用里程碑锚定阶段边界,
// 锚点间由前端时间插值(不超)。100% 由 ingest_done 承担(不在此常量)。
// 前后端共享锚点序列(模式同 ALLOWED_UPLOAD_EXTS):server 用 classifyMilestone 识别命中,
// 前端用 nextAnchor 算插值目标。

/** ingest 里程碑锚点百分比(单调递增)。100% 由 ingest_done 承担,不在此。
 *  15 读 raw / 50 写 wiki / 70 写 index / 82 写 output(可选) / 92 写 log。 */
export const INGEST_PROGRESS_ANCHORS: readonly number[] = [15, 50, 70, 82, 92]

/** pi AgentSessionEvent 的最小形状(classifyMilestone 只看 tool_execution_start)。 */
interface IngestEvent {
  type: string
  toolName?: string
  args?: unknown
}

/**
 * 判定事件命中的里程碑百分比(ADR-0019)。
 * 非 tool_execution_start 或非里程碑工具/路径 -> null。路径取 args.path(read)/args.file_path(write/edit)
 * /args.filePath(pandoc),小写化匹配。server 维护 currentPercent = max(current, 返回值)。纯函数,便于单测。
 */
export function classifyMilestone(event: IngestEvent): number | null {
  if (event.type !== 'tool_execution_start') return null
  const tool = event.toolName
  const args = event.args as
    | { file_path?: string; filePath?: string; path?: string }
    | null
    | undefined
  const raw = args?.file_path ?? args?.filePath ?? args?.path
  if (!tool || !raw) return null
  const p = raw.toLowerCase()
  if ((tool === 'read' || tool === 'pandoc') && p.includes('raw/')) return 15
  if ((tool === 'write' || tool === 'edit') && p.includes('wiki/')) return 50
  if ((tool === 'write' || tool === 'edit') && p.includes('index.md')) return 70
  if ((tool === 'write' || tool === 'edit') && p.includes('output/')) return 82
  if ((tool === 'write' || tool === 'edit') && p.includes('log.md')) return 92
  return null
}

/** 锚点序列中 anchor 之后的下一个;无则 100(由 ingest_done 承担)。前端插值目标用。 */
export function nextAnchor(anchor: number): number {
  return INGEST_PROGRESS_ANCHORS.find((a) => a > anchor) ?? 100
}
