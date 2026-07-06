import { useCallback, useEffect, useState } from 'react'

export type Theme = 'archive' | 'draft'

const STORAGE_KEY = 'theme'

// 初值读 documentElement.data-theme（index.html 的 FOUC 内联脚本在 React 挂载前已设好），
// 保证 React 状态与 DOM 一致，首屏不二次跳动。
function readTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'draft' || attr === 'archive') return attr
  return 'archive'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme)

  // 切换时同步 DOM data-theme（驱动 CSS）+ 持久化到 localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // localStorage 不可用(隐私模式等)时静默降级：仅当前会话生效，不持久化
    }
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'archive' ? 'draft' : 'archive'))
  }, [])

  return { theme, toggle }
}
