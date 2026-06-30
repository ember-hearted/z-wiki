import { useEffect } from 'react'
import type { PageMeta } from '../hooks/useData'

/* ═══════════════════════════════════════════════════
   BottomDrawer — 书架下栏：从下方升起的分类列表
   点击背景关闭，点击条目进入详情，阻止事件冒泡到书架
   ═══════════════════════════════════════════════════ */

interface BottomDrawerProps {
  pages: PageMeta[]
  isOpen: boolean
  onClose: () => void
  onItemClick: (stem: string) => void
}

interface Group {
  key: 'wiki' | 'output'
  label: string
  pages: PageMeta[]
}

function groupPages(pages: PageMeta[]): Group[] {
  const wiki = pages.filter((p) => p.type === 'wiki')
  const output = pages.filter((p) => p.type === 'output')
  const groups: Group[] = [
    { key: 'output', label: '报告与分析', pages: output },
    { key: 'wiki', label: '知识库', pages: wiki },
  ]
  return groups.filter((g) => g.pages.length > 0)
}

export default function BottomDrawer({ pages, isOpen, onClose, onItemClick }: BottomDrawerProps) {
  const groups = groupPages(pages)

  // 下栏打开时拦截空格键，防止触发书架轨道球
  useEffect(() => {
    if (!isOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space') {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
      if (e.code === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [isOpen, onClose])

  return (
    <div
      className={`bottom-drawer ${isOpen ? 'open' : ''}`}
      onWheel={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bottom-drawer-backdrop" onClick={onClose} />
      <div className="bottom-drawer-panel">
        <header className="bottom-drawer-header">
          <span className="bottom-drawer-title">ARCHIVE INDEX</span>
          <span className="bottom-drawer-count mono">
            {String(pages.length).padStart(3, '0')} VOLUMES
          </span>
        </header>

        <div className="bottom-drawer-body">
          {groups.map((group) => (
            <section key={group.key} className="bottom-drawer-section">
              <h2 className="bottom-drawer-section-title mono">
                {group.label}
                <span className="bottom-drawer-section-count">
                  {String(group.pages.length).padStart(3, '0')}
                </span>
              </h2>
              <div className="bottom-drawer-grid">
                {group.pages.map((page) => (
                  <button
                    key={page.stem}
                    className="bottom-drawer-item"
                    onClick={() => onItemClick(page.stem)}
                    type="button"
                  >
                    <span className="bottom-drawer-item-title">{page.title}</span>
                    <span className="bottom-drawer-item-summary">
                      {page.summary || page.title}
                    </span>
                    <span className="bottom-drawer-item-meta mono">
                      {group.label} · {page.updated}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
