import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import type { PageMeta } from './useData'
import { useToast } from './useToast'

// document 级点击委托:拦截 wikilink(<a class="wl" href="/pages/XX">)点击,
// SPA 内 navigate 而非整页跳转。stem 不在可视层(pages 里无此条)则 toast 提示不跳转。
//
// document 级而非容器级:.wl 由 markdown.ts wikilink 渲染专用(文章正文 + chat 回复),
// 语义专一,全局委托安全;App 已持有 pages,无需 prop drilling 透传到 Article/ChatPanel。
export function useWikiLinkNav(pages: PageMeta[]) {
  const navigate = useNavigate()
  const { show } = useToast()

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const a = target?.closest('a.wl')
      if (!a) return
      // 修饰键/中键放行:让浏览器原生新标签页打开(配合 SPA fallback + Article 兜底)
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const href = a.getAttribute('href') ?? ''
      const stem = decodeURIComponent(href.replace(/^\/pages\//, ''))
      if (!stem) return
      e.preventDefault()
      // pages 为空(首屏 loading)时放行 navigate,让 Article 走正常 loading/404
      if (pages.length === 0) {
        navigate(`/pages/${stem}`)
        return
      }
      if (!pages.some((p) => p.stem === stem)) {
        show('该页未在书本中')
        return
      }
      navigate(`/pages/${stem}`)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [pages, navigate, show])
}
