import { type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { type ChatMessage, type Segment, useChat } from '../hooks/useChat'

/** 格式化 token 数:>1k 显示为 1.2k,否则原值。 */
function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/** 把工具入参提炼成一行可读摘要;read/edit/write 显示路径,其它工具退化成首个字符串字段。 */
function describeArgs(tool: string, args: unknown): string | null {
  if (!args || typeof args !== 'object') return null
  const a = args as Record<string, unknown>
  // pi 的 read/edit/write 兼容 file_path 与 path 两种参数名
  const filePath =
    typeof a.file_path === 'string' ? a.file_path : typeof a.path === 'string' ? a.path : null
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

function MessageBubble({ msg, typing }: { msg: ChatMessage; typing?: boolean }) {
  if (msg.role === 'system') {
    return (
      <div className={`chat-row chat-row-system ${msg.error ? 'chat-row-error' : ''}`}>
        <span className="chat-mark">{msg.error ? '⚠' : '◆'}</span>
        <span className="chat-system-text">{msg.text}</span>
      </div>
    )
  }

  const isUser = msg.role === 'user'
  const segments = msg.segments ?? []

  return (
    <div className={`chat-row chat-row-${isUser ? 'user' : 'fairy'}`}>
      {!isUser && <div className="chat-label">Fairy✨</div>}
      <div className="chat-bubble">
        {isUser ? (
          <TextBlock text={msg.text ?? ''} />
        ) : segments.length === 0 && typing ? (
          <span className="chat-typing">
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
          </span>
        ) : segments.length === 0 ? (
          <div className="chat-pending">…</div>
        ) : (
          <>
            {segments.map((seg) =>
              seg.kind === 'text' ? (
                <TextBlock key={seg.id} text={seg.text} />
              ) : (
                <ToolChip key={seg.id} seg={seg} />
              ),
            )}
            {typing && (
              <span className="chat-typing">
                <span className="chat-typing-dot" />
                <span className="chat-typing-dot" />
                <span className="chat-typing-dot" />
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}

interface ChatPanelProps {
  onClose: () => void
}

export default function ChatPanel({ onClose }: ChatPanelProps) {
  const { messages, streaming, connected, send, upload, model, turnStats, contextUsage } = useChat()
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

  // 输入框可向上拖拽扩高(最高半屏):手柄在 composer 顶部,mousedown 后全局 mousemove
  // 改 height,向上拖(delta<0)增大,clamp [单行最小, 半屏]。按钮 absolute 在 composer 右下,
  // composer 底部固定、向上扩展,故按钮视觉位置始终不动。
  const [composerHeight, setComposerHeight] = useState<number | null>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)
  const minHRef = useRef(32)

  // 测量单行自然高度作拖拽下限(首次 mount,此时 composerHeight=null 用 rows=1 撑出)
  useEffect(() => {
    if (composerRef.current) minHRef.current = composerRef.current.offsetHeight
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startY - e.clientY
      const maxH = window.innerHeight * 0.5
      const h = Math.max(minHRef.current, Math.min(maxH, dragRef.current.startH + delta))
      setComposerHeight(h)
    }
    const onUp = () => {
      dragRef.current = null
      document.body.classList.remove('chat-resizing')
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <div className="chat-panel">
      <div className="chat-drawer-header">
        {/* 左上:连接状态 + 本轮 token(↑输入 ↓输出 🗄缓存读) */}
        <div className="chat-status-left">
          <span
            className={`chat-conn-dot ${connected ? 'on' : 'off'}`}
            title={connected ? '已连接' : '未连接'}
          />
          {turnStats && (
            <span className="chat-turn-tokens" title="本轮 token(输入/输出/缓存读)">
              <span>↑{fmtTokens(turnStats.input)}</span>
              <span>↓{fmtTokens(turnStats.output)}</span>
              <span>🗄{fmtTokens(turnStats.cacheRead)}</span>
            </span>
          )}
        </div>
        {/* 右上:模型名 + 上下文占用进度条 + 关闭按钮 */}
        <div className="chat-status-right">
          {model && (
            <span className="chat-model-name" title={`${model.provider} · ${model.id}`}>
              {model.name}
            </span>
          )}
          {contextUsage?.percent != null && (
            <span className="chat-ctx" title={`上下文 ${Math.round(contextUsage.percent)}%`}>
              <span className="chat-ctx-track">
                <span
                  className="chat-ctx-fill"
                  style={{ width: `${Math.min(100, contextUsage.percent)}%` }}
                />
              </span>
              <span className="chat-ctx-pct">{Math.round(contextUsage.percent)}%</span>
            </span>
          )}
          <button
            type="button"
            className="chat-drawer-close"
            onClick={onClose}
            aria-label="关闭对话"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0
          ? null
          : (() => {
              // 找出最后一个 Fairy✨消息,用于 typing indicator
              let lastId: string | null = null
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === 'assistant') {
                  lastId = messages[i].id
                  break
                }
              }
              return messages.map((m) => (
                <MessageBubble key={m.id} msg={m} typing={streaming && m.id === lastId} />
              ))
            })()}
      </div>
      <div
        className="chat-input-row"
        ref={composerRef}
        style={composerHeight ? { height: `${composerHeight}px` } : undefined}
      >
        <div
          className="chat-resize-handle"
          aria-label="拖动调整输入框高度"
          onMouseDown={(e) => {
            e.preventDefault()
            if (!composerRef.current) return
            dragRef.current = {
              startY: e.clientY,
              startH: composerRef.current.offsetHeight,
            }
            document.body.classList.add('chat-resizing')
          }}
        />
        <textarea
          className="chat-input"
          placeholder={connected ? '输入消息,Enter 发送' : '正在连接...'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          rows={1}
          disabled={!connected || streaming}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".md"
          onChange={handleFile}
          style={{ display: 'none' }}
        />
        <div className="chat-input-actions">
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
    </div>
  )
}
