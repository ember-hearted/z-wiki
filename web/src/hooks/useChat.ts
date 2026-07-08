import { useState, useRef, useCallback, useEffect } from 'react'

/** 助手回合内的时间线片段:文本段与工具调用段按到达顺序排列,保留时序。 */
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

/** ingest 进度角标数据。null = 无角标(空闲)。fileName 进 title tooltip,percent 是假进度 0-100。 */
export interface IngestProgress {
  phase: IngestPhase
  fileName: string
  percent: number
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
    | 'vault_changed'
    | 'session_init'
  text?: string
  tool?: string
  args?: unknown
  error?: boolean
  changed?: number
  total?: number
  raw?: string
  vault?: { path: string; name: string }
  model?: ModelInfo
  stats?: SessionStatsPayload
}

let counter = 0
const nextId = () => `m${Date.now()}-${counter++}`

/** 不可变更新:替换数组中指定 id 的元素。 */
function replaceById<T extends { id: string }>(arr: T[], id: string, next: T): T[] {
  return arr.map((it) => (it.id === id ? next : it))
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [connected, setConnected] = useState(false)
  const [model, setModel] = useState<ModelInfo | null>(null)
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
      setConnected(false)
      // 仅当仍是当前连接时处理:StrictMode 双挂载下旧 ws 的 onclose 不应触发重连
      if (wsRef.current !== ws) return
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
      switch (msg.type) {
        case 'text_delta': {
          // 累加到当前 assistant 回合:若末段是 text 则续写,否则新建 text 段
          setMessages((prev) => {
            const id = streamingIdRef.current
            if (!id) return prev
            const delta = msg.text ?? ''
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
              const seg: Segment = { kind: 'text', id: nextId(), text: delta }
              return { ...m, segments: [...segs, seg] }
            })
          })
          break
        }
        case 'tool_start': {
          // 追加 running 工具段,保留与前后文本的时序
          setMessages((prev) => {
            const id = streamingIdRef.current
            if (!id || !msg.tool) return prev
            const seg: Segment = {
              kind: 'tool',
              id: nextId(),
              tool: msg.tool,
              status: 'running',
              args: msg.args,
            }
            return prev.map((m) =>
              m.id === id ? { ...m, segments: [...(m.segments ?? []), seg] } : m,
            )
          })
          break
        }
        case 'tool_end': {
          // 配对最近一个同名 running 工具段,置为 done/error
          setMessages((prev) => {
            const id = streamingIdRef.current
            if (!id || !msg.tool) return prev
            const errored = Boolean(msg.error)
            return prev.map((m) => {
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
            })
          })
          break
        }
        case 'done': {
          streamingIdRef.current = null
          setStreaming(false)
          // 累计 stats → 本轮差值;首次(无 prev)本轮 = 累计
          if (msg.stats) {
            const cur = msg.stats.tokens
            const prev = prevTokensRef.current
            setTurnStats(
              prev
                ? {
                    input: cur.input - prev.input,
                    output: cur.output - prev.output,
                    cacheRead: cur.cacheRead - prev.cacheRead,
                  }
                : { input: cur.input, output: cur.output, cacheRead: cur.cacheRead },
            )
            prevTokensRef.current = cur
            setContextUsage(msg.stats.contextUsage)
          }
          break
        }
        case 'kb_updated':
          // 知识库已重建,通知 useData 重拉 pages
          window.dispatchEvent(new CustomEvent('kb-updated', { detail: msg }))
          break
        case 'ingest_started':
          // ingest 开始:通知设置页禁用切库按钮(D5)
          window.dispatchEvent(new CustomEvent('ingest-state', { detail: { active: true } }))
          break
        case 'ingest_done':
          window.dispatchEvent(new CustomEvent('ingest-state', { detail: { active: false } }))
          setIngest((prev) => (prev ? { ...prev, phase: 'done', percent: 100 } : prev))
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'system', text: `已处理上传文件 ${msg.raw},知识库已更新` },
          ])
          break
        case 'ingest_error':
          window.dispatchEvent(new CustomEvent('ingest-state', { detail: { active: false } }))
          setIngest((prev) => (prev ? { ...prev, phase: 'failed' } : prev))
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'system', text: `处理 ${msg.raw} 失败:${msg.text}`, error: true },
          ])
          break
        case 'vault_changed':
          // 切库显式信号(D7):清空旧库消息(上下文作废),标记切库重连(短延迟),
          // 通知 useData 重拉 pages。server 随后会 close 本 WS,触发 onclose 重连到新库。
          vaultSwitchingRef.current = true
          setMessages([])
          streamingIdRef.current = null
          setStreaming(false)
          // 上下文随切库作废:本轮 token / 累计基准 / 上下文占用 / ingest 角标全部重置
          setTurnStats(null)
          setContextUsage(null)
          setIngest(null)
          prevTokensRef.current = null
          window.dispatchEvent(new CustomEvent('kb-updated'))
          break
        case 'error':
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'system', text: msg.text ?? '未知错误', error: true },
          ])
          setStreaming(false)
          streamingIdRef.current = null
          break
        case 'system':
          // 连接系统消息,忽略
          break
        case 'session_init':
          if (msg.model) setModel(msg.model)
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

  // ingest 假进度:compiling 阶段 setInterval 100ms,easeOutCubic 20s 爬到 90% 后保持。
  // 为什么假进度:HTTP 上传快且 fetch 无进度事件;ingest 是 LLM 回合无真实百分比;
  // easeOutCubic 到 90% 封顶避免"卡 99%"焦虑,ingest_done 跳 100%、ingest_error 保持当前值变红。
  useEffect(() => {
    if (ingest?.phase !== 'compiling') return
    const start = performance.now()
    const id = setInterval(() => {
      const elapsed = (performance.now() - start) / 1000
      const pct = 90 * (1 - Math.pow(1 - Math.min(1, elapsed / 20), 3))
      setIngest((prev) => (prev && prev.phase === 'compiling' ? { ...prev, percent: pct } : prev))
    }, 100)
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
      // 推入用户消息,并预建一条空 assistant 回合用于流式累加
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
    setIngest({ phase: 'uploading', fileName: file.name, percent: 0 })
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
        // fetch 返回 ok -> 进入编译阶段,假进度开始爬升;ingest_started 信号不参与角标(已由 fetch 返回驱动)
        setIngest((prev) => (prev ? { ...prev, phase: 'compiling' } : prev))
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

  return { messages, streaming, connected, send, upload, model, turnStats, contextUsage, ingest }
}
