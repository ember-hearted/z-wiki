import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import type { PageMeta } from '../hooks/useData'

const SECTION_LABELS: Record<string, string> = {
  wiki:   '知识库',
  output: '报告与分析',
}

interface HeaderProps {
  pages: PageMeta[]
}

export default function Header({ pages }: HeaderProps) {
  const location = useLocation()
  const isArticle = location.pathname.startsWith('/pages/')
  const currentStem = isArticle
    ? decodeURIComponent(location.pathname.replace('/pages/', '').replace(/\/$/, ''))
    : ''
  const currentPage = pages.find(p => p.stem === currentStem)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = query.trim()
    ? pages.filter(p =>
        p.title.toLowerCase().includes(query.toLowerCase()) ||
        p.summary.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 8)
    : []

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(i => Math.max(i - 1, 0))
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

  useEffect(() => {
    setOpen(results.length > 0)
    setSelected(0)
  }, [query, results.length])

  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="header-logo" onClick={() => window.scrollTo(0, 0)}>
          <span className="header-logo-mono" aria-hidden="true">RPA</span>
          <span>Wiki</span>
        </Link>

        {isArticle && currentPage && (
          <nav className="header-breadcrumb">
            <Link to="/" className="breadcrumb-link">首页</Link>
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
            <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              placeholder="搜索文章..."
              value={query}
              onChange={e => setQuery(e.target.value)}
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
                    onMouseDown={() => { setOpen(false); setQuery('') }}
                  >
                    <span className="search-item-title">{p.title}</span>
                    {p.summary && <span className="search-item-summary">{p.summary}</span>}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
