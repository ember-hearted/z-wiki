import { useEffect, useRef, useState } from 'react'
import type { Segment } from '../hooks/useChat'

/** 取 segments 里最后一条 text 段(从末尾找第一个 kind==='text')。
 *  用于复制按钮:复制 assistant 最后一条文本事件的原始 md(排除 tool/thinking)。 */
export function getLastTextSegment(segments: Segment[]): Extract<Segment, { kind: 'text' }> | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]
    if (seg.kind === 'text') return seg
  }
  return null
}

/** assistant 行右下角复制按钮:复制给定原始 md 文本。
 *  点击成功 -> 图标变 ✓ 约 1.5s 恢复;失败 console.warn;✓ 期间可再点重置计时。 */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      console.warn('复制失败', e)
    }
  }

  return (
    <button
      type="button"
      className="chat-copy-btn"
      onClick={onClick}
      aria-label={copied ? '已复制' : '复制'}
    >
      <svg
        aria-hidden="true"
        width="16"
        height="16"
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
  )
}
