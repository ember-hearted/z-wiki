import { useState, useRef, useCallback, useEffect } from 'react'
import { emitIngestState, emitKbUpdated } from './chatEvents'
import { nextAnchor } from '@z-wiki/server/ingestProgress'

/** 助手回合内的时间线片段:文本段、工具调用段、思考段按到达顺序排列,保留时序。 */
export type Segment =
  | { kind: 'text'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      tool: string
      status: 'running' | 'done' | 'error'
      // 工具入参,read 形如 { file_path, offset?, limit? };仅 tool_start 携带
      args?: unknown
    }
  | {
      kind: 'thinking'
      id: string
      text: string
      // collapsed 真相源在 reducer(segment 字段),不在组件 local state:
      // 否则 thinking_end 自动收缩与用户手动 toggle 打架
      collapsed: boolean
      // streaming 标记是中断态支点:thinking_start 建 true,thinking_end 置 false;
      // done/error 清 false(半截保持展开)。delta/end 按 streaming 配对(不按 kind)
      streaming: boolean
    }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  // user/system 仍用 text;assistant 回合用 segments 时间线
  text?: string
  segments?: Segment[]
  error?: boolean
}

/** 当前模型信息(WS session_init 推送,header 右上展示)。 */
export interface ModelInfo {
  id: string
  name: string
  provider: string
  contextWindow: number
}

/** session 累计统计(agent_end 时随 done 推送;前端做差值得本轮)。 */
export interface SessionStatsPayload {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
  cost: number
  contextUsage: {
    tokens: number | null
    contextWindow: number
    percent: number | null
  } | null
}

/** 本轮(单次问答)token 消耗,由累计差值得出。 */
export interface TurnStats {
  input: number
  output: number
  cacheRead: number
}

/** ingest 进度角标的阶段。覆盖上传(HTTP)+ 编译(agent 回合)全过程;空闲用 null 表示,不入此类型。 */
export type IngestPhase = 'uploading' | 'compiling' | 'done' | 'failed'

/** ingest 进度角标数据。null = 无角标(空闲)。fileName 进 title tooltip;
 *  percent 显示值(段式插值),anchor 当前真实里程碑,target 插值目标(下一锚点,ADR-0019)。 */
export interface IngestProgress {
  phase: IngestPhase
  fileName: string
  percent: number
  anchor: number
  target: number
}

interface ServerMsg {
  type:
    | 'text_delta'
    | 'tool_start'
    | 'tool_end'
    | 'done'
    | 'error'
    | 'system'
    | 'kb_updated'
    | 'ingest_started'
    | 'ingest_done'
    | 'ingest_error'
    | 'ingest_progress'
    | 'vault_changed'
    | 'session_init'
    | 'thinking_changed'
    | 'thinking_start'
    | 'thinking_delta'
    | 'thinking_end'
  text?: string
  tool?: string
  args?: unknown
  error?: boolean
  changed?: number
  total?: number
  raw?: string
  percent?: number
  vault?: { path: string; name: string }
  model?: ModelInfo
  stats?: SessionStatsPayload
  // 思考模式状态(ADR-0004 D8):session_init / thinking_changed 携带,供 quickbar 思考按钮渲染 + 灰显。
  thinkingLevel?: string
  thinkingLevels?: string[]
}

let counter = 0
const nextId = () => `m${Date.now()}-${counter++}`

/** 不可变更新:替换数组中指定 id 的元素。 */
function replaceById<T extends { id: string }>(arr: T[], id: string, next: T): T[] {
  return arr.map((it) => (it.id === id ? next : it))
}

/** 从 segments 末尾找最近一个 streaming 思考段的索引(按 streaming 配对,不按 kind)。
 *  为多段思考不串铺路:只有当前流式中的段接受 delta/end,已收缩的旧段不碰。无则 -1。 */
function findStreamingThinking(segs: Segment[]): number {
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]
    if (s.kind === 'thinking' && s.streaming) return i
  }
  return -1
}

