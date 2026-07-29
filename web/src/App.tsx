import { lazy, type ReactNode, Suspense, useState } from 'react'
import { Route, Routes } from 'react-router'
import ChatDrawer from './components/ChatDrawer'
import FloatingActions from './components/FloatingActions'
import Header from './components/Header'
import { usePages } from './hooks/useData'
import { ThemeProvider } from './hooks/useTheme'
import { useWikiLinkNav } from './hooks/useWikiLinkNav'

// 路由级懒加载：把 three/gsap(BookShelf3D)与 highlight.js(Article)拆出首屏 chunk
const Home = lazy(() => import('./components/Home'))
const Article = lazy(() => import('./components/Article'))
const Settings = lazy(() => import('./components/Settings'))

function LoadingState() {
  return (
    <div className="loading-state">
      <div className="spinner" />
      <p>加载中...</p>
    </div>
  )
}

export default function App() {
  const { pages, loading, error } = usePages()
  const [chatOpen, setChatOpen] = useState(false)

  useWikiLinkNav(pages)

  // /settings 路由绕过 pages 的 loading/error 门控(设置页不依赖知识库内容)
  const gate: ReactNode = error ? (
    <div className="app-error">
      <p>无法加载数据: {error}</p>
      <p className="app-error-hint">知识库数据尚未生成,启动 server 后将由 agent 自动构建。</p>
    </div>
  ) : loading ? (
    <LoadingState />
  ) : null

  return (
    <ThemeProvider>
      <Header pages={pages} chatOpen={chatOpen} onToggleChat={() => setChatOpen(true)} />
      <main className="app-main">
        <Suspense fallback={<LoadingState />}>
          <Routes>
            <Route path="/settings" element={<Settings />} />
            <Route path="/" element={gate ?? <Home pages={pages} />} />
            <Route path="/pages/:stem" element={gate ?? <Article pages={pages} />} />
          </Routes>
        </Suspense>
      </main>
      <FloatingActions />

      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} />
    </ThemeProvider>
  )
}
