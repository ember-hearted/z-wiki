import type { ReactNode } from 'react'

interface QuickActionProps {
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  title?: string
  children?: ReactNode
}

/** 快捷操作按钮:统一 .chat-quick 样式层,封装重复的 className/disabled/title/aria-label。
 *  复杂的交互式按钮(如思考开关)保持独立组件,不塞进此接口。 */
export default function QuickAction({
  label,
  onClick,
  disabled,
  active,
  title,
  children,
}: QuickActionProps) {
  return (
    <button
      type="button"
      className={`chat-quick${active ? ' chat-quick-on' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
    >
      {children}
      {label}
    </button>
  )
}
