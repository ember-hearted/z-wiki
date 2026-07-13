import { useCallback, useEffect, useState } from 'react'
import Select from './Select'

/* ═══════════════════════════════════════════════════
   Settings — 设置页:LLM 配置(api 规范/baseUrl/model/apiKey)+ Vault 切换/新建
   ADR-0004 D1/D2/D5/D7(冷重载)+ ADR-0003 D4(多 Vault)/ D5(ingest 中禁切)/ D7(切库闭环)
   "返回首页"由 Header 齿轮 toggle 承担(不再在此放返回按钮)
   ═══════════════════════════════════════════════════ */

interface VaultEntry {
  path: string
  name?: string
}

interface ApiSpecEntry {
  id: string
  label: string
  suffix: string
}

interface ConfigStatus {
  baseUrl: string
  api: string
  model: string
  contextWindow: number
  apiKey: string
  hasApiKey: boolean
  apiKeyMasked: string
  exposedApiSpecs: string[]
  shellPath: string
  /** model 是否支持思考(当前生效 = config.reasoning ?? 自动推断,ADR-0004 D8)。 */
  reasoning: boolean
}

export default function Settings() {
  const [vaults, setVaults] = useState<VaultEntry[]>([])
  const [currentVault, setCurrentVault] = useState('')
  const [currentVaultParent, setCurrentVaultParent] = useState('')
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null)
  const [specs, setSpecs] = useState<ApiSpecEntry[]>([])
  const [exposed, setExposed] = useState<string[]>([])
  const [ingestActive, setIngestActive] = useState(false)

  // LLM 配置 form:从 /api/config/status 回填,保存时 POST /api/config/llm
  const [apiInput, setApiInput] = useState('openai-completions')
  const [baseUrlInput, setBaseUrlInput] = useState('')
  const [modelInput, setModelInput] = useState('')
  const [contextWindowInput, setContextWindowInput] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [shellPathInput, setShellPathInput] = useState('')
  const [reasoningInput, setReasoningInput] = useState(false)
  const [savingShell, setSavingShell] = useState(false)
  const [newVaultName, setNewVaultName] = useState('')
  const [newVaultParent, setNewVaultParent] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [vaultsRes, statusRes, activeRes, specsRes] = await Promise.all([
        fetch('/api/vaults'),
        fetch('/api/config/status'),
        fetch('/api/ingest/active'),
        fetch('/api/specs'),
      ])
      const vdata = (await vaultsRes.json()) as {
        vaults: VaultEntry[]
        currentVault: string
        currentVaultParent: string
      }
      setVaults(vdata.vaults ?? [])
      setCurrentVault(vdata.currentVault ?? '')
      setCurrentVaultParent(vdata.currentVaultParent ?? '')
      const status = (await statusRes.json()) as ConfigStatus
      setConfigStatus(status)
      setBaseUrlInput(status.baseUrl || '')
      setModelInput(status.model || '')
      setContextWindowInput(String(status.contextWindow ?? 128000))
      setApiKeyInput(status.apiKey || '')
      setShellPathInput(status.shellPath || '')
      setReasoningInput(status.reasoning)
      setIngestActive(((await activeRes.json()) as { active: boolean }).active ?? false)
      const specsData = (await specsRes.json()) as { specs: ApiSpecEntry[]; exposed: string[] }
      setSpecs(specsData.specs ?? [])
      setExposed(specsData.exposed ?? [])
      // apiInput 回填:status.api 不在 exposed 列表(用户手编非暴露规范)时回退首个 exposed,
      // 避免 <select value> 找不到匹配 option 显示空(Q2.4:exposed 控制暴露子集)
      setApiInput(
        specsData.exposed.includes(status.api)
          ? status.api
          : (specsData.exposed[0] ?? 'openai-completions'),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 监听 ingest 状态变化(useChat dispatch 的 ingest-state 事件)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { active: boolean }
      setIngestActive(detail.active)
    }
    window.addEventListener('ingest-state', handler)
    return () => window.removeEventListener('ingest-state', handler)
  }, [])

  const saveLlm = async () => {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/config/llm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api: apiInput,
          baseUrl: baseUrlInput,
          model: modelInput,
          contextWindow: Number(contextWindowInput),
          apiKey: apiKeyInput,
          reasoning: reasoningInput,
        }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setError(data.error ?? `HTTP ${res.status}`)
      } else {
        setNotice('配置已重载,可继续对话')
        void load()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  // 保存 Git Bash 路径(ADR-0003 D6 shellPath 覆盖):写 config.json,需重启 app 生效
  // (pi settingsManager 在 session 创建时读 settings.json,运行中 session 不重读,无热重载)。
  const saveShell = async () => {
    setSavingShell(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/config/shell', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shellPath: shellPathInput }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setError(data.error ?? `HTTP ${res.status}`)
      } else {
        setNotice('Git Bash 路径已保存')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingShell(false)
    }
  }

  // 打开 vault 目录(系统文件管理器):仅桌面形态有 window.desktop(preload 注入)。
  // dev 形态(浏览器)按钮已条件渲染隐藏,此处防御性 return。
  const openVault = async (vaultPath: string) => {
    if (!window.desktop) return
    setBusy(true)
    setError(null)
    try {
      const err = await window.desktop.openVault(vaultPath)
      if (err) setError(`打开失败:${err}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const switchVault = async (vaultPath: string) => {
    if (ingestActive || vaultPath === currentVault) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/vault/switch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: vaultPath }),
      })
      if (res.status === 409) {
        setError('有上传正在处理,请等待完成后再切换 Vault')
        setIngestActive(true)
      } else if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setError(data.error ?? `HTTP ${res.status}`)
      } else {
        setNotice('已切换知识库,正在重连…')
        setTimeout(() => {
          window.location.href = '/'
        }, 500)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // 选 vault 父目录(原生文件夹选择器):仅桌面形态有 window.desktop。
  const selectVaultParent = async () => {
    if (!window.desktop) return
    const selected = await window.desktop.selectVaultPath()
    if (selected) setNewVaultParent(selected)
  }

  const createVault = async () => {
    const trimmed = newVaultName.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const body: { name: string; parentPath?: string } = { name: trimmed }
      if (newVaultParent.trim()) body.parentPath = newVaultParent.trim()
      const res = await fetch('/api/vault', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setError(data.error ?? `HTTP ${res.status}`)
      } else {
        const data = (await res.json()) as { vault: { path: string } }
        setNotice(`已新建知识库"${trimmed}"(${data.vault.path}),点击"切换"以打开`)
        setNewVaultName('')
        setNewVaultParent('')
        void load()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // 删除知识库:后端移除 config 登记 + 删 kb/ 目录。删当前库由后端拦(400),前端再保险禁用。
  const deleteVault = async (vaultPath: string) => {
    if (busy) return
    if (!window.confirm('删除知识库将移除其目录与配置登记,且不可恢复。确认删除?')) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/vault/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: vaultPath }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setError(data.error ?? `HTTP ${res.status}`)
      } else {
        setNotice('已删除知识库')
        void load()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // 保存按钮:apiKey/baseUrl/model 空 或 contextWindow 非正整数则禁用(Q4.1d:UI 提前拦)
  const contextWindowNum = Number(contextWindowInput)
  const canSaveLlm =
    saving ||
    !apiKeyInput.trim() ||
    !baseUrlInput.trim() ||
    !modelInput.trim() ||
    !Number.isInteger(contextWindowNum) ||
    contextWindowNum <= 0

  return (
    <div className="settings">
      <div className="settings-inner">
        <div className="settings-header">
          <h1 className="settings-title">设置</h1>
        </div>

        {error && <div className="settings-error">{error}</div>}
        {notice && <div className="settings-notice">{notice}</div>}

        {/* ── LLM 配置 ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">LLM 配置</h2>

          {/* api 规范:自定义下拉(替换原生 select,展开列表也走设计 token) */}
          <div className="settings-field">
            <label className="settings-label" htmlFor="llm-api">
              API 规范
            </label>
            <div className="settings-control">
              <Select
                id="llm-api"
                ariaLabel="API 规范"
                value={apiInput}
                options={specs
                  .filter((s) => exposed.includes(s.id))
                  .map((s) => ({ value: s.id, label: s.label }))}
                onChange={setApiInput}
              />
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="llm-base">
              Base URL
            </label>
            <div className="settings-control">
              <input
                id="llm-base"
                className="settings-input"
                type="text"
                placeholder="https://api.openai.com/v1"
                value={baseUrlInput}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="llm-model">
              模型
            </label>
            <div className="settings-control">
              <input
                id="llm-model"
                className="settings-input"
                type="text"
                placeholder="gpt-4o"
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="llm-context">
              上下文窗口
            </label>
            <div className="settings-control">
              <input
                id="llm-context"
                className="settings-input"
                type="number"
                min="1"
                placeholder="128000"
                value={contextWindowInput}
                onChange={(e) => setContextWindowInput(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="llm-key">
              API Key
            </label>
            <div className="settings-control">
              <div className="settings-input-wrap">
                <input
                  id="llm-key"
                  className="settings-input settings-input-key"
                  type={showKey ? 'text' : 'password'}
                  placeholder={configStatus?.apiKeyMasked ? configStatus.apiKeyMasked : 'apiKey'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="settings-input-icon"
                  onClick={() => setShowKey((s) => !s)}
                  aria-label={showKey ? '隐藏 API key' : '显示 API key'}
                  aria-pressed={showKey}
                >
                  {showKey ? (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                      <line x1="2" y1="2" x2="22" y2="22" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="llm-reasoning">
              思考模式
            </label>
            <div className="settings-control">
              <button
                type="button"
                id="llm-reasoning"
                className="settings-switch"
                role="switch"
                aria-checked={reasoningInput}
                onClick={() => setReasoningInput((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault()
                    setReasoningInput((v) => !v)
                  }
                }}
              >
                <span className="settings-switch-knob" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="settings-actions">
            <button
              type="button"
              className="settings-btn primary"
              onClick={() => void saveLlm()}
              disabled={canSaveLlm}
            >
              {saving ? '保存中…' : '保存并重载'}
            </button>
          </div>
        </section>

        {/* ── Git Bash 路径(可选,ADR-0003 D6 shellPath 覆盖)── */}
        <section className="settings-section">
          <h2 className="settings-section-title">Git Bash 路径(可选)</h2>
          <p className="settings-hint">
            Windows 找 Git Bash(Program Files\Git\bin\bash.exe → PATH),mac/linux 走 /bin/bash → PATH
            → sh。想指定其他 bash 可执行文件时填完整路径覆盖
          </p>
          <div className="settings-field">
            <label className="settings-label" htmlFor="shell-path">
              bash.exe 路径
            </label>
            <div className="settings-control">
              <input
                id="shell-path"
                className="settings-input"
                type="text"
                placeholder="C:\Program Files\Git\bin\bash.exe"
                value={shellPathInput}
                onChange={(e) => setShellPathInput(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="settings-actions">
            <button
              type="button"
              className="settings-btn primary"
              onClick={() => void saveShell()}
              disabled={savingShell}
            >
              {savingShell ? '保存中…' : '保存'}
            </button>
          </div>
        </section>

        {/* ── Vault 列表 + 切换 ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">知识库(Vault)</h2>
          {ingestActive && (
            <p className="settings-warning">有上传正在处理,切换已禁用,请等待完成。</p>
          )}
          <ul className="vault-list">
            {vaults.map((v) => {
              const isCurrent = v.path === currentVault
              return (
                <li key={v.path} className={`vault-item ${isCurrent ? 'current' : ''}`}>
                  <div className="vault-info">
                    <span className="vault-name">{v.name || v.path}</span>
                    <code className="vault-path">{v.path}</code>
                    {isCurrent && <span className="vault-tag">当前</span>}
                  </div>
                  <div className="vault-actions">
                    {window.desktop && (
                      <button
                        type="button"
                        className="settings-btn"
                        onClick={() => void openVault(v.path)}
                        disabled={busy}
                      >
                        打开
                      </button>
                    )}
                    <button
                      type="button"
                      className="settings-btn accent"
                      onClick={() => void switchVault(v.path)}
                      disabled={isCurrent || ingestActive || busy}
                    >
                      切换
                    </button>
                    <button
                      type="button"
                      className="settings-btn danger"
                      onClick={() => void deleteVault(v.path)}
                      disabled={isCurrent || busy}
                    >
                      删除
                    </button>
                  </div>
                </li>
              )
            })}
            {vaults.length === 0 && <li className="vault-empty">暂无已登记的知识库</li>}
          </ul>

          {/* ── 新建 Vault ── */}
          <div className="settings-field new-vault">
            <label className="settings-label" htmlFor="new-vault-name">
              新建知识库
            </label>
            <div className="settings-control">
              <input
                id="new-vault-name"
                className="settings-input"
                type="text"
                placeholder="输入知识库名称"
                value={newVaultName}
                onChange={(e) => setNewVaultName(e.target.value)}
              />
              <button
                type="button"
                className="settings-btn"
                onClick={() => void createVault()}
                disabled={busy || !newVaultName.trim()}
              >
                新建
              </button>
            </div>
            {window.desktop && (
              <div className="new-vault-location">
                <span>存放位置:</span>
                <code className="vault-path">{newVaultParent || currentVaultParent || '默认'}</code>
                <button
                  type="button"
                  className="settings-btn"
                  onClick={() => void selectVaultParent()}
                  disabled={busy}
                >
                  {newVaultParent ? '更改' : '选择目录'}
                </button>
                {newVaultParent && (
                  <button
                    type="button"
                    className="settings-btn"
                    onClick={() => setNewVaultParent('')}
                    disabled={busy}
                  >
                    清除
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ── 关于(开源许可声明,ADR-0007 决策 4:GPL-2.0 分发义务)── */}
        <section className="settings-section">
          <h2 className="settings-section-title">关于</h2>
          <p className="settings-about-text">
            z-wiki 内置{' '}
            <a href="https://github.com/jgm/pandoc" target="_blank" rel="noopener noreferrer">
              pandoc
            </a>{' '}
            二进制用于文档格式转换(非 md 上传解析),遵循{' '}
            <a
              href="https://www.gnu.org/licenses/old-licenses/gpl-2.0.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              GPL-2.0
            </a>{' '}
            许可。
          </p>
          <p className="settings-about-text">
            pandoc 作为独立可执行文件被调用,不链接进 z-wiki 进程,GPL 不传染主程序代码。 pandoc
            源码获取:
            <a href="https://github.com/jgm/pandoc" target="_blank" rel="noopener noreferrer">
              github.com/jgm/pandoc
            </a>
            。
          </p>
        </section>
      </div>
    </div>
  )
}
