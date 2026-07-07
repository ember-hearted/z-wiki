import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PageMeta } from '../hooks/useData'
import { useTheme } from '../hooks/useTheme'
import BottomDrawer from './BottomDrawer'

// three + gsap 较重，懒加载拆出独立 chunk，首屏先渲染 hero 再异步挂载书架
const BookShelf3D = lazy(() => import('./BookShelf3D'))

interface HomeProps {
  pages: PageMeta[]
}

export default function Home({ pages }: HomeProps) {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const total = pages.length
  const archiveNo = String(total).padStart(3, '0')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [pullVisible, setPullVisible] = useState(false)

  // 拉绳比书架完整入场更早出现，避免书已落位但拉绳还没显示
  useEffect(() => {
    const timer = setTimeout(() => setPullVisible(true), 600)
    return () => clearTimeout(timer)
  }, [])

  // 稳定引用：避免每次渲染新建函数导致 BookShelf3D 的 WebGL effect 重建场景/重播入场
  const onBookClick = useCallback(
    (stem: string) => {
      navigate(`/pages/${stem}`)
    },
    [navigate],
  )

  const toggleDrawer = useCallback(() => {
    setDrawerOpen((prev) => !prev)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
  }, [])

  // 下栏打开时锁住 body 滚动，确保首页始终只有一屏
  useEffect(() => {
    if (drawerOpen) {
      document.body.classList.add('home-no-scroll')
    } else {
      document.body.classList.remove('home-no-scroll')
    }
    return () => {
      document.body.classList.remove('home-no-scroll')
    }
  }, [drawerOpen])

  return (
    <div className="home">
      <section className="hero" onClick={toggleDrawer}>
        <button
          className={`drawer-pull ${drawerOpen ? 'open' : ''} ${pullVisible ? 'visible' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            toggleDrawer()
          }}
          aria-label={drawerOpen ? '关闭列表' : '打开列表'}
          type="button"
        >
          <span className="drawer-pull-line" />
          <span className="drawer-pull-knob" />
        </button>

        <div className="hero-bg" />
        <div className="hero-meta">
          <span className="hero-archive-label">RANDOM PLAY ARCHIVES</span>
          <span className="hero-divider" />
          <span className="hero-archive-no">ARCHIVE-NO. {archiveNo}</span>
        </div>
        <h1>
          <span className="hero-title-line">Fairy的垃圾桶</span>
          <span className="hero-title-line hero-sub mono">TRASH → KNOWLEDGE</span>
        </h1>
        <div className="hero-tags">
          <span className="hero-caution">CAUTION</span>
          <span className="hero-total mono">TOTAL VOLUMES: {total}</span>
        </div>
      </section>

      <div className="home-shelf-area">
        <Suspense fallback={<div className="shelf-loading" />}>
          <BookShelf3D pages={pages} onBookClick={onBookClick} theme={theme} />
        </Suspense>
        <BottomDrawer
          pages={pages}
          isOpen={drawerOpen}
          onClose={closeDrawer}
          onItemClick={onBookClick}
        />
      </div>
    </div>
  )
}
