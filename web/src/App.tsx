import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { usePages } from './hooks/useData'
import Header from './components/Header'
import Home from './components/Home'
import Article from './components/Article'
import FloatingActions from './components/FloatingActions'
import ChatPanel from './components/ChatPanel'

type Tab = 'kb' | 'chat'

export default function App() {
  const { pages, loading, error } = usePages()
  const [tab, setTab] = useState<Tab>('chat')

  return (
    <>
      <nav className="tab-bar">
        <button
          className={`tab-btn ${tab === 'chat' ? 'active' : ''}`}
          onClick={() => setTab('chat')}
        >
          对话
        </button>
        <button
          className={`tab-btn ${tab === 'kb' ? 'active' : ''}`}
          onClick={() => setTab('kb')}
        >
          知识库
        </button>
      </nav>

      {tab === 'chat' ? (
        <main className="app-main">
          <ChatPanel />
        </main>
      ) : error ? (
        <main className="app-main">
          <div className="app-error">
            <p>无法加载数据: {error}</p>
            <p className="app-error-hint">知识库数据尚未生成,启动 server 后将由 agent 自动构建。</p>
          </div>
        </main>
      ) : (
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
      )}
    </>
  )
}
