import { ALLOWED_UPLOAD_EXTS } from '@z-wiki/server/uploadExts'
import { mdToHtml, splitBlocks } from '@z-wiki/server/markdown'
import remend from 'remend'
import {
  type ChangeEvent,
  type KeyboardEvent,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  type ChatMessage,
  type IngestPhase,
  type Segment,
  type TurnStats,
  useChat,
} from '../hooks/useChat'
import { shouldScrollToBottom } from './chatScroll'

/** 格式化 token 数:>1k 显示为 1.2k,否则原值。 */
function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/** 本轮缓存命中率 = cacheRead / (input + cacheRead);两者皆 0 返回 0(首轮无缓存)。 */
function cacheHitRate(t: TurnStats): number {
  const denom = t.input + t.cacheRead
  if (denom === 0) return 0
  return Math.round((t.cacheRead / denom) * 100)
}

/** ingest 角标阶段标签:uploading/compiling/done/failed -> 上传中/编译中/已更新/失败。 */
function labelForIngest(phase: IngestPhase): string {
  switch (phase) {
    case 'uploading':
      return '上传中'
    case 'compiling':
      return '编译中'
    case 'done':
      return '已更新'
    case 'failed':
      return '失败'
  }
}

/** 状态行图标:14px stroke,与关闭按钮同风格(无 fill)。 */
function Icon({ d }: { d: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  )
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

/** 思考胶囊(ADR-0004 D8 第三环):reasoning 模型的思维链按段穿插在时间线。
 *  流式期展开显示思考文本(thinking_end 前 collapsed=false);该段结束自动收缩为
 *  "思考 · N 字";点击整行 toggle collapsed。collapsed 真相源在 segment 字段(reducer),
 *  不在 local state--否则 thinking_end 自动收缩与手动 toggle 打架。 */
function ThinkingCapsule({
  seg,
  onToggle,
}: {
  seg: Extract<Segment, { kind: 'thinking' }>
  onToggle: () => void
}) {
  if (seg.collapsed) {
    return (
      <button type="button" className="chat-thinking chat-thinking-collapsed" onClick={onToggle}>
        <span className="chat-thinking-dot" />
        <span className="chat-thinking-label">思考</span>
        <span className="chat-thinking-count">· {seg.text.length} 字</span>
        <span className="chat-thinking-arrow">▸</span>
      </button>
    )
  }
  return <ThinkingExpanded seg={seg} onToggle={onToggle} />
}

/** 展开态:header(可点 toggle)+ 思考文本(纯文本 pre-wrap + max-height + 滚动)。
 *  流式期间节流(与 MarkdownStream 同策略),避免每 delta 全文重渲染。
 *  纯文本不走 markdown 渲染器--半截代码块/列表不怕显示原始符号。 */
function ThinkingExpanded({
  seg,
  onToggle,
}: {
  seg: Extract<Segment, { kind: 'thinking' }>
  onToggle: () => void
}) {
  const text = useThrottle(seg.text, seg.streaming ? 100 : 0)
  return (
    <div className="chat-thinking chat-thinking-expanded">
      <button type="button" className="chat-thinking-header" onClick={onToggle}>
        <span className={`chat-thinking-dot ${seg.streaming ? 'streaming' : ''}`} />
        <span className="chat-thinking-label">思考</span>
        <span className="chat-thinking-count">· {text.length} 字</span>
        <span className="chat-thinking-arrow">▾</span>
      </button>
      <div className="chat-thinking-text">{text}</div>
    </div>
  )
}

/** 渲染文本:user 消息纯文本 pre-wrap;assistant 消息走块级 md 渲染(复用 server 的 mdToHtml,与 wiki 文章同源)。 */
function TextBlock({
  text,
  markdown,
  streaming,
}: {
  text: string
  markdown?: boolean
  streaming?: boolean
}) {
  if (!markdown) return <div className="chat-text">{text}</div>
  return <MarkdownStream text={text} streaming={!!streaming} />
}

/**
 * 块级流式 markdown:先节流整个 text(流式时每 100ms 一次,避免每 delta 全文
 * splitBlocks 的 O(N²)),再 splitBlocks 切块;complete 块 memo 缓存 html 不重算,
 * 只有末尾 partial 块重算 mdToHtml。块级独立 DOM(非单 div 全文 innerHTML)。
 */
function MarkdownStream({ text, streaming }: { text: string; streaming: boolean }) {
  const throttledText = useThrottle(text, streaming ? 100 : 0)
  const blocks = useMemo(() => splitBlocks(throttledText), [throttledText])
  return (
    <>
      {blocks.map((b, idx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 块顺序稳定,仅末尾追加,idx 作 key 安全
        <BlockView key={idx} text={b.text} partial={!b.complete} />
      ))}
    </>
  )
}

/** 单块渲染:memo 按 text 比较,complete 块 text 不变 -> 跳过重渲染与 mdToHtml 重算。 */
const BlockView = memo(
  function BlockView({ text, partial }: { text: string; partial: boolean }) {
    // partial 块(流式末块)跑 remend 补全未闭合标记(**bold/[text](url),消除闭合瞬间闪烁(FOIM)
    const html = useMemo(() => mdToHtml(partial ? remend(text) : text), [text, partial])
    // biome-ignore lint/security/noDangerouslySetInnerHtml: 渲染 mdToHtml 产出的受信 html(已 escapeHtml 转义)
    return <div className="chat-markdown" dangerouslySetInnerHTML={{ __html: html }} />
  },
  (prev, next) => prev.text === next.text && prev.partial === next.partial,
)

/** 时间窗口节流(leading + trailing):流式期间每 interval ms 最多更新一次,停顿后补最终值。 */
function useThrottle<T>(value: T, interval: number): T {
  const [throttled, setThrottled] = useState(value)
  const lastRunRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value
  useEffect(() => {
    if (interval <= 0) {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      setThrottled(value)
      return
    }
    if (timerRef.current) return
    const elapsed = Date.now() - lastRunRef.current
    if (elapsed >= interval) {
      lastRunRef.current = Date.now()
      setThrottled(value)
    } else {
      timerRef.current = setTimeout(() => {
        lastRunRef.current = Date.now()
        timerRef.current = null
        setThrottled(valueRef.current)
      }, interval - elapsed)
    }
  }, [value, interval])
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )
  return throttled
}

