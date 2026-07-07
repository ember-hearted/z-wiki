import type { KeyboardEvent } from 'react'
import { useTheme } from '../hooks/useTheme'

/* ═══════════════════════════════════════════════════
   ThemeToggle — header 设置按钮右侧的明暗滑动开关。
   52×28 pill，日左月右：暗(archive)滑块在左盖日(目标)，露月(当前)；
   亮(draft)在右盖月(目标)，露日(当前)。knob 位置=当前主题(左暗右亮)。
   纯图标无文字。a11y 对齐 Select.tsx 基准（role=switch + 键盘 Space/Enter）。
   ═══════════════════════════════════════════════════ */

export default function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const isDraft = theme === 'draft'

  const onKey = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      toggle()
    }
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      role="switch"
      aria-checked={isDraft}
      aria-label="切换明暗"
      onClick={toggle}
      onKeyDown={onKey}
    >
      <span className="theme-toggle-icon sun" aria-hidden="true">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      </span>
      <span className="theme-toggle-icon moon" aria-hidden="true">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </span>
      <span className="theme-toggle-knob" aria-hidden="true" />
    </button>
  )
}
