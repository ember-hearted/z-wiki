import { useCallback, useMemo } from 'react'

interface A2AModalProps {
  open: boolean
  onClose: () => void
  a2aEnabled: boolean
  onToggle: (enabled: boolean) => void
}

const INSTRUCTION_MD = `## A2A 收件 — 使用说明

通过 HTTP 接口将内容发送到 z-wiki，经 AI 编译后存入知识库。

### 接口地址

\`\`\`
POST http://localhost:{port}/api/ingest
\`\`\`

### 请求格式

\`\`\`json
{
  "content": "要编译的 Markdown 内容",
  "title": "可选文件名",
  "source": "你的 Agent 名"
}
\`\`\`

### curl 示例

\`\`\`bash
curl -X POST http://localhost:{port}/api/ingest \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "# 笔记标题\\n\\n正文内容",
    "title": "来自 agent 的笔记",
    "source": "我的 Agent"
  }'
\`\`\`

### 说明

- \`source\` 会显示在 z-wiki 的聊天记录中，方便知道内容来自哪个 Agent
- \`title\` 用于生成文件名，不传则使用时间戳
- 编译完成后前端会收到通知
- 关闭「A2A 收件」后此接口将返回 403`

export default function A2AModal({ open, onClose, a2aEnabled, onToggle }: A2AModalProps) {
  const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80')

  // 说明文档始终渲染(不受开关影响,避免切换时布局伸缩),端口替换为运行时值
  const renderedText = useMemo(() => {
    return INSTRUCTION_MD.replace(/\{port\}/g, port)
  }, [port])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(renderedText)
    } catch (err) {
      console.warn('复制全文失败', err)
    }
  }, [renderedText])

  if (!open) return null

  return (
    <div className="a2a-overlay" onClick={onClose}>
      <div className="a2a-modal" onClick={(e) => e.stopPropagation()}>
        <div className="a2a-header">
          <h2 className="a2a-title">A2A 收件</h2>
          <label className="a2a-toggle-label">
            <span className="a2a-toggle-text">{a2aEnabled ? '已开启' : '已关闭'}</span>
            <input
              type="checkbox"
              className="a2a-toggle-input"
              checked={a2aEnabled}
              onChange={(e) => onToggle(e.target.checked)}
            />
            <span className="a2a-toggle-track" />
          </label>
          <button type="button" className="a2a-close" onClick={onClose} aria-label="关闭">
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
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div className="a2a-body">
          <pre className="a2a-doc">{renderedText}</pre>
          <button type="button" className="a2a-copy" onClick={handleCopy}>
            复制全文
          </button>
        </div>
      </div>
    </div>
  )
}
