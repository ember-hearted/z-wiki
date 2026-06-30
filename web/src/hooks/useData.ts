import { useState, useEffect } from 'react'

export interface TocItem {
  level: 'h2' | 'h3'
  text: string
}

export interface PageMeta {
  stem: string
  title: string
  summary: string
  updated: string
  toc: TocItem[]
  type: 'wiki' | 'output'
}

export function usePages() {
  const [pages, setPages] = useState<PageMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/pages.json')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(data => {
        setPages(data as PageMeta[])
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  return { pages, loading, error }
}

export function usePageContent(stem: string | undefined) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!stem) {
      setLoading(false)
      return
    }
    setLoading(true)
    fetch(`/pages/${stem}.html`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then(html => {
        setContent(html)
        setLoading(false)
      })
      .catch(() => {
        setContent(null)
        setLoading(false)
      })
  }, [stem])

  return { content, loading }
}