/** done/error 中断兜底:把指定 assistant 的所有 streaming 思考段置 streaming:false
 *  (collapsed 不动 -> 半截保持展开,让用户看到 agent 想到哪儿)。无 streaming 思考段、
 *  无 assistantId 或消息不存在时返回原数组引用(短路,避免无谓 re-render)。 */
function clearStreamingThinkingInMessage(
  messages: ChatMessage[],
  assistantId: string | null,
): ChatMessage[] {
  if (!assistantId) return messages
  const idx = messages.findIndex((m) => m.id === assistantId)
  if (idx === -1) return messages
  const m = messages[idx]
  const segs = m.segments ?? []
  if (!segs.some((s) => s.kind === 'thinking' && s.streaming)) return messages
  const next = messages.slice()
  next[idx] = {
    ...m,
    segments: segs.map((s) =>
      s.kind === 'thinking' && s.streaming ? { ...s, streaming: false } : s,
    ),
  }
  return next
}

/** applyServerMsg 读取的当前状态(从 ref 读,避免 onmessage 闭包 stale)。 */
interface ChatCurrent {
  /** 当前流式累加的 assistant 回合 id(text_delta/tool 配对用)。 */
  streamingId: string | null
  /** 上次累计 tokens(done 差值基准;vault 切换/重连后重置)。 */
  prevTokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  } | null
}

/** applyServerMsg 的依赖注入(使纯函数可测:nextId 是模块级非纯,故注入)。 */
interface ChatCtx {
  nextId: () => string
}

/** applyServerMsg 返回的部分状态更新(undefined 字段 = 不改)。 */
interface ChatUpdate {
  /** messages 的函数式更新(读 prev 避免闭包 stale)。 */
  messages?: (prev: ChatMessage[]) => ChatMessage[]
  streaming?: boolean
  streamingId?: string | null
  prevTokens?: ChatCurrent['prevTokens']
  turnStats?: TurnStats | null
  contextUsage?: SessionStatsPayload['contextUsage']
}

/** WS 消息 -> 状态更新(纯函数,可单测)。
 *  处理 text_delta / tool_start / tool_end / thinking_* / done / error;
 *  其余类型返回 null(由 hook 自行处理)。 */
