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

interface ServerMsg {
  type: 'text_delta' | 'tool_start' | 'tool_end' | 'done' | 'error' | 'system' | 'kb_updated' | 'ingest_done' | 'ingest_error'
  text?: string
  tool?: string
  args?: unknown
  error?: boolean
  changed?: number
  total?: number
  raw?: string
}

let counter = 0
const nextId = () => `m${Date.now()}-${counter++}`

/** 不可变更新:替换数组中指定 id 的元素。 */
function replaceById<T extends { id: string }>(arr: T[], id: string, next: T): T[] {
  return arr.map(it => (it.id === id ? next : it))
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  // 当前正在流式累加的 assistant 回合 id
  const streamingIdRef = useRef<string | null>(null)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => {
      setConnected(false)
      // 仅当仍是当前连接时才清空,避免 StrictMode 双挂载下
      // 旧 ws 的异步 onclose 覆盖新 ws 的引用
      if (wsRef.current === ws) wsRef.current = null
    }
    ws.onerror = () => setConnected(false)
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMsg
      switch (msg.type) {
        case 'text_delta': {
          // 累加到当前 assistant 回合:若末段是 text 则续写,否则新建 text 段
          setMessages(prev => {
            const id = streamingIdRef.current
            if (!id) return prev
            const delta = msg.text ?? ''
            return prev.map(m => {
              if (m.id !== id) return m
              const segs = m.segments ?? []
              const last = segs[segs.length - 1]
              if (last && last.kind === 'text') {
                return { ...m, segments: replaceById(segs, last.id, { ...last, text: last.text + delta }) }
              }
              const seg: Segment = { kind: 'text', id: nextId(), text: delta }
              return { ...m, segments: [...segs, seg] }
            })
          })
          break
        }
        case 'tool_start': {
          // 追加 running 工具段,保留与前后文本的时序
          setMessages(prev => {
            const id = streamingIdRef.current
            if (!id || !msg.tool) return prev
            const seg: Segment = {
              kind: 'tool',
              id: nextId(),
              tool: msg.tool,
              status: 'running',
              args: msg.args,
            }
            return prev.map(m =>
              m.id === id ? { ...m, segments: [...(m.segments ?? []), seg] } : m
            )
          })
          break
        }
        case 'tool_end': {
          // 配对最近一个同名 running 工具段,置为 done/error
          setMessages(prev => {
            const id = streamingIdRef.current
            if (!id || !msg.tool) return prev
            const errored = Boolean(msg.error)
            return prev.map(m => {
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
              updated[idx] = { ...updated[idx] as Extract<Segment, { kind: 'tool' }>, status: errored ? 'error' : 'done' }
              return { ...m, segments: updated }
            })
          })
          break
        }
        case 'done':
          streamingIdRef.current = null
          setStreaming(false)
          break
        case 'kb_updated':
          // 知识库已重建,通知 useData 重拉 pages.json
          window.dispatchEvent(new CustomEvent('kb-updated', { detail: msg }))
          break
        case 'ingest_done':
          setMessages(prev => [
            ...prev,
            { id: nextId(), role: 'system', text: `已处理上传文件 ${msg.raw},知识库已更新` },
          ])
          break
        case 'ingest_error':
          setMessages(prev => [
            ...prev,
            { id: nextId(), role: 'system', text: `处理 ${msg.raw} 失败:${msg.text}`, error: true },
          ])
          break
        case 'error':
          setMessages(prev => [
            ...prev,
            { id: nextId(), role: 'system', text: msg.text ?? '未知错误', error: true },
          ])
          setStreaming(false)
          streamingIdRef.current = null
          break
        case 'system':
          // 连接系统消息,忽略
          break
      }
    }
  }, [])

  useEffect(() => {
    connect()
    return () => wsRef.current?.close()
  }, [connect])

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || !wsRef.current || streaming) return
      // 推入用户消息,并预建一条空 assistant 回合用于流式累加
      const assistantId = nextId()
      streamingIdRef.current = assistantId
      setMessages(prev => [
        ...prev,
        { id: nextId(), role: 'user', text: trimmed },
        { id: assistantId, role: 'assistant', segments: [] },
      ])
      setStreaming(true)
      wsRef.current.send(JSON.stringify({ text: trimmed }))
    },
    [streaming]
  )

  const upload = useCallback(async (file: File) => {
    if (!file) return
    setMessages(prev => [
      ...prev,
      { id: nextId(), role: 'system', text: `上传 ${file.name} 中…` },
    ])
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) {
        setMessages(prev => [
          ...prev,
          { id: nextId(), role: 'system', text: `上传失败:${data.error ?? res.status}`, error: true },
        ])
      } else {
        setMessages(prev => [
          ...prev,
          { id: nextId(), role: 'system', text: `${file.name} 已上传,后台编译中…` },
        ])
      }
    } catch (err) {
      setMessages(prev => [
        ...prev,
        { id: nextId(), role: 'system', text: `上传出错:${err instanceof Error ? err.message : String(err)}`, error: true },
      ])
    }
  }, [])

  return { messages, streaming, connected, send, upload }
}
