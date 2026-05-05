'use client'
import { useEffect, useState } from 'react'
import { showToast } from './Toast'

interface LbMeta { src: string; label: string; filename: string; source: string }
const empty: LbMeta = { src: '', label: '', filename: '', source: '' }

let _lbOpen: (src: string, label: string, filename: string, source: string) => void = () => {}
export function lbOpen(src: string, label: string, filename: string, source: string) {
  _lbOpen(src, label, filename, source)
}

export default function Lightbox() {
  const [open, setOpen]   = useState(false)
  const [meta, setMeta]   = useState<LbMeta>(empty)
  const [added, setAdded] = useState(false)

  useEffect(() => {
    _lbOpen = (src, label, filename, source) => {
      setMeta({ src, label, filename, source })
      setAdded(false)
      setOpen(true)
      document.body.style.overflow = 'hidden'
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function close() {
    setOpen(false)
    document.body.style.overflow = ''
  }

  async function addToBucket() {
    if (added) return
    const res  = await fetch('/api/bucket/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: meta.filename, source: meta.source, label: meta.label }),
    })
    const data = await res.json() as { count?: number; error?: string }
    if (res.ok) {
      setAdded(true)
      showToast('Added to bucket')
    } else {
      showToast(data.error ?? 'Failed', true)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/[.85] z-[1000] flex items-center justify-center p-6"
         style={{ backdropFilter: 'blur(4px)' }} onClick={close}>
      <button className="fixed top-4 right-5 text-white text-2xl opacity-70 hover:opacity-100
                         bg-transparent border-none cursor-pointer z-[1001]"
              onClick={close}>✕</button>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={meta.src} alt={meta.label}
           className="max-w-[min(90vw,1024px)] max-h-[85vh] object-contain rounded-md cursor-default"
           style={{ boxShadow: '0 24px 80px rgba(0,0,0,.6)' }}
           onClick={e => e.stopPropagation()} />

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2.5 z-[1001]"
           onClick={e => e.stopPropagation()}>
        <span className="bg-white/[.12] text-white px-4 py-1.5 rounded-full text-xs font-medium pointer-events-none">
          {meta.label}
        </span>
        <a href={meta.src} download={meta.filename}
           className="px-4 py-2 rounded-lg text-xs font-bold bg-blue-500 text-white hover:bg-blue-600 no-underline">
          ⬇ Download
        </a>
        <button onClick={addToBucket}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors
                  ${added ? 'bg-green-500 text-white cursor-default' : 'bg-violet-700 text-white hover:bg-violet-800'}`}>
          {added ? '✓ Added' : '+ Add to Bucket'}
        </button>
      </div>
    </div>
  )
}
