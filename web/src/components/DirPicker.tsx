import { useCallback, useEffect, useState } from 'react'
import {
  buildDirUrl,
  type DirListing,
  decodeDir,
  filterHidden,
  sanitizeLocationInput,
} from './dirApi.js'

export interface DirPickerProps {
  open: boolean
  onClose: () => void
  onSelect: (parentPath: string) => void
}

/** 应用内目录树对话框(webui 浏览/新建本地目录,替代 window.desktop.selectVaultPath)。
 *  数据源于 GET /api/dir;新建走 POST /api/dir;选目录 = 父目录(喂 POST /api/vault {name,parentPath})。 */
export default function DirPicker({ open, onClose, onSelect }: DirPickerProps) {
  const [listing, setListing] = useState<DirListing | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [locationInput, setLocationInput] = useState('')

  const load = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(buildDirUrl(path))
      const json = (await res.json()) as unknown
      const d = decodeDir(json)
      if ('error' in d) setError(d.error)
      else setListing(d.listing)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setListing(null)
      setLocationInput('')
      void load('')
    }
  }, [open, load])

  if (!open) return null

  const entries = listing ? filterHidden(listing.entries, showHidden) : []

  const goTo = (p: string) => void load(p)

  // 跳到任意绝对路径(跨盘/任意目录):sanitizeLocationInput 校验后 load。空/含 .. 则忽略。
  const jumpTo = () => {
    const target = sanitizeLocationInput(locationInput)
    if (!target) {
      setError('路径无效(需绝对路径,不含 ..)')
      return
    }
    void load(target)
  }

  const create = async () => {
    if (!listing || !newName.trim()) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/dir', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: listing.path, name: newName.trim() }),
      })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string }
        setError(j.error ?? `HTTP ${res.status}`)
      } else {
        setNewName('')
        await load(listing.path)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="dirpicker-backdrop" onClick={onClose}>
      <div
        className="dirpicker"
        role="dialog"
        aria-modal="true"
        aria-label="选择知识库存放目录"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dirpicker-header">
          <h2 className="dirpicker-title">选择知识库存放目录</h2>
          <button type="button" className="settings-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {error && <div className="settings-error">{error}</div>}
        <div className="dirpicker-crumbs" role="navigation" aria-label="路径面包屑">
          {listing?.crumbs.map((c) => (
            <button
              key={c.path}
              type="button"
              className="dirpicker-crumb"
              onClick={() => goTo(c.path)}
            >
              {c.name}
            </button>
          ))}
          {listing && <span className="dirpicker-current">{listing.path}</span>}
        </div>
        <div className="dirpicker-location">
          <input
            className="settings-input"
            type="text"
            placeholder="输入绝对路径跳转,如 D:\ 或 \\server\share"
            value={locationInput}
            onChange={(e) => setLocationInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                jumpTo()
              }
            }}
            aria-label="路径跳转"
          />
          <button type="button" className="settings-btn" onClick={jumpTo}>
            跳转
          </button>
        </div>
        <div className="dirpicker-toolbar">
          <label className="settings-switch-label">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            显示隐藏
          </label>
          <span className="dirpicker-hint">选中的目录作为新建知识库的存放位置</span>
        </div>
        <ul className="dirpicker-list" role="listbox" aria-label="目录列表">
          {loading && <li className="dirpicker-empty">加载中…</li>}
          {!loading && entries.length === 0 && (
            <li className="dirpicker-empty">此目录下无子目录</li>
          )}
          {entries.map((e) => (
            <li key={e.path}>
              <button type="button" className="dirpicker-item" onClick={() => goTo(e.path)}>
                <span className="dirpicker-item-name">{e.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="dirpicker-new">
          <input
            className="settings-input"
            type="text"
            placeholder="新建文件夹名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            aria-label="新建文件夹名称"
          />
          <button
            type="button"
            className="settings-btn"
            onClick={() => void create()}
            disabled={creating || !newName.trim()}
          >
            {creating ? '创建中…' : '新建文件夹'}
          </button>
        </div>
        <div className="dirpicker-actions">
          <button type="button" className="settings-btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="settings-btn primary"
            onClick={() => {
              if (listing) {
                onSelect(listing.path)
                onClose()
              }
            }}
            disabled={!listing}
          >
            选择此目录
          </button>
        </div>
      </div>
    </div>
  )
}
