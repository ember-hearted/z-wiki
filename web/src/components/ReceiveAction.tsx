import { useCallback, useEffect, useRef, useState } from 'react'

/** 收件提示词(ADR-0026):复制给外部 agent 的指令,形态是提示词而非 API 文档。
 *  末尾「要投递的内容」留粘贴位,与用户随后粘贴的内容拼成连贯指令。
 *  {port} 为占位符,复制时替换为运行时端口(桌面形态端口随机,ADR-0003 D2)。 */
const RECEIVE_PROMPT = `请帮我把一段内容投递到我本机的 z-wiki 知识库,它收到后会用 AI 编译入库。

## 怎么投递

向我本机的 z-wiki 服务发一个 HTTP POST:

\`\`\`bash
jq -n \\
  --arg content "<要投递的内容全文>" \\
  --arg title "<你起的简短英文文件名,短横线分隔>" \\
  --arg source "<你的 agent 名,如 Codex>" \\
  '{content: $content, title: $title, source: $source}' \\
| curl -sS -X POST http://localhost:{port}/api/ingest \\
    -H "Content-Type: application/json" -d @-
\`\`\`

没有 jq 就用你顺手的方式构造 JSON,唯一要求是转义必须正确,不要手工拼 JSON 字符串。

## 规则

- content = 下面「要投递的内容」全文。原样发送,不要总结、不要改写、不要补标题——编译是 z-wiki 的事
- title 你起一个:简短、英文、短横线分隔(如 react-hooks-notes)
- source 报你自己的 agent 名,会显示在我的 z-wiki 聊天记录里
- 投递成功(200)后,把响应里的 response 字段原样转告我,那是编译小结
- 返回 403 = 我把收件开关关了,提醒我「去 z-wiki 打开收件开关」
- 连接失败 = z-wiki 没在运行,提醒我启动
- 如果你没有执行命令的能力(比如无终端环境),直接告诉我无法投递,不要编造已发送

## 要投递的内容

(在这行下面粘贴)
`

/** 组装收件提示词:{port} 占位符替换为运行时端口。纯函数,便于测试。 */
export function buildReceivePrompt(port: string): string {
  return RECEIVE_PROMPT.replace(/\{port\}/g, port)
}

interface ReceiveActionProps {
  a2aEnabled: boolean
  onToggle: (enabled: boolean) => void
}

/** 收件胶囊(ADR-0026):左开关 + 小竖线 + 右复制,整体一个按钮胶囊。
 *  开关关态复制禁用;开态点复制把收件提示词写剪切板,图标变 ✓ 1.5s(同 chatCopy 模式)。 */
export default function ReceiveAction({ a2aEnabled, onToggle }: ReceiveActionProps) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const handleCopy = useCallback(async () => {
    const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80')
    try {
      await navigator.clipboard.writeText(buildReceivePrompt(port))
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.warn('复制收件提示词失败', err)
    }
  }, [])

  return (
    <div className={`receive-capsule${a2aEnabled ? ' chat-quick-on' : ''}`}>
      <label className="receive-toggle">
        <input
          type="checkbox"
          className="receive-toggle-input"
          checked={a2aEnabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="receive-toggle-track" />
        收件
      </label>
      <span className="receive-sep" />
      <button
        type="button"
        className="receive-copy"
        disabled={!a2aEnabled}
        onClick={handleCopy}
        aria-label={copied ? '已复制' : '复制收件提示词'}
        title={a2aEnabled ? '复制收件提示词' : '先打开收件开关'}
      >
        <svg
          aria-hidden="true"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {copied ? (
            <path d="M20 6 9 17l-5-5" />
          ) : (
            <>
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </>
          )}
        </svg>
      </button>
    </div>
  )
}
