import { useState, useEffect, useCallback } from 'react'

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
  hasApiKey: boolean
  exposedApiSpecs: string[]
}

export default function Settings() {
  const [vaults, setVaults] = useState<VaultEntry[]>([])
  const [currentVault, setCurrentVault] = useState('')
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null)
  const [specs, setSpecs] = useState<ApiSpecEntry[]>([])
  const [exposed, setExposed] = useState<string[]>([])
  const [ingestActive, setIngestActive] = useState(false)

  // LLM 配置 form:从 /api/config/status 回填,保存时 POST /api/config/llm
  const [apiInput, setApiInput] = useState('openai-completions')
  const [baseUrlInput, setBaseUrlInput] = useState('')
  const [modelInput, setModelInput] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [newVaultName, setNewVaultName] = useState('')
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
      const vdata = (await vaultsRes.json()) as { vaults: VaultEntry[]; currentVault: string }
      setVaults(vdata.vaults ?? [])
      setCurrentVault(vdata.currentVault ?? '')
      const status = (await statusRes.json()) as ConfigStatus
      setConfigStatus(status)
      setBaseUrlInput(status.baseUrl || '')
      setModelInput(status.model || '')
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
          apiKey: apiKeyInput,
        }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setError(data.error ?? `HTTP ${res.status}`)
      } else {
        setNotice('配置已重载,可继续对话')
        setApiKeyInput('')
        void load()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
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

  const createVault = async () => {
    const trimmed = newVaultName.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/vault', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setError(data.error ?? `HTTP ${res.status}`)
      } else {
        setNotice(`已新建知识库"${trimmed}",点击列表中的"切换"以打开`)
        setNewVaultName('')
        void load()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // 保存按钮:apiKey/baseUrl/model 任一空则禁用(Q4.1d:UI 提前拦)
  const canSaveLlm = saving || !apiKeyInput.trim() || !baseUrlInput.trim() || !modelInput.trim()

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
          <p className="settings-hint">
            {configStatus?.hasApiKey
              ? '当前已配置 API key(出于安全不回显明文,每次保存需重新填入)。'
              : '尚未配置 API key,请填入以下字段后保存。'}
          </p>

          {/* api 规范 dropdown + tooltip */}
          <div className="settings-row">
            <label className="settings-label" htmlFor="llm-api">
              API 规范
            </label>
            <select
              id="llm-api"
              className="settings-input"
              value={apiInput}
              onChange={(e) => setApiInput(e.target.value)}
            >
              {specs
                .filter((s) => exposed.includes(s.id))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
            </select>
            <span
              className="settings-tooltip"
              role="img"
              aria-label="仅展示常用规范。需用 bedrock/google-vertex 等?编辑 config.json 的 exposedApiSpecs 字段,可选值见 pi KnownApi。"
              title="仅展示常用规范。需用 bedrock/google-vertex 等?编辑 config.json 的 exposedApiSpecs 字段,可选值见 pi KnownApi。"
            >
              ⓘ
            </span>
          </div>

          <div className="settings-row">
            <input
              className="settings-input"
              type="text"
              placeholder="baseUrl(如 https://api.openai.com/v1,无需 /chat/completions)"
              value={baseUrlInput}
              onChange={(e) => setBaseUrlInput(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="settings-row">
            <input
              className="settings-input"
              type="text"
              placeholder="model(如 gpt-4o)"
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="settings-row">
            <input
              className="settings-input"
              type="password"
              placeholder="apiKey"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              autoComplete="off"
            />
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
                  <button
                    type="button"
                    className="settings-btn"
                    onClick={() => void switchVault(v.path)}
                    disabled={isCurrent || ingestActive || busy}
                  >
                    切换
                  </button>
                </li>
              )
            })}
            {vaults.length === 0 && <li className="vault-empty">暂无已登记的知识库</li>}
          </ul>

          {/* ── 新建 Vault ── */}
          <div className="settings-row new-vault">
            <input
              className="settings-input"
              type="text"
              placeholder="新知识库名称(如:工作)"
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
          <p className="settings-hint">
            新建的知识库从样板复制结构,不会自动切换;点击列表"切换"以打开。
          </p>
        </section>
      </div>
    </div>
  )
}