const MessageBubble = memo(function MessageBubble({
  msg,
  typing,
  onToggleThinking,
}: {
  msg: ChatMessage
  typing?: boolean
  onToggleThinking: (messageId: string, segmentId: string) => void
}) {
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
                <TextBlock key={seg.id} text={seg.text} markdown streaming={typing} />
              ) : seg.kind === 'thinking' ? (
                <ThinkingCapsule
                  key={seg.id}
                  seg={seg}
                  onToggle={() => onToggleThinking(msg.id, seg.id)}
                />
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
})

interface ChatPanelProps {
  onClose: () => void
}

/** 思考模式下拉按钮(ADR-0004 D8):显示当前档,点击展开选档;不支持思考时(只有 off)灰显 + tooltip。 */
function ThinkingButton({
  level,
  levels,
  disabled,
  onSelect,
}: {
  level: string
  levels: string[]
  disabled: boolean
  onSelect: (level: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // model 不支持思考时(available 只有 off)灰显 + tooltip,不可展开。
  const unsupported = levels.length <= 1 && levels[0] === 'off'
  // 展开时点击外部关闭菜单
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    // capture 阶段:ChatDrawer 的 chat-drawer-panel onMouseDown stopPropagation 阻止冒泡,
    // 冒泡阶段 document 监听收不到;改 capture 在 target 前触发,确保外部点击能关闭菜单。
    document.addEventListener('mousedown', onDoc, true)
    return () => document.removeEventListener('mousedown', onDoc, true)
  }, [open])
  return (
    <div className="chat-thinking-toggle" ref={ref}>
      <button
        type="button"
        className="chat-quick"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={unsupported ? '当前模型未开启思考(reasoning),去设置页 LLM 配置开启' : '思考模式'}
        aria-label="思考模式"
        aria-expanded={open}
      >
        思考:{level}
      </button>
      {open && (
        <ul className="chat-thinking-menu" role="menu">
          {unsupported ? (
            <li className="chat-thinking-hint" role="menuitem">
              当前模型未开启思考,去设置页 LLM 配置勾选 reasoning
            </li>
          ) : (
            levels.map((lv) => (
              <li key={lv} role="menuitem">
                <button
                  type="button"
                  className={lv === level ? 'active' : ''}
                  onClick={() => {
                    onSelect(lv)
                    setOpen(false)
                  }}
                >
                  {lv}
                  {lv === level ? ' ✓' : ''}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

export default function ChatPanel({ onClose }: ChatPanelProps) {
  const {
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
  } = useChat()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void upload(f)
    e.target.value = ''
  }

  // 上次消息数与流式状态:区分"该滚"(新消息/流式/流结束)与"不该滚"(toggle 胶囊)。
  const prevMsgLenRef = useRef(messages.length)
  const prevStreamingRef = useRef(streaming)
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages 是滚动触发信号(消息增长/流式 delta 时滚到底),非直接引用
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const prevLen = prevMsgLenRef.current
    const prevStream = prevStreamingRef.current
    prevMsgLenRef.current = messages.length
    prevStreamingRef.current = streaming
    // toggle 思维链胶囊只翻转 collapsed(数量不变、非流式),不应触发滚动到底。
    if (!shouldScrollToBottom(prevLen, messages.length, prevStream, streaming)) return
    // 流式期间 instant(每 delta 直接定位,轻);非流式 smooth(完成时平滑收尾)
    el.scrollTo({ top: el.scrollHeight, behavior: streaming ? 'auto' : 'smooth' })
  }, [messages, streaming])

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 组词(中文输入)期间不拦截 Enter,让输入法确认候选词后再判断提交。
    if (e.nativeEvent.isComposing) return
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
        <div className="chat-conn" title={connected ? '已连接' : '未连接'}>
          <span className={`chat-conn-dot ${connected ? 'on' : 'off'}`} />
          <span className="chat-conn-label">{connected ? '已连接' : '未连接'}</span>
        </div>
        <button type="button" className="chat-drawer-close" onClick={onClose} aria-label="关闭对话">
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
                <MessageBubble
                  key={m.id}
                  msg={m}
                  typing={streaming && m.id === lastId}
                  onToggleThinking={toggleThinking}
                />
              ))
            })()}
      </div>
      <div className="chat-quickbar">
        <button
          type="button"
          className="chat-quick"
          onClick={() => send('/skill:health-check', '🔍 健康检查')}
          disabled={!connected || streaming}
          title="知识库健康检查"
          aria-label="健康检查"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
          健康检查
        </button>
        <ThinkingButton
          level={thinkingLevel}
          levels={thinkingLevels}
          disabled={!connected || streaming}
          onSelect={setThinking}
        />
      </div>
      <div
        className="chat-input-row"
        ref={composerRef}
        style={composerHeight ? { height: `${composerHeight}px` } : undefined}
      >
        {ingest && (
          <div className={`chat-ingest chat-ingest-${ingest.phase}`} title={ingest.fileName}>
            <span className="chat-ingest-label">{labelForIngest(ingest.phase)}</span>
            <span className="chat-ctx-track">
              <span className="chat-ctx-fill" style={{ width: `${ingest.percent}%` }} />
            </span>
            {(ingest.phase === 'compiling' || ingest.phase === 'done') && (
              <span className="chat-ctx-pct">{Math.round(ingest.percent)}%</span>
            )}
          </div>
        )}
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
          rows={3}
          disabled={!connected || streaming}
        />
        <input
          ref={fileRef}
          type="file"
          accept={ALLOWED_UPLOAD_EXTS.join(',')}
          onChange={handleFile}
          style={{ display: 'none' }}
        />
        {/* 状态行始终渲染:无数据(未发消息/切库重置)时数字兜底 0、模型名占位 —,
            避免状态行忽隐忽现造成布局抖动 */}
        <div className="chat-composer-status">
          <div className="chat-status-left">
            <span className="chat-turn-tokens" title="本轮 token(输入/输出/缓存命中率)">
              <span className="chat-token-pair">
                <Icon d="M12 19V5 M5 12l7-7 7 7" />
                {fmtTokens(turnStats?.input ?? 0)}
              </span>
              <span className="chat-token-pair">
                <Icon d="M12 5v14 M5 12l7 7 7-7" />
                {fmtTokens(turnStats?.output ?? 0)}
              </span>
              <span className="chat-token-pair">
                <Icon d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                {turnStats ? cacheHitRate(turnStats) : 0}%
              </span>
            </span>
          </div>
          <div className="chat-status-right">
            {model ? (
              <span className="chat-model-name" title={`${model.provider} · ${model.id}`}>
                {model.name}
              </span>
            ) : (
              <span className="chat-model-name" title="未连接">
                —
              </span>
            )}
            <span className="chat-ctx" title={`上下文 ${Math.round(contextUsage?.percent ?? 0)}%`}>
              <span className="chat-ctx-track">
                <span
                  className="chat-ctx-fill"
                  style={{ width: `${Math.min(100, contextUsage?.percent ?? 0)}%` }}
                />
              </span>
              <span className="chat-ctx-pct">{Math.round(contextUsage?.percent ?? 0)}%</span>
            </span>
            <button
              className="chat-upload"
              onClick={() => fileRef.current?.click()}
              disabled={
                !connected || ingest?.phase === 'uploading' || ingest?.phase === 'compiling'
              }
              title="上传文档到 raw/,自动编译"
              aria-label="上传文档"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M12 3v12" />
                <path d="m7 8 5-5 5 5" />
              </svg>
            </button>
            <button
              className="chat-send"
              onClick={submit}
              disabled={!connected || streaming || !input.trim()}
              title={streaming ? '回复中' : '发送'}
              aria-label="发送"
            >
              <svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor">
                <path d="M22.983111 238.08L990.321778 57.457778a27.591111 27.591111 0 0 1 27.875555 11.150222c5.973333 9.102222 7.964444 20.309333 2.958223 30.492444l-413.411556 851.626667a27.989333 27.989333 0 0 1-22.926222 16.270222 26.737778 26.737778 0 0 1-24.860445-11.150222l-156.444444-206.051555c-8.931556-12.174222-24.860444-14.222222-37.831111-6.087112l-119.523556 78.165334a26.567111 26.567111 0 0 1-30.890666-1.024 31.004444 31.004444 0 0 1-11.946667-29.468445l35.84-166.456889c7.964444-36.579556 14.392889-64.113778 45.283555-84.423111l463.758223-298.268444L198.314667 498.915556a28.672 28.672 0 0 1-33.848889-8.135112L6.030222 283.761778a27.420444 27.420444 0 0 1-3.982222-27.420445 29.070222 29.070222 0 0 1 20.935111-18.204444z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
