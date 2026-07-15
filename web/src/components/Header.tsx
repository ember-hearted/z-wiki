import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import type { PageMeta } from '../hooks/useData'
import ThemeToggle from './ThemeToggle'

const SECTION_LABELS: Record<string, string> = {
  wiki: '知识库',
  output: '报告与分析',
}

interface HeaderProps {
  pages: PageMeta[]
  chatOpen: boolean
  onToggleChat: () => void
}

export default function Header({ pages, chatOpen, onToggleChat }: HeaderProps) {
  const location = useLocation()
  const isArticle = location.pathname.startsWith('/pages/')
  const currentStem = isArticle
    ? decodeURIComponent(location.pathname.replace('/pages/', '').replace(/\/$/, ''))
    : ''
  const currentPage = pages.find((p) => p.stem === currentStem)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(0)
  // 齿轮 toggle:记住"进入设置前的 path",在 /settings 与前 path 间切换(丢了回 /)
  const [prevPath, setPrevPath] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)

  const isSettings = location.pathname === '/settings'
  const toggleSettings = () => {
    if (isSettings) {
      navigate(prevPath || '/')
    } else {
      setPrevPath(location.pathname)
      navigate('/settings')
    }
  }

  const results = query.trim()
    ? pages
        .filter(
          (p) =>
            p.title.toLowerCase().includes(query.toLowerCase()) ||
            p.summary.toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, 8)
    : []

  const handleKey = (e: KeyboardEvent) => {
    // IME 组词(中文输入)期间不拦截方向键/Enter,让输入法正常选词与确认候选词。
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[selected]) {
      navigate(`/pages/${results[selected].stem}`)
      setOpen(false)
      setQuery('')
      inputRef.current?.blur()
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: query 故意进依赖,query 变即重置 selected(results.length 不变时也需重置,否则选中项错位)
  useEffect(() => {
    setOpen(results.length > 0)
    setSelected(0)
  }, [query, results.length])

  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="header-logo" onClick={() => window.scrollTo(0, 0)}>
          <span className="header-logo-mono" aria-hidden="true">
            RPA
          </span>
          <span>Wiki</span>
        </Link>

        {!isArticle && (
          <button
            type="button"
            className={`header-chat-btn ${chatOpen ? 'active' : ''}`}
            onClick={onToggleChat}
            aria-label="打开对话"
            aria-expanded={chatOpen}
          >
            对话
          </button>
        )}

        {isArticle && currentPage && (
          <nav className="header-breadcrumb">
            <Link to="/" className="breadcrumb-link">
              首页
            </Link>
            <span className="breadcrumb-sep">/</span>
            <Link to="/" className="breadcrumb-link">
              {SECTION_LABELS[currentPage.type] || currentPage.type}
            </Link>
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-current">{currentPage.title}</span>
          </nav>
        )}

        {!isArticle && (
          <div className="header-search">
            <svg
              className="search-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              placeholder="搜索文章..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => results.length > 0 && setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 200)}
              onKeyDown={handleKey}
            />
            {open && (
              <div className="search-dropdown">
                {results.map((p, i) => (
                  <Link
                    key={p.stem}
                    to={`/pages/${p.stem}`}
                    className={`search-item ${i === selected ? 'highlighted' : ''}`}
                    onMouseDown={() => {
                      setOpen(false)
                      setQuery('')
                    }}
                  >
                    <span className="search-item-title">{p.title}</span>
                    {p.summary && <span className="search-item-summary">{p.summary}</span>}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        <ThemeToggle />

        <button
          type="button"
          className={`header-settings-btn ${isSettings ? 'active' : ''}`}
          onClick={toggleSettings}
          aria-label={isSettings ? '关闭设置' : '打开设置'}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
  )
}
