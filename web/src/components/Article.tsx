import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import hljs from 'highlight.js/lib/core'
import typescript from 'highlight.js/lib/languages/typescript'
import bash from 'highlight.js/lib/languages/bash'
import python from 'highlight.js/lib/languages/python'
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('python', python)
import { usePageContent } from '../hooks/useData'
import type { PageMeta, TocItem } from '../hooks/useData'

interface ArticleProps {
  pages: PageMeta[]
}

function initArticleHeadings(container: HTMLElement, onActive: (id: string) => void) {
  const headings = container.querySelectorAll<HTMLElement>('h2, h3')
  if (!headings.length) return

  headings.forEach((h, i) => {
    h.id = `s-${i}`
  })

  // 追踪所有 heading 的实时相交状态
  const state = new Map<string, boolean>()

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        state.set(entry.target.id, entry.isIntersecting)
      }

      // 从所有相交的 heading 中找最靠近视口顶部的（当前阅读位置）
      let bestId = ''
      let bestTop = Infinity
      for (const [id, intersecting] of state) {
        if (!intersecting) continue
        const el = document.getElementById(id)
        if (!el) continue
        const top = el.getBoundingClientRect().top
        if (top < bestTop) {
          bestTop = top
          bestId = id
        }
      }
      if (bestId) onActive(bestId)
    },
    { rootMargin: '-80px 0px 0px 0px' },
  )
  headings.forEach((h) => {
    observer.observe(h)
  })
  return () => {
    observer.disconnect()
    state.clear()
  }
}

export default function Article({ pages }: ArticleProps) {
  const { stem } = useParams<{ stem: string }>()
  const { content, loading } = usePageContent(stem)
  const [activeId, setActiveId] = useState('')
  const [showToc, setShowToc] = useState(false)
  const cleanupRef = useRef<(() => void) | null>(null)

  const page = pages.find((p) => p.stem === stem)
  const toc = page?.toc ?? []

  // Callback ref + MutationObserver: 不管内容何时注入（客户端导航 / 硬刷新 / 异步加载），
  // 只要 heading 出现在 DOM 中就自动打 ID 并启动 IntersectionObserver
  const proseRef = useCallback((node: HTMLDivElement | null) => {
    cleanupRef.current?.()
    if (!node) return

    let ioCleanup: (() => void) | null = null

    const tryInit = () => {
      // 断开旧 IntersectionObserver（内容可能已变化）
      ioCleanup?.()
      const c = initArticleHeadings(node, setActiveId)
      if (c) ioCleanup = c
      // 注意：MutationObserver 保持活跃，下次内容变化（如同路由切换文章）仍能检测到
    }

    // 立即尝试（内容可能已就绪）
    tryInit()

    // MutationObserver 持续监视 DOM 变更（dangerouslySetInnerHTML / 客户端路由切换）
    const mo = new MutationObserver(tryInit)
    mo.observe(node, { childList: true, subtree: true })

    cleanupRef.current = () => {
      mo.disconnect()
      ioCleanup?.()
    }
  }, [])

  // Syntax highlighting
  useEffect(() => {
    if (!content) return
    const container = document.querySelector('.article-main')
    if (!container) return
    container.querySelectorAll('pre code[class*="language-"]').forEach((block) => {
      hljs.highlightElement(block as HTMLElement)
    })
  }, [content])

  // Scroll to hash on mount
  useEffect(() => {
    if (!content) return
    const hash = window.location.hash.slice(1)
    if (hash) {
      setTimeout(() => {
        const el = document.getElementById(`s-${hash}`)
        el?.scrollIntoView({ behavior: 'smooth' })
      }, 100)
    }
  }, [content])

  // TOC toggle for mobile
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    setShowToc(mq.matches)
    const handler = (e: MediaQueryListEvent) => setShowToc(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Auto-scroll TOC sidebar to keep active item visible
  const tocStickyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!activeId || !tocStickyRef.current) return
    const sticky = tocStickyRef.current
    const activeLink = sticky.querySelector<HTMLElement>(`a[href="#${activeId}"]`)
    if (!activeLink) return

    const stickyRect = sticky.getBoundingClientRect()
    const linkRect = activeLink.getBoundingClientRect()

    // Check if active link is outside visible area of the sticky container
    const isAbove = linkRect.top < stickyRect.top
    const isBelow = linkRect.bottom > stickyRect.bottom

    if (isAbove || isBelow) {
      // Scroll the sticky container, not the link itself
      const targetScroll = activeLink.offsetTop - stickyRect.height / 2 + linkRect.height / 2
      sticky.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' })
    }
  }, [activeId])

  const pageIndex = pages.findIndex((p) => p.stem === stem)
  const prevPage = pages[pageIndex - 1]
  const nextPage = pages[pageIndex + 1]

  if (loading) {
    return (
      <div className="loading-state">
        <div className="spinner" />
        <p>加载中...</p>
      </div>
    )
  }

  if (!content || !page) {
    return (
      <div className="empty-state">
        <p>该页未在书本中</p>
        <Link to="/" className="back-link">
          返回首页
        </Link>
      </div>
    )
  }

  return (
    <div className="article-layout">
      {/* TOC Sidebar */}
      <aside className={`toc-sidebar ${showToc ? 'visible' : ''}`}>
        <div className="toc-sticky" ref={tocStickyRef}>
          <nav className="toc-nav" aria-label="本页目录">
            {toc.map((item: TocItem, i: number) => (
              <a
                key={item.text}
                href={`#s-${i}`}
                className={`toc-link ${item.level === 'h3' ? 'toc-h3' : ''} ${activeId === `s-${i}` ? 'active' : ''}`}
                onClick={(e) => {
                  e.preventDefault()
                  document.getElementById(`s-${i}`)?.scrollIntoView({ behavior: 'smooth' })
                }}
              >
                {item.text}
              </a>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="article-main">
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: content 来自 server buildView 转换的自有 kb markdown,单用户个人 wiki 非外部输入(无 sanitize,未来接外部内容需加 DOMPurify) */}
        <div ref={proseRef} dangerouslySetInnerHTML={{ __html: content }} />

        {/* Page Navigation */}
        <nav className="page-nav">
          {prevPage && (
            <Link to={`/pages/${prevPage.stem}`} className="page-nav-link prev">
              <span className="page-nav-direction">上一篇</span>
              <span className="page-nav-title">{prevPage.title}</span>
            </Link>
          )}
          {nextPage && (
            <Link to={`/pages/${nextPage.stem}`} className="page-nav-link next">
              <span className="page-nav-direction">下一篇</span>
              <span className="page-nav-title">{nextPage.title}</span>
            </Link>
          )}
        </nav>
      </main>

      {/* TOC toggle for mobile */}
      <button className="toc-toggle" onClick={() => setShowToc((v) => !v)} aria-label="切换目录">
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
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
    </div>
  )
}
