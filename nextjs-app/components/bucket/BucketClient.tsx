'use client'
import { useEffect, useState } from 'react'
import { lbOpen } from '@/components/Lightbox'
import { showToast } from '@/components/Toast'
import type { BucketItem } from '@/lib/types'

export default function BucketClient() {
  const [items, setItems] = useState<BucketItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    const data = await fetch('/api/bucket').then(r => r.json()) as BucketItem[]
    setItems(data); setLoading(false)
  }

  async function removeItem(id: string) {
    const res = await fetch(`/api/bucket/remove/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setItems(prev => prev.filter(i => i.id !== id))
    } else {
      showToast('Remove failed', true)
    }
  }

  if (loading) return <div className="text-center py-20 text-slate-400 text-sm">Loading…</div>

  return (
    <>
      <div className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center gap-3">
        <h2 className="text-base font-black text-[#0f172a] flex-1">📷 Bucket</h2>
        <span className="text-xs text-slate-500 font-medium">{items.length} item{items.length !== 1 ? 's' : ''}</span>
        <a href="/api/bucket/download-all"
           className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-bold
                      no-underline hover:bg-blue-600 flex items-center gap-1.5">
          ⬇ Download All as ZIP
        </a>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-20 text-center text-slate-400">
          <svg className="w-16 h-16 stroke-slate-200" viewBox="0 0 24 24" fill="none" strokeWidth="1.2"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <h3 className="text-sm font-semibold text-slate-300">Your bucket is empty</h3>
          <p className="text-xs leading-relaxed max-w-xs">
            Open any diagram on the{' '}
            <a href="/" className="text-violet-700 font-semibold no-underline hover:underline">Dashboard</a>{' '}
            or generate one in{' '}
            <a href="/generate" className="text-violet-700 font-semibold no-underline hover:underline">Quick Generate</a>.
          </p>
        </div>
      ) : (
        <div className="p-6 max-w-[1600px] mx-auto"
             style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '18px' }}>
          {items.map(item => {
            const src = item.source === 'quick'
              ? `/api/quick-images/${item.filename}`
              : `/api/images/${item.filename}`
            const date = new Date(item.added_at).toLocaleString('en-IN', {
              day: 'numeric', month: 'short', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })
            return (
              <div key={item.id}
                   className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col
                              shadow-sm transition-shadow hover:shadow-lg hover:shadow-black/[.1]">
                <div className="w-full aspect-[4/3] bg-slate-50 overflow-hidden border-b border-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={item.label} loading="lazy"
                       className="w-full h-full object-contain cursor-zoom-in"
                       onClick={() => lbOpen(src, item.label, item.filename, item.source)} />
                </div>
                <div className="p-3 flex flex-col gap-2 flex-1">
                  <div className="text-[.82rem] font-semibold text-slate-800 leading-snug">
                    {item.label || item.filename}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`px-2 py-0.5 rounded text-[.68rem] font-bold
                      ${item.source === 'quick' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>
                      {item.source === 'quick' ? 'Quick Gen' : 'Dashboard'}
                    </span>
                    <span className="text-[.72rem] text-slate-400">{date}</span>
                  </div>
                  <div className="flex gap-1.5 mt-auto">
                    <a href={src} download={item.filename}
                       className="flex-[2] py-2 bg-blue-500 text-white rounded-md text-xs font-semibold
                                  flex items-center justify-center gap-1 no-underline hover:bg-blue-600">
                      ⬇ Download
                    </a>
                    <button onClick={() => removeItem(item.id)}
                            className="flex-1 py-2 bg-red-50 text-red-600 border border-red-200 rounded-md
                                       text-xs font-semibold cursor-pointer hover:bg-red-100">
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
