'use client'
import { useEffect, useRef, useState } from 'react'
import { showToast } from '@/components/Toast'
import type { UploadRow, UploadSession } from '@/lib/upload-sessions'

type RowStatus = UploadRow['status']

const STATUS_LABEL: Record<RowStatus, string> = {
  pending: 'Pending',
  stage1:  '⏳ Stage 1',
  stage2:  '⏳ Stage 2',
  done:    '✓ Done',
  error:   '✗ Error',
}
const STATUS_STYLE: Record<RowStatus, string> = {
  pending: 'bg-slate-100 text-slate-400',
  stage1:  'bg-violet-50 text-violet-700',
  stage2:  'bg-blue-50 text-blue-700',
  done:    'bg-green-100 text-green-700',
  error:   'bg-red-50 text-red-600',
}

export default function UploadCard({
  sessionId,
  row,
  selected,
  onToggleSelect,
  onLightbox,
}: {
  sessionId: string
  row: UploadRow
  selected: boolean
  onToggleSelect: (imgFile: string) => void
  onLightbox: (src: string, value: string) => void
}) {
  const [imageFile,  setImageFile]  = useState(row.image_file)
  const [status,     setStatus]     = useState<RowStatus>(row.status)
  const [prompt,     setPrompt]     = useState(row.prompt)
  const [extra,      setExtra]      = useState('')
  const [edited,     setEdited]     = useState(false)
  const [errMsg,     setErrMsg]     = useState(row.error)
  const [s1Loading,  setS1Loading]  = useState(false)
  const [remaking,   setRemaking]   = useState(false)
  const [imgVersion, setImgVersion] = useState(Date.now())
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sync incoming prop changes (from parent's batch poll) when card is idle
  useEffect(() => {
    if (edited || remaking || s1Loading) return
    if (row.image_file && row.image_file !== imageFile) setImgVersion(Date.now())
    setImageFile(row.image_file)
    setStatus(row.status)
    setPrompt(row.prompt)
    setErrMsg(row.error)
  }, [row.image_file, row.status, row.prompt, row.error, edited, remaking, s1Loading])

  async function handleRegenPrompt() {
    setS1Loading(true)
    try {
      const res  = await fetch(`/api/upload/regen-prompt/${sessionId}/${row.index}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extra_instructions: extra }),
      })
      const data = await res.json() as { prompt?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Stage 1 failed')
      setPrompt(data.prompt ?? '')
      setEdited(true)
      showToast(`Row ${row.index + 1} — prompt refreshed. Review then Remake Image.`)
    } catch (e: unknown) {
      showToast(`Stage 1 failed: ${e instanceof Error ? e.message : String(e)}`, true)
    } finally {
      setS1Loading(false)
    }
  }

  async function handleSavePrompt() {
    const res = await fetch(`/api/upload/save-prompt/${sessionId}/${row.index}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    })
    if (res.ok) { setEdited(false); showToast('Prompt saved') }
    else        showToast('Save failed', true)
  }

  async function handleRemake() {
    if (!prompt.trim()) { showToast('Prompt is empty', true); return }
    setRemaking(true)
    setEdited(false)
    setErrMsg('')
    setStatus('stage2')

    const res = await fetch(`/api/upload/remake/${sessionId}/${row.index}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    })
    if (!res.ok) {
      const data = await res.json() as { error?: string }
      onError(data.error ?? 'Failed to start')
      return
    }

    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const s = await fetch(`/api/upload/status/${sessionId}`).then(r => r.json()) as UploadSession
      const live = s?.rows?.find(r2 => r2.index === row.index)
      if (!live) return
      if (live.status === 'done') {
        clearInterval(pollRef.current!)
        setImageFile(live.image_file)
        setImgVersion(Date.now())
        setStatus('done')
        setRemaking(false)
        showToast(`Row ${row.index + 1} generated`)
      } else if (live.status === 'error') {
        clearInterval(pollRef.current!)
        onError(live.error)
      }
    }, 2000)
  }

  function onError(msg: string) {
    setRemaking(false)
    setStatus('error')
    setErrMsg(msg)
    const preview = msg ? msg.slice(0, 80) : 'unknown error'
    showToast(`Row ${row.index + 1} failed — ${preview}`, true)
  }

  const imgSrc        = imageFile ? `/api/upload/images/${sessionId}/${imageFile}?v=${imgVersion}` : null
  const isActive      = status === 'stage1' || status === 'stage2'
  // Re-generate (Stage 1) is only blocked when a user-triggered action is in flight,
  // OR when the batch is already running Stage 1 for this row (redundant).
  // It stays enabled during batch Stage 2 so the user can prepare a new prompt.
  const regen1Busy    = s1Loading || remaking || status === 'stage1'
  // Save and Remake are blocked any time something is actively running for this row.
  const saveRemakeBusy = s1Loading || remaking || isActive

  return (
    <div
      className={`bg-white rounded-xl border-2 overflow-hidden flex flex-col transition-all
        ${imageFile ? 'cursor-pointer' : 'cursor-default'}
        ${selected ? 'border-violet-500 shadow-lg shadow-violet-200' : 'border-slate-200 hover:border-slate-300'}`}
      onClick={() => imageFile && onToggleSelect(imageFile)}
    >
      {/* Image zone */}
      <div className="w-full aspect-[4/3] bg-slate-50 relative overflow-hidden border-b border-slate-100
                      flex items-center justify-center">
        {imgSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imgSrc}
            alt={row.value}
            loading="lazy"
            className="w-full h-full object-contain"
            style={{ cursor: 'zoom-in' }}
            onClick={e => { e.stopPropagation(); onLightbox(imgSrc, row.value) }}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-300 text-xs">
            {isActive || remaking ? (
              <div className="w-8 h-8 rounded-full border-[3px] border-slate-200 border-t-violet-500"
                   style={{ animation: 'spin .75s linear infinite' }} />
            ) : (
              <svg className="w-9 h-9 stroke-slate-300" viewBox="0 0 24 24" fill="none"
                   strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
              </svg>
            )}
          </div>
        )}

        {/* Generating overlay over existing image */}
        {remaking && imgSrc && (
          <div className="absolute inset-0 bg-slate-50/[.9] flex flex-col items-center justify-center gap-3"
               style={{ backdropFilter: 'blur(2px)' }}>
            <div className="w-9 h-9 rounded-full border-[3px] border-slate-200 border-t-blue-500"
                 style={{ animation: 'spin .75s linear infinite' }} />
            <span className="text-xs text-slate-500 font-medium">Generating…</span>
          </div>
        )}

        {/* Checkbox */}
        {imageFile && (
          <div className={`absolute top-2 left-2 w-5 h-5 rounded-md border-2 flex items-center justify-center
            transition-all pointer-events-none
            ${selected ? 'bg-violet-600 border-violet-600' : 'bg-white/90 border-slate-300'}`}>
            {selected && (
              <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        )}
      </div>

      {/* Card body — stop propagation so clicks inside don't toggle selection */}
      <div className="p-3.5 flex flex-col gap-2.5 flex-1" onClick={e => e.stopPropagation()}>
        {/* Meta */}
        <div className="flex items-center gap-1.5">
          <span className="px-2 py-0.5 rounded text-[.7rem] font-bold bg-[#0f172a] text-slate-50">
            #{row.index + 1}
          </span>
          <span className={`ml-auto px-2 py-0.5 rounded text-[.7rem] font-bold ${STATUS_STYLE[status]}`}>
            {STATUS_LABEL[status]}
          </span>
        </div>

        {/* Value / topic */}
        <p className="text-[.76rem] text-slate-600 leading-snug line-clamp-3">
          {row.value}
        </p>

        {/* Stage 1 */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 flex flex-col gap-2">
          <span className="text-[.68rem] font-bold text-violet-700 uppercase tracking-wide flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-700 inline-block" />
            Stage 1 — Gemini Prompt Generator
          </span>
          <textarea
            value={extra}
            onChange={e => setExtra(e.target.value)}
            rows={2}
            placeholder="Extra instructions (optional) — e.g. make a map, use bar chart…"
            className="w-full text-[.76rem] text-slate-700 bg-white border border-slate-200
                       rounded-md px-2.5 py-1.5 resize-y leading-relaxed
                       placeholder:text-slate-400 placeholder:italic
                       focus:outline-none focus:border-violet-500"
          />
          <button
            onClick={handleRegenPrompt}
            disabled={regen1Busy}
            className="w-full py-1.5 bg-violet-700 text-white border-none rounded-md text-xs
                       font-semibold cursor-pointer flex items-center justify-center gap-1.5
                       hover:bg-violet-800 disabled:bg-violet-400 disabled:cursor-not-allowed"
          >
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
              Stage 2 — Image Prompt
            </span>
            {edited && <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />}
          </div>
          <textarea
            value={prompt}
            onChange={e => { setPrompt(e.target.value); setEdited(true) }}
            rows={5}
            className={`w-full text-[.77rem] text-slate-700 border rounded-md px-2.5 py-2
                        resize-y leading-relaxed focus:outline-none transition-colors
                        ${edited
                          ? 'border-amber-400 bg-amber-50 focus:border-amber-500'
                          : 'border-slate-200 bg-slate-50 focus:border-blue-500 focus:bg-white'}`}
          />
        </div>

        {/* Error */}
        {errMsg && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5 leading-snug">
            {errMsg.slice(0, 200)}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-1.5 mt-auto">
          <button
            onClick={handleSavePrompt}
            disabled={saveRemakeBusy}
            className="flex-1 py-1.5 px-3 rounded-md text-xs font-semibold cursor-pointer
                       bg-slate-50 border border-slate-200 text-slate-500
                       hover:bg-slate-100 hover:border-slate-300
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save Prompt
          </button>
          <button
            onClick={handleRemake}
            disabled={saveRemakeBusy}
            className="flex-[2] py-1.5 px-3 rounded-md text-xs font-semibold cursor-pointer
                       bg-blue-500 text-white border-none
                       hover:bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed"
          >
            {remaking ? 'Generating…' : 'Remake Image'}
          </button>
        </div>

      </div>
    </div>
  )
}