export function applyServerMsg(
  msg: ServerMsg,
  ctx: ChatCtx,
  current: ChatCurrent,
): ChatUpdate | null {
  switch (msg.type) {
    case 'text_delta': {
      const id = current.streamingId
      const delta = msg.text ?? ''
      return {
        messages: (prev) => {
          if (!id) return prev
          return prev.map((m) => {
            if (m.id !== id) return m
            const segs = m.segments ?? []
            const last = segs[segs.length - 1]
            if (last && last.kind === 'text') {
              return {
                ...m,
                segments: replaceById(segs, last.id, { ...last, text: last.text + delta }),
              }
            }
            const seg: Segment = { kind: 'text', id: ctx.nextId(), text: delta }
            return { ...m, segments: [...segs, seg] }
          })
        },
      }
    }
    case 'tool_start': {
      const id = current.streamingId
      if (!id || !msg.tool) return {}
      const seg: Segment = {
        kind: 'tool',
        id: ctx.nextId(),
        tool: msg.tool,
        status: 'running',
        args: msg.args,
      }
      return {
        messages: (prev) =>
          prev.map((m) => (m.id === id ? { ...m, segments: [...(m.segments ?? []), seg] } : m)),
      }
    }
    case 'tool_end': {
      const id = current.streamingId
      if (!id || !msg.tool) return {}
      const errored = Boolean(msg.error)
      return {
        messages: (prev) =>
          prev.map((m) => {
            if (m.id !== id) return m
            const segs = m.segments ?? []
            // 从末尾找最近一个同名 running
            let idx = -1
            for (let i = segs.length - 1; i >= 0; i--) {
              const s = segs[i]
              if (s.kind === 'tool' && s.tool === msg.tool && s.status === 'running') {
                idx = i
                break
              }
            }
            if (idx === -1) return m
            const updated = segs.slice()
            updated[idx] = {
              ...(updated[idx] as Extract<Segment, { kind: 'tool' }>),
              status: errored ? 'error' : 'done',
            }
            return { ...m, segments: updated }
          }),
      }
    }
    case 'thinking_start': {
      const id = current.streamingId
      if (!id) return {}
      const seg: Segment = {
        kind: 'thinking',
        id: ctx.nextId(),
        text: '',
        collapsed: false,
        streaming: true,
      }
      return {
        messages: (prev) =>
          prev.map((m) => (m.id === id ? { ...m, segments: [...(m.segments ?? []), seg] } : m)),
      }
    }
    case 'thinking_delta': {
      const id = current.streamingId
      if (!id) return {}
      const delta = msg.text ?? ''
      return {
        messages: (prev) =>
          prev.map((m) => {
            if (m.id !== id) return m
            const segs = m.segments ?? []
            const idx = findStreamingThinking(segs)
            if (idx === -1) return m
            const updated = segs.slice()
            const target = updated[idx] as Extract<Segment, { kind: 'thinking' }>
            updated[idx] = { ...target, text: target.text + delta }
            return { ...m, segments: updated }
          }),
      }
    }
    case 'thinking_end': {
      const id = current.streamingId
      if (!id) return {}
      return {
        messages: (prev) =>
          prev.map((m) => {
            if (m.id !== id) return m
            const segs = m.segments ?? []
            const idx = findStreamingThinking(segs)
            if (idx === -1) return m
            const updated = segs.slice()
            const target = updated[idx] as Extract<Segment, { kind: 'thinking' }>
            updated[idx] = { ...target, collapsed: true, streaming: false }
            return { ...m, segments: updated }
          }),
      }
    }
    case 'done': {
      const update: ChatUpdate = { streaming: false, streamingId: null }
      // 累计 stats -> 本轮差值;首次(无 prev)本轮 = 累计
      if (msg.stats) {
        const cur = msg.stats.tokens
        const prev = current.prevTokens
        update.turnStats = prev
          ? {
              input: cur.input - prev.input,
              output: cur.output - prev.output,
              cacheRead: cur.cacheRead - prev.cacheRead,
            }
          : { input: cur.input, output: cur.output, cacheRead: cur.cacheRead }
        update.prevTokens = cur
        update.contextUsage = msg.stats.contextUsage
      }
      // 中断兜底:thinking_end 未到时半截思考段仍 streaming -> done 清 streaming(collapsed 不动)
      update.messages = (prev) => clearStreamingThinkingInMessage(prev, current.streamingId)
      return update
    }
    case 'error': {
      return {
        // 先清当前 assistant 的 streaming 思考段(半截展开),再追加 system 错误消息
        messages: (prev) => [
          ...clearStreamingThinkingInMessage(prev, current.streamingId),
          { id: ctx.nextId(), role: 'system', text: msg.text ?? '未知错误', error: true },
        ],
        streaming: false,
        streamingId: null,
      }
    }
    default:
      return null
  }
}

/** 翻转指定思考段的 collapsed(用户点击胶囊展开/收缩)。
 *  collapsed 真相源在 segment 字段(reducer),不放组件 local state--否则 thinking_end
 *  自动收缩与手动 toggle 打架。无配对段时返回原数组(短路,避免无谓 re-render)。 */
export function toggleThinkingSegment(
  messages: ChatMessage[],
  messageId: string,
  segmentId: string,
): ChatMessage[] {
  const msg = messages.find((m) => m.id === messageId)
  if (!msg) return messages
  const segs = msg.segments ?? []
  if (!segs.some((s) => s.kind === 'thinking' && s.id === segmentId)) return messages
  return messages.map((m) =>
    m.id === messageId
      ? {
          ...m,
          segments: segs.map((s) =>
            s.kind === 'thinking' && s.id === segmentId ? { ...s, collapsed: !s.collapsed } : s,
          ),
        }
      : m,
  )
}

