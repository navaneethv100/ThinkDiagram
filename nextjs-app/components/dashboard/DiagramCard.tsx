'use client'
import { useRef, useState } from 'react'
import { lbOpen } from '@/components/Lightbox'
import { showToast } from '@/components/Toast'
import type { DiagramCard as DiagramCardType } from '@/lib/types'

type Badge = 'done' | 'missing' | 'generating' | 'error'

const BADGE_STYLE: Record<Badge, string> = {
  done:       'bg-green-100 text-green-700',
  missing:    'bg-red-50 text-red-600',
  generating: 'bg-blue-50 text-blue-700',
  error:      'bg-orange-50 text-orange-700',
}
const BADGE_LABEL: Record<Badge, string> = {
  done: '✓ Done', missing: 'Missing', generating: '⏳ Generating', error: '✗ Error',
}

export default function DiagramCard({ d }: { d: DiagramCardType }) {
  const [imageFile,  setImageFile]  = useState(d.image_file)
  const [prompt,     setPrompt]     = useState(d.prompt)
  const [extra,      setExtra]      = useState(d.extra_instructions)
  const [edited,     setEdited]     = useState(false)
  const [badge,      setBadge]      = useState<Badge>(d.image_file ? 'done' : 'missing')
  const [remaking,   setRemaking]   = useState(false)
  const [s1Loading,  setS1Loading]  = useState(false)
  const [errMsg,     setErrMsg]     = useState('')
  const [qExpanded,  setQExpanded]  = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function handleRegenPrompt() {
    setS1Loading(true)
    try {
      const res  = await fetch(`/api/regen-prompt/${d.sl_no}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extra_instructions: extra }),
      })
      const data = await res.json() as { prompt?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setPrompt(data.prompt ?? '')
      setEdited(true)
      showToast(`SL ${d.sl_no} — prompt refreshed. Review then Remake Image.`)
    } catch (e: unknown) {
      showToast(`Stage 1 failed: ${e instanceof Error ? e.message : String(e)}`, true)
    } finally {
      setS1Loading(false)
    }
  }

  async function handleSavePrompt() {
    const res = await fetch(`/api/save-prompt/${d.sl_no}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, extra_instructions: extra }),
    })
    if (res.ok) { setEdited(false); showToast('Prompt saved') }
    else        showToast('Save failed', true)
  }

  async function handleRemake() {
    if (!prompt.trim()) { showToast('Prompt is empty', true); return }
    setRemaking(true); setEdited(false); setErrMsg(''); setBadge('generating')

    const res  = await fetch(`/api/remake/${d.sl_no}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    })
    if (!res.ok) {
      const data = await res.json() as { error?: string }
      onError(data.error ?? 'Failed'); return
    }

    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const s = await fetch(`/api/status/${d.sl_no}`).then(r => r.json()) as { status: string }
      if (s.status === 'done') {
        clearInterval(pollRef.current!)
        await onDone()
      } else if (s.status.startsWith('error')) {
        clearInterval(pollRef.current!)
        onError(s.status.replace(/^error:?\s*/i, ''))
      }
    }, 2000)
  }

  async function onDone() {
    const all  = await fetch('/api/diagrams').then(r => r.json()) as DiagramCardType[]
    const fresh = all.find(x => x.sl_no === d.sl_no)
    if (fresh?.image_file) setImageFile(fresh.image_file)
    setRemaking(false); setBadge('done')
    showToast(`SL ${d.sl_no} generated`)
  }

  function onError(msg: string) {
    setRemaking(false); setBadge('error'); setErrMsg(msg)
    showToast(`SL ${d.sl_no} failed`, true)
  }

  const imgSrc = imageFile ? `/api/images/${imageFile}?t=${Date.now()}` : null

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col
                    transition-shadow hover:shadow-lg hover:shadow-black/[.09]">
      {/* Image zone */}
      <div className="w-full aspect-[4/3] bg-slate-50 relative overflow-hidden border-b border-slate-100
                      flex items-center justify-center">
        {imgSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imgSrc} alt={`SL ${d.sl_no}`} loading="lazy"
               className="w-full h-full object-contain cursor-zoom-in"
               onClick={() => lbOpen(imgSrc, `SL ${d.sl_no} — ${d.diagram_name}`, imageFile!, 'diagram')} />
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-300 text-xs">
            <svg className="w-10 h-10 stroke-slate-300" viewBox="0 0 24 24" fill="none" strokeWidth="1.5"
                 strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            No image
          </div>
        )}
        {/* Generating overlay */}
        {remaking && (
          <div className="absolute inset-0 bg-slate-50/[.9] flex flex-col items-center justify-center gap-3"
               style={{ backdropFilter: 'blur(2px)' }}>
            <div className="w-9 h-9 rounded-full border-[3px] border-slate-200 border-t-blue-500"
                 style={{ animation: 'spin .75s linear infinite' }} />
            <span className="text-xs text-slate-500 font-medium">Generating…</span>
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="p-3.5 flex flex-col gap-2.5 flex-1">
        {/* Meta row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="px-2 py-0.5 rounded text-[.7rem] font-bold bg-[#0f172a] text-slate-50">
            SL {d.sl_no}
          </span>
          <span className="px-2 py-0.5 rounded text-[.7rem] font-bold bg-slate-100 text-slate-500">
            {d.year}
          </span>
          <span className={`ml-auto px-2 py-0.5 rounded text-[.7rem] font-bold ${BADGE_STYLE[badge]}`}>
            {BADGE_LABEL[badge]}
          </span>
        </div>

        {/* Diagram name */}
        <div className="text-[.8rem] font-semibold text-slate-600 leading-snug">
          {d.diagram_name || '—'}
        </div>

        {/* Question */}
        <div>
          <p className={`text-[.76rem] text-slate-500 leading-relaxed overflow-hidden
            ${qExpanded ? '' : 'line-clamp-3'}`}>
            {d.question}
          </p>
          <button onClick={() => setQExpanded(e => !e)}
                  className="text-[.7rem] text-blue-500 bg-transparent border-none p-0 cursor-pointer
                             font-medium hover:underline mt-0.5">
            {qExpanded ? 'Show less' : 'Show more'}
          </button>
        </div>

        {/* Stage 1 box */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 flex flex-col gap-2">
          <span className="text-[.68rem] font-bold text-violet-700 uppercase tracking-wide flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-700 inline-block" />
            Stage 1 — Gemini Prompt Generator
          </span>
          <textarea value={extra} onChange={e => setExtra(e.target.value)} rows={2}
                    placeholder="Extra instructions (optional) — e.g. make a map, use bar chart…"
                    className="w-full text-[.76rem] text-slate-700 bg-white border border-slate-200
                               rounded-md px-2.5 py-1.5 resize-y leading-relaxed
                               placeholder:text-slate-400 placeholder:italic
                               focus:outline-none focus:border-violet-500" />
          <button onClick={handleRegenPrompt} disabled={s1Loading}
                  className="w-full py-1.5 bg-violet-700 text-white border-none rounded-md text-xs
                             font-semibold cursor-pointer flex items-center justify-center gap-1.5
                             hover:bg-violet-800 disabled:bg-violet-400 disabled:cursor-not-allowed">
            {s1Loading && (
              <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white inline-block"
                    style={{ animation: 'spin .75s linear infinite' }} />
            )}
            ↺ Re-generate Stage 2 Prompt via Gemini
          </button>
        </div>

        <hr className="border-dashed border-slate-200" />

        {/* Stage 2 prompt */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[.68rem] font-bold text-slate-400 uppercase tracking-wide">
              Stage 2 — Nano Banana Prompt
            </span>
            {edited && <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />}
          </div>
          <textarea value={prompt} onChange={e => { setPrompt(e.target.value); setEdited(true) }} rows={5}
                    className={`w-full text-[.77rem] text-slate-700 border rounded-md px-2.5 py-2
                                resize-y leading-relaxed focus:outline-none transition-colors
                                ${edited
                                  ? 'border-amber-400 bg-amber-50 focus:border-amber-500'
                                  : 'border-slate-200 bg-slate-50 focus:border-blue-500 focus:bg-white'}`} />
        </div>

        {/* Error */}
        {errMsg && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5 leading-snug">
            {errMsg}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-1.5 mt-auto">
          <button onClick={handleSavePrompt}
                  className="flex-1 py-1.5 px-3 rounded-md text-xs font-semibold cursor-pointer
                             bg-slate-50 border border-slate-200 text-slate-500
                             hover:bg-slate-100 hover:border-slate-300">
            Save Prompt
          </button>
          <button onClick={handleRemake} disabled={remaking}
                  className="flex-[2] py-1.5 px-3 rounded-md text-xs font-semibold cursor-pointer
                             bg-blue-500 text-white border-none
                             hover:bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed">
            {remaking ? 'Generating…' : 'Remake Image'}
          </button>
        </div>
      </div>
    </div>
  )
}
