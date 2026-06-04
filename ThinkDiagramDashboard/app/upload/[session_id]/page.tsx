'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { use } from 'react'
import type { UploadRow, UploadSession } from '@/lib/upload-sessions'
import UploadCard from '@/components/upload/UploadCard'

type Params = { session_id: string }

export default function UploadResultsPage({ params }: { params: Promise<Params> }) {
  const { session_id } = use(params)

  const [session,     setSession]     = useState<UploadSession | null>(null)
  const [selected,    setSelected]    = useState<Set<string>>(new Set())
  const [downloading, setDownloading] = useState(false)
  const [lightbox,    setLightbox]    = useState<{ src: string; value: string } | null>(null)
  const [notFound,    setNotFound]    = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchSession = useCallback(async () => {
    const res = await fetch(`/api/upload/status/${session_id}`)
    if (res.status === 404) { setNotFound(true); return }
    const data = await res.json() as UploadSession
    setSession(data)
    const allFinished = data.rows.every(r => r.status === 'done' || r.status === 'error')
    if (allFinished && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [session_id])

  useEffect(() => {
    fetchSession()
    pollRef.current = setInterval(fetchSession, 2500)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchSession])

  function toggleSelect(imgFile: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(imgFile)) next.delete(imgFile)
      else next.add(imgFile)
      return next
    })
  }

  const updateRow = useCallback((updatedRow: UploadRow) => {
    setSession(prev => {
      if (!prev) return prev
      return {
        ...prev,
        rows: prev.rows.map(row => row.index === updatedRow.index ? updatedRow : row),
      }
    })
  }, [])

  function selectAll() {
    if (!session) return
    setSelected(new Set(session.rows.filter(r => r.status === 'done' && r.image_file).map(r => r.image_file)))
  }

  async function handleDownload() {
    if (!selected.size || downloading) return
    setDownloading(true)
    try {
      const res = await fetch(`/api/upload/download/${session_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames: Array.from(selected) }),
      })
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `diagrams_${session_id.slice(0, 8)}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* silent */ } finally {
      setDownloading(false)
    }
  }

  const doneCount  = session?.rows.filter(r => r.status === 'done').length ?? 0
  const totalCount = session?.rows.length ?? 0
  const allDone    = totalCount > 0 && session?.rows.every(r => r.status === 'done' || r.status === 'error')

  if (notFound) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-400 text-sm">Session not found.</p>
          <a href="/upload" className="text-violet-700 text-sm underline mt-2 inline-block">Start a new upload</a>
        </div>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-9 h-9 rounded-full border-[3px] border-slate-200 border-t-violet-600"
             style={{ animation: 'spin .75s linear infinite' }} />
      </main>
    )
  }

  return (
    <>
      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[500] bg-black/[.88] flex items-center justify-center p-4"
             style={{ backdropFilter: 'blur(4px)' }}
             onClick={() => setLightbox(null)}>
          <div className="relative w-full flex flex-col items-center" onClick={e => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.src}
              alt={lightbox.value}
              className="rounded-xl object-contain cursor-default"
              style={{
                maxWidth: 'min(95vw, 1400px)',
                maxHeight: '88vh',
                boxShadow: '0 24px 80px rgba(0,0,0,.7)',
              }}
            />
            <p className="text-white/60 text-xs mt-3 text-center max-w-2xl line-clamp-2 px-4">
              {lightbox.value}
            </p>
          </div>
          <button onClick={() => setLightbox(null)}
                  className="fixed top-4 right-5 text-white text-2xl opacity-70 hover:opacity-100
                             bg-transparent border-none cursor-pointer z-[501]">
            ✕
          </button>
        </div>
      )}

      <main className="min-h-screen bg-slate-50">
        {/* Top download bar — sticky below nav */}
        <div className="sticky top-[52px] z-[200] bg-[#0f172a] px-6 py-3 flex items-center gap-3 flex-wrap"
             style={{ boxShadow: '0 2px 8px rgba(0,0,0,.3)' }}>
          <span className="text-xs text-slate-400 mr-auto">
            {selected.size === 0 ? 'No images selected' : `${selected.size} of ${doneCount} selected`}
          </span>
          <button onClick={selectAll}
                  className="text-xs text-slate-300 hover:text-white bg-transparent border-none cursor-pointer font-medium">
            Select all done
          </button>
          <button onClick={() => setSelected(new Set())} disabled={selected.size === 0}
                  className="text-xs text-slate-400 hover:text-white bg-transparent border-none cursor-pointer
                             disabled:opacity-40 disabled:cursor-not-allowed font-medium">
            Clear
          </button>
          <button onClick={handleDownload} disabled={selected.size === 0 || downloading}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold bg-violet-600 text-white border-none
                             hover:bg-violet-500 disabled:bg-violet-900 disabled:text-violet-600
                             disabled:cursor-not-allowed cursor-pointer transition-colors flex items-center gap-1.5">
            {downloading && (
              <span className="w-3 h-3 rounded-full border-2 border-violet-400/40 border-t-violet-200 inline-block"
                    style={{ animation: 'spin .75s linear infinite' }} />
            )}
            ↓ Download Selected
          </button>
        </div>

        <div className="px-6 py-6">
          {/* Progress header */}
          <div className="max-w-7xl mx-auto mb-6">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h1 className="text-lg font-black text-slate-800 tracking-tight">
                  {session.original_filename}
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Column: <span className="font-semibold text-slate-600">{session.column}</span>
                  {' · '}
                  {doneCount} / {totalCount} done
                  {allDone && <span className="ml-1 text-green-600 font-semibold">· All finished</span>}
                </p>
              </div>
              <a href="/upload" className="text-xs text-violet-700 hover:underline font-semibold">+ New Upload</a>
            </div>
            <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-violet-600 rounded-full transition-all duration-500"
                   style={{ width: `${totalCount ? (doneCount / totalCount) * 100 : 0}%` }} />
            </div>
          </div>

          {/* Cards grid */}
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {session.rows.map(row => (
              <UploadCard
                key={row.index}
                sessionId={session_id}
                row={row}
                selected={row.image_file ? selected.has(row.image_file) : false}
                onToggleSelect={toggleSelect}
                onLightbox={(src, value) => setLightbox({ src, value })}
                onRowUpdate={updateRow}
              />
            ))}
          </div>
        </div>
      </main>
    </>
  )
}
