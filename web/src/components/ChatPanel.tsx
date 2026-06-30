import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { useChat, type ChatMessage } from '../hooks/useChat'

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'system') {
    return (
      <div className={`chat-msg chat-msg-system ${msg.error ? 'chat-msg-error' : ''}`}>
        {msg.error ? '⚠️ ' : '🔧 '}
        {msg.text}
      </div>
    )
  }
  return (
    <div className={`chat-msg chat-msg-${msg.role}`}>
      <div className="chat-role">{msg.role === 'user' ? '我' : '助手'}</div>
      <div className="chat-text">{msg.text || (msg.role === 'assistant' ? '…' : '')}</div>
    </div>
  )
}

export default function ChatPanel() {
  const { messages, streaming, connected, send } = useChat()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

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
      <div className="chat-status">
        {connected ? '● 已连接' : '○ 未连接'}
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
