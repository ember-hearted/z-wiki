import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/700.css'
import App from './App'
import { ToastProvider } from './hooks/useToast'
import './styles/tokens.css'
import './styles/header.css'
import './styles/home.css'
import './styles/article.css'
import './styles/chat.css'
import './styles/settings.css'
import './styles/base.css'

// biome-ignore lint/style/noNonNullAssertion: #root 元素在 index.html 必然存在
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)

// 在 React 首次渲染后非关键路径读取用户主题偏好(localStorage 可能因 leveldb 损坏阻塞 ~4s)。
// index.html 已设默认 theme='archive',此处覆盖为实际偏好;不阻塞首屏。
setTimeout(() => {
  try {
    const theme = localStorage.getItem('theme')
    if (theme === 'draft' || theme === 'archive') {
      document.documentElement.setAttribute('data-theme', theme)
    }
  } catch {
    /* localStorage 不可用,保持 index.html 的默认值 */
  }
}, 0)
