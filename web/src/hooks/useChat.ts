import { useState, useRef, useCallback, useEffect } from 'react'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  tool?: string
  error?: boolean
}

interface ServerMsg {
  type: 'text_delta' | 'tool_start' | 'tool_end' | 'done' | 'error' | 'system'
  text?: string
  tool?: string
  error?: boolean
}

let counter = 0
const nextId = () => `m${Date.now()}-${counter++}`

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  // 当前正在流式累加的 assistant 消息 id
  const streamingIdRef = useRef<string | null>(null)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null
    }
    ws.onerror = () => setConnected(false)
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMsg
      switch (msg.type) {
        case 'text_delta': {
          // 累加到当前 assistant 消息
          setMessages(prev => {
            const id = streamingIdRef.current
            if (!id) return prev
            return prev.map(m => (m.id === id ? { ...m, text: m.text + (msg.text ?? '') } : m))
          })
          break
        }
        case 'tool_start':
          setMessages(prev => [
            ...prev,
            { id: nextId(), role: 'system', text: `调用工具 ${msg.tool}`, tool: msg.tool },
          ])
          break
        case 'tool_end':
          // 工具结束可标记,这里简化为不单独处理
          break
        case 'done':
          streamingIdRef.current = null
          setStreaming(false)
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
      // 推入用户消息,并预建一条空 assistant 消息用于流式累加
      const assistantId = nextId()
      streamingIdRef.current = assistantId
      setMessages(prev => [
        ...prev,
        { id: nextId(), role: 'user', text: trimmed },
        { id: assistantId, role: 'assistant', text: '' },
      ])
      setStreaming(true)
      wsRef.current.send(JSON.stringify({ text: trimmed }))
    },
    [streaming]
  )

  return { messages, streaming, connected, send }
}
