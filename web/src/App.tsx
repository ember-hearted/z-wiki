import { Routes, Route } from 'react-router-dom'
import { usePages } from './hooks/useData'
import Header from './components/Header'
import Home from './components/Home'
import Article from './components/Article'
import FloatingActions from './components/FloatingActions'

export default function App() {
  const { pages, loading, error } = usePages()

  if (error) {
    return (
      <div className="app-error">
        <p>无法加载数据: {error}</p>
        <p className="app-error-hint">知识库数据尚未生成,启动 server 后将由 agent 自动构建。</p>
      </div>
    )
  }

  return (
    <>
      <Header pages={pages} />
      <main className="app-main">
        {loading ? (
          <div className="loading-state">
            <div className="spinner" />
            <p>加载中...</p>
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<Home pages={pages} />} />
            <Route path="/pages/:stem" element={<Article pages={pages} />} />
          </Routes>
        )}
      </main>
      <FloatingActions />
    </>
  )
}