/** vault_changed 重置的目标状态(纯函数,可测)。
 *  切库时旧库上下文全部作废:消息清空、流式态/累计基准/上下文占用/ingest 角标重置,
 *  并标记切库重连(短延迟)。返回固定初值;hook 应用完本状态后再 emitKbUpdated,
 *  确保 usePages 重拉时本组件已清空(不闪旧消息)。 */
export function vaultChangedReset(): {
  messages: ChatMessage[]
  streaming: boolean
  streamingId: string | null
  prevTokens: ChatCurrent['prevTokens']
  turnStats: TurnStats | null
  contextUsage: SessionStatsPayload['contextUsage']
  ingest: IngestProgress | null
  vaultSwitching: boolean
} {
  return {
    messages: [],
    streaming: false,
    streamingId: null,
    prevTokens: null,
    turnStats: null,
    contextUsage: null,
    ingest: null,
    vaultSwitching: true,
  }
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [connected, setConnected] = useState(false)
  const [model, setModel] = useState<ModelInfo | null>(null)
  // 思考模式状态(ADR-0004 D8):level 当前档,levels 可选档(按 model 能力,off 始终在;不支持思考时 ['off'])。
  const [thinkingLevel, setThinkingLevel] = useState<string>('off')
  const [thinkingLevels, setThinkingLevels] = useState<string[]>(['off'])
  const [turnStats, setTurnStats] = useState<TurnStats | null>(null)
  const [contextUsage, setContextUsage] = useState<SessionStatsPayload['contextUsage']>(null)
  // ingest 进度角标(上传+编译全过程);null = 无角标
  const [ingest, setIngest] = useState<IngestProgress | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  // 上次累计 tokens(用于 done 时算本轮差值);vault 切换/重连后重置
  const prevTokensRef = useRef<{
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  } | null>(null)
  // 当前正在流式累加的 assistant 回合 id
  const streamingIdRef = useRef<string | null>(null)
  // 组件是否仍挂载(卸载后不重连,避免 StrictMode 双挂载/路由离开后残留连接)
  const mountedRef = useRef(true)
  // 切库重连标志:vault_changed 收到后置 true,onclose 据此区分切库重连(短延迟)与崩溃重连(退避)
  const vaultSwitchingRef = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    // 已连接或连接中时不重复开(重连定时器与 StrictMode 双挂载都可能并发触发)
    const state = wsRef.current?.readyState
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => {
      // 仅当仍是当前连接时处理:StrictMode 双挂载下旧 ws 的 onclose 不应清 connected 或触发重连
      if (wsRef.current !== ws) return
      setConnected(false)
      wsRef.current = null
      if (!mountedRef.current) return
      const wasSwitch = vaultSwitchingRef.current
      vaultSwitchingRef.current = false
      // 切库重连:server 主动关(vault_changed 已先到),快速重连到新库;
      // 崩溃重连:意外断开,退避后重连(保留历史消息,与切库重连区分)
      const delay = wasSwitch ? 400 : 1500
      reconnectTimerRef.current = setTimeout(() => connect(), delay)
    }
    ws.onerror = () => setConnected(false)
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMsg
      // text_delta/tool_start/tool_end/done/error 走纯函数 reducer(可测 seam);其余类型下方 switch
      const update = applyServerMsg(
        msg,
        { nextId },
        {
          streamingId: streamingIdRef.current,
          prevTokens: prevTokensRef.current,
        },
      )
      if (update) {
        if (update.messages) setMessages(update.messages)
        if (update.streaming !== undefined) setStreaming(update.streaming)
        if (update.streamingId !== undefined) streamingIdRef.current = update.streamingId
        if (update.prevTokens !== undefined) prevTokensRef.current = update.prevTokens
        if (update.turnStats !== undefined) setTurnStats(update.turnStats)
        if (update.contextUsage !== undefined) setContextUsage(update.contextUsage)
        return
      }
      switch (msg.type) {
        case 'kb_updated':
          // 知识库已重建,通知 useData 重拉 pages
          emitKbUpdated()
          break
        case 'ingest_started':
          // ingest 开始:通知设置页禁用切库按钮(D5)
          emitIngestState({ active: true })
          break
        case 'ingest_progress':
          // 里程碑锚点(ADR-0019):更新当前锚点 + 插值目标(下一锚点)。仅 compiling 阶段生效。
          setIngest((prev) => {
            if (!prev || prev.phase !== 'compiling') return prev
            const anchor = msg.percent ?? prev.anchor
            return { ...prev, anchor, target: nextAnchor(anchor) }
          })
          break
        case 'ingest_done':
          emitIngestState({ active: false })
          // 保持当前 percent,done 阶段 useEffect 平滑插值到 100(避免从 15/50 突跳 100)
          setIngest((prev) => (prev ? { ...prev, phase: 'done' } : prev))
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'system', text: `已处理上传文件 ${msg.raw},知识库已更新` },
          ])
          break
        case 'ingest_error':
          emitIngestState({ active: false })
          setIngest((prev) => (prev ? { ...prev, phase: 'failed' } : prev))
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'system', text: `处理 ${msg.raw} 失败:${msg.text}`, error: true },
          ])
          break
        case 'vault_changed': {
          // 切库显式信号(D7):旧库上下文作废,按 vaultChangedReset 固化的目标值全部重置。
          // 先应用重置,再 emitKbUpdated 通知 usePages 重拉--顺序保证重拉时本组件已清空,
          // 不闪旧消息。server 随后会 close 本 WS,触发 onclose 重连到新库(vaultSwitching -> 短延迟)。
          const reset = vaultChangedReset()
          vaultSwitchingRef.current = reset.vaultSwitching
          setMessages(reset.messages)
          streamingIdRef.current = reset.streamingId
          setStreaming(reset.streaming)
          setTurnStats(reset.turnStats)
          setContextUsage(reset.contextUsage)
          setIngest(reset.ingest)
          prevTokensRef.current = reset.prevTokens
          emitKbUpdated()
          break
        }
        case 'system':
          // 连接系统消息,忽略
          break
        case 'session_init':
          if (msg.model) setModel(msg.model)
          if (msg.thinkingLevel) setThinkingLevel(msg.thinkingLevel)
          if (msg.thinkingLevels) setThinkingLevels(msg.thinkingLevels)
          break
        case 'thinking_changed':
          // 思考模式切换广播(自己或同库其他客户端切换):同步 level + available(可能 clamp)。
          if (msg.thinkingLevel) setThinkingLevel(msg.thinkingLevel)
          if (msg.thinkingLevels) setThinkingLevels(msg.thinkingLevels)
          break
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  // ingest 进度:compiling 阶段从 anchor 向 target 段式 easeOutCubic 插值(8s/段,不超 target)。
  // 里程碑锚点由 server ingest_progress 驱动(ADR-0019),锚点间时间插值填充 LLM 思考耗时。
  // target=下一锚点;到达后停(等真实锚点推进),ingest_done 跳 100%、ingest_error 保持当前值变红。
  useEffect(() => {
    if (ingest?.phase !== 'compiling') return
    const from = ingest.anchor
    const to = ingest.target
    if (to <= from) return
    const start = performance.now()
    const SEGMENT_MS = 8000
    const id = setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / SEGMENT_MS)
      const pct = from + (to - from) * (1 - (1 - t) ** 3)
      setIngest((prev) =>
        prev && prev.phase === 'compiling' && prev.anchor === from && prev.target === to
          ? { ...prev, percent: pct }
          : prev,
      )
    }, 100)
    return () => clearInterval(id)
  }, [ingest?.phase, ingest?.anchor, ingest?.target])

  // ingest done 收尾:从当前 percent 平滑插值到 100(600ms),避免从 15/50 突跳 100。
  useEffect(() => {
    if (ingest?.phase !== 'done') return
    const from = ingest.percent
    if (from >= 100) return
    const start = performance.now()
    const id = setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / 600)
      const pct = from + (100 - from) * (1 - (1 - t) ** 3)
      setIngest((prev) => (prev && prev.phase === 'done' ? { ...prev, percent: pct } : prev))
    }, 30)
    return () => clearInterval(id)
  }, [ingest?.phase])

  // 角标淡出:done 1.5s / failed 3s 后清空(结果消息已留消息流,角标只是即时反馈)。
  useEffect(() => {
    if (ingest?.phase !== 'done' && ingest?.phase !== 'failed') return
    const ms = ingest.phase === 'done' ? 1500 : 3000
    const id = setTimeout(() => setIngest(null), ms)
    return () => clearTimeout(id)
  }, [ingest?.phase])

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || !wsRef.current || streaming) return
      // 推入用户消息,并预建一条空 assistant 回合用于流式累加。
      const assistantId = nextId()
      streamingIdRef.current = assistantId
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'user', text: trimmed },
        { id: assistantId, role: 'assistant', segments: [] },
      ])
      setStreaming(true)
      wsRef.current.send(JSON.stringify({ text: trimmed }))
    },
    [streaming],
  )

  const upload = useCallback(async (file: File) => {
    if (!file) return
    // 角标承担过程反馈,不再推"上传中/已上传编译中"system 消息;结果(已更新/失败)仍留消息流。
    setIngest({ phase: 'uploading', fileName: file.name, percent: 0, anchor: 0, target: 0 })
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) {
        setIngest((prev) => (prev ? { ...prev, phase: 'failed' } : prev))
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'system',
            text: `上传失败:${data.error ?? res.status}`,
            error: true,
          },
        ])
      } else {
        // fetch 返回 ok -> 进入编译阶段,锚点 0、目标第一锚点(nextAnchor(0)=15),段式插值开始;
        // ingest_started 信号不参与角标(已由 fetch 返回驱动)
        setIngest((prev) =>
          prev ? { ...prev, phase: 'compiling', anchor: 0, target: nextAnchor(0) } : prev,
        )
      }
    } catch (err) {
      setIngest((prev) => (prev ? { ...prev, phase: 'failed' } : prev))
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'system',
          text: `上传出错:${err instanceof Error ? err.message : String(err)}`,
          error: true,
        },
      ])
    }
  }, [])

  // 切换思考模式(ADR-0004 D8):POST 写 config + chat session.setThinkingLevel。
  // 不本地乐观更新--server broadcast thinking_changed 会推回自己,同步 level + available(防 clamp 不一致)。
  const setThinking = useCallback(async (level: string) => {
    try {
      const res = await fetch('/api/config/thinking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'system',
            text: `切换思考模式失败:${data.error ?? res.status}`,
            error: true,
          },
        ])
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'system',
          text: `切换思考模式出错:${err instanceof Error ? err.message : String(err)}`,
          error: true,
        },
      ])
    }
  }, [])

  // 翻转思考胶囊展开/收缩:改 segment.collapsed(真相源在 reducer,非 local state)。
  const toggleThinking = useCallback((messageId: string, segmentId: string) => {
    setMessages((prev) => toggleThinkingSegment(prev, messageId, segmentId))
  }, [])

  return {
    messages,
    streaming,
    connected,
    send,
    upload,
    model,
    turnStats,
    contextUsage,
    ingest,
    thinkingLevel,
    thinkingLevels,
    setThinking,
    toggleThinking,
  }
}
