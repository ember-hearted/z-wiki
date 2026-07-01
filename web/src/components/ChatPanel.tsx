import { useState, useRef, useEffect, type KeyboardEvent, type ChangeEvent } from 'react'
import { useChat, type ChatMessage, type Segment } from '../hooks/useChat'

/** 把工具入参提炼成一行可读摘要;read/edit/write 显示路径,其它工具退化成首个字符串字段。 */
function describeArgs(tool: string, args: unknown): string | null {
  if (!args || typeof args !== 'object') return null
  const a = args as Record<string, unknown>
  // pi 的 read/edit/write 兼容 file_path 与 path 两种参数名
  const filePath = typeof a.file_path === 'string' ? a.file_path : typeof a.path === 'string' ? a.path : null
  if (filePath && (tool === 'read' || tool === 'edit' || tool === 'write')) {
    const parts = [filePath]
    if (typeof a.offset === 'number') parts.push(`offset=${a.offset}`)
    if (typeof a.limit === 'number') parts.push(`limit=${a.limit}`)
    return parts.join(' ')
  }
  // 兜底:取第一个字符串字段,避免长 JSON 撑爆时间线
  for (const v of Object.values(a)) {
    if (typeof v === 'string') return v.length > 60 ? v.slice(0, 57) + '…' : v
  }
  return null
}

function ToolChip({ seg }: { seg: Extract<Segment, { kind: 'tool' }> }) {
  const label = seg.status === 'running' ? '运行中' : seg.status === 'error' ? '失败' : '完成'
  const detail = describeArgs(seg.tool, seg.args)
  return (
    <span className={`chat-tool chat-tool-${seg.status}`}>
      <span className="chat-tool-dot" />
      <span className="chat-tool-name">{seg.tool}</span>
      {detail && <span className="chat-tool-args">{detail}</span>}
      <span className="chat-tool-state">{label}</span>
    </span>
  )
}

/** 渲染纯文本:保留换行,转义后以 pre-wrap 呈现,与 prose 协调。 */
function TextBlock({ text }: { text: string }) {
  return <div className="chat-text">{text}</div>
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'system') {
    return (
      <div className={`chat-row chat-row-system ${msg.error ? 'chat-row-error' : ''}`}>
        <span className="chat-mark">{msg.error ? '⚠' : '◆'}</span>
        <span className="chat-system-text">{msg.text}</span>
      </div>
    )
  }

  const isUser = msg.role === 'user'
  const roleLabel = isUser ? '我' : '助手'
  const segments = msg.segments ?? []

  // 助手回合:若尚无任何片段,显示占位
  const empty = !isUser && segments.length === 0

  return (
    <div className={`chat-row chat-row-${msg.role}`}>
      <div className="chat-role">{roleLabel}</div>
      <div className="chat-content">
        {isUser ? (
          <TextBlock text={msg.text ?? ''} />
        ) : empty ? (
          <div className="chat-pending">…</div>
        ) : (
          segments.map(seg =>
            seg.kind === 'text' ? (
              <TextBlock key={seg.id} text={seg.text} />
            ) : (
              <ToolChip key={seg.id} seg={seg} />
            )
          )
        )}
      </div>
    </div>
  )
}

interface ChatPanelProps {
  onClose: () => void
}

export default function ChatPanel({ onClose }: ChatPanelProps) {
  const { messages, streaming, connected, send, upload } = useChat()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void upload(f)
    e.target.value = ''
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const submit = () => {
    if (!input.trim()) return
    send(input)
    setInput('')
  }

  return (
    <div className="chat-panel">
      <div className="chat-drawer-header">
        <span className="chat-status">
          {connected ? '● 已连接' : '○ 未连接'}
        </span>
        <button
          type="button"
          className="chat-drawer-close"
          onClick={onClose}
          aria-label="关闭对话"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="chat-empty">向知识库智能体提问,它会按工作流检索 wiki 并回答。</div>
        ) : (
          messages.map(m => <MessageBubble key={m.id} msg={m} />)
        )}
      </div>
      <div className="chat-input-row">
        <textarea
          className="chat-input"
          placeholder={connected ? '输入消息,Enter 发送,Shift+Enter 换行' : '正在连接...'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          rows={2}
          disabled={!connected || streaming}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".md"
          onChange={handleFile}
          style={{ display: 'none' }}
        />
        <button
          className="chat-upload"
          onClick={() => fileRef.current?.click()}
          disabled={!connected}
          title="上传 .md 到 raw/,自动编译"
        >
          上传
        </button>
        <button
          className="chat-send"
          onClick={submit}
          disabled={!connected || streaming || !input.trim()}
        >
          {streaming ? '回复中' : '发送'}
        </button>
      </div>
    </div>
  )
}
