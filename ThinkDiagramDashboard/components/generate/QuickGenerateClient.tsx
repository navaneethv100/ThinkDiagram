'use client'
import { useState, useRef } from 'react'
import { lbOpen } from '@/components/Lightbox'
import { showToast } from '@/components/Toast'
import type { QuickJobStatus } from '@/lib/types'

const DIAGRAM_TYPES = [
  { group: 'Maps',                  options: ['India Map', 'World Map'] },
  { group: 'Thematic',              options: ['Thematic Diagram'] },
  { group: 'Flow & Process',        options: ['Flowchart', 'Cycle / Loop Diagram', 'Timeline / Chronology'] },
  { group: 'Hierarchy & Structure', options: ['Pyramid / Hierarchy', 'Hub and Spoke', 'Org Chart / Tree'] },
  { group: 'Comparison & Analysis', options: ['Venn Diagram', 'Comparison Table', 'Framework / Matrix'] },
  { group: 'Science & Data',        options: ['Ray Diagram', 'Cross-Section Diagram', 'Bar / Data Chart', 'Funnel Diagram'] },
]

export default function QuickGenerateClient() {
  const [desc,        setDesc]        = useState('')
  const [diagType,    setDiagType]    = useState('')
  const [loading,     setLoading]     = useState(false)
  const [step,        setStep]        = useState<0 | 1 | 2>(0)  // 0=idle 1=stage1 2=stage2
  const [step1Done,   setStep1Done]   = useState(false)
  const [step2Done,   setStep2Done]   = useState(false)
  const [errMsg,      setErrMsg]      = useState('')
  const [curFile,     setCurFile]     = useState<string | null>(null)
  const [curPrompt,   setCurPrompt]   = useState('')
  const [bucketAdded, setBucketAdded] = useState(false)
  const [regenLoading, setRegenLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function reset() {
    setDesc(''); setDiagType(''); setLoading(false); setStep(0)
    setStep1Done(false); setStep2Done(false); setErrMsg('')
    setCurFile(null); setCurPrompt(''); setBucketAdded(false)
    if (pollRef.current) clearInterval(pollRef.current)
  }

  async function generate() {
    if (!desc.trim()) return
    setLoading(true); setErrMsg(''); setStep(1); setStep1Done(false); setStep2Done(false); setCurFile(null)

    const res     = await fetch('/api/quick-generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: desc, diagram_type: diagType }),
    })
    const { job_id, error } = await res.json() as { job_id?: string; error?: string }
    if (!res.ok) { showError(error ?? 'Failed to start'); return }

    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const s = await fetch(`/api/quick-status/${job_id}`).then(r => r.json()) as QuickJobStatus
      if (s.status === 'stage2') { setStep1Done(true); setStep(2) }
      else if (s.status === 'done') {
        clearInterval(pollRef.current!)
        setStep1Done(true); setStep2Done(true)
        setCurFile(s.image_file ?? null)
        setCurPrompt(s.stage1_prompt ?? '')
        setLoading(false)
      } else if (s.status === 'error') {
        clearInterval(pollRef.current!)
        showError(s.error ?? 'Generation failed')
      }
    }, 2000)
  }

  function showError(msg: string) {
    setErrMsg(msg); setLoading(false); setStep(0)
  }

  async function regenImage() {
    const p = curPrompt.trim()
    if (!p) return
    setRegenLoading(true); setBucketAdded(false)

    const res = await fetch('/api/quick-regen', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nb_prompt: p }),
    })
    const { job_id, error } = await res.json() as { job_id?: string; error?: string }
    if (!res.ok) { showToast(error ?? 'Failed', true); setRegenLoading(false); return }

    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const s = await fetch(`/api/quick-status/${job_id}`).then(r => r.json()) as QuickJobStatus
      if (s.status === 'done') {
        clearInterval(pollRef.current!)
        setCurFile(s.image_file ?? null)
        setRegenLoading(false)
      } else if (s.status === 'error') {
        clearInterval(pollRef.current!)
        showToast(s.error ?? 'Regeneration failed', true)
        setRegenLoading(false)
      }
    }, 2000)
  }

  async function addToBucket() {
    if (bucketAdded || !curFile) return
    const label = diagType ? `${diagType}: ${desc.slice(0, 60)}` : desc.slice(0, 70)
    const res   = await fetch('/api/bucket/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: curFile, source: 'quick', label, description: desc }),
    })
    if (res.ok) { setBucketAdded(true); showToast('Added to bucket') }
    else        showToast('Failed', true)
  }

  const imgSrc = curFile ? `/api/quick-images/${curFile}?t=${Date.now()}` : null

  return (
    <div className="grid min-h-[calc(100vh-52px)]"
         style={{ gridTemplateColumns: '380px 1fr' }}>

      {/* Left panel */}
      <div className="bg-white border-r border-slate-200 p-7 flex flex-col gap-4 overflow-y-auto">
        <div>
          <h2 className="text-[1.15rem] font-black text-[#0f172a] mb-1.5">Quick Generate Diagram</h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            Describe what you want — the AI runs Stage 1 (Gemini) to craft the perfect prompt,
            then Stage 2 (Nano Banana) to generate the image.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Describe what you want</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={4}
                    placeholder={"e.g. The water cycle showing evaporation…\ne.g. India's demographic dividend…"}
                    className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-[inherit]
                               text-slate-800 leading-relaxed resize-y focus:outline-none focus:border-violet-500" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">
            Diagram Type <span className="font-normal normal-case tracking-normal">(optional)</span>
          </label>
          <select value={diagType} onChange={e => setDiagType(e.target.value)}
                  className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-[inherit]
                             text-slate-800 bg-white focus:outline-none focus:border-violet-500 cursor-pointer">
            <option value="">Any — let AI decide</option>
            {DIAGRAM_TYPES.map(({ group, options }) => (
              <optgroup key={group} label={group}>
                {options.map(o => <option key={o} value={o}>{o}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        <button onClick={generate} disabled={loading || !desc.trim()}
                className="w-full py-3 bg-violet-700 text-white border-none rounded-xl text-[.95rem]
                           font-black cursor-pointer flex items-center justify-center gap-2
                           hover:bg-violet-800 disabled:bg-violet-400 disabled:cursor-not-allowed">
          {loading && (
            <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white"
                  style={{ animation: 'spin .75s linear infinite' }} />
          )}
          ⚡ {loading ? 'Generating…' : 'Generate Diagram'}
        </button>

        {/* Progress */}
        {loading && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex flex-col gap-2">
            {[
              { n: 1, label: 'Stage 1 — Gemini crafting image prompt…', done: step1Done, active: step === 1 },
              { n: 2, label: 'Stage 2 — Nano Banana generating image…', done: step2Done, active: step === 2 },
            ].map(({ n, label, done, active }) => (
              <div key={n} className={`flex items-center gap-2.5 text-xs
                ${done ? 'text-slate-600' : active ? 'text-slate-700 font-semibold' : 'text-slate-400'}`}>
                <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center
                                  text-xs font-bold shrink-0 transition-all
                  ${done   ? 'bg-green-500 border-green-500 text-white'
                  : active ? 'border-violet-600 text-violet-600' : 'border-slate-200 text-slate-400'}`}
                      style={active ? { animation: 'pulse-ring 1.2s ease-in-out infinite' } : {}}>
                  {done ? '✓' : n}
                </span>
                {label}
              </div>
            ))}
          </div>
        )}

        {errMsg && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-600 leading-relaxed">
            {errMsg}
          </div>
        )}
      </div>

      {/* Right panel */}
      <div className="bg-slate-100 flex flex-col items-center justify-center p-8 gap-5">
        {!curFile ? (
          <div className="flex flex-col items-center gap-4 text-slate-400 text-center">
            <svg className="w-20 h-20 stroke-slate-300" viewBox="0 0 24 24" fill="none" strokeWidth="1"
                 strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <path d="M21 15l-5-5L5 21"/>
            </svg>
            <p className="text-sm max-w-xs leading-relaxed">
              Your generated diagram will appear here. Fill in the form and click Generate.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden w-full max-w-2xl"
               style={{ boxShadow: '0 4px 20px rgba(0,0,0,.08)' }}>
            <div className="relative overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${imgSrc}`} alt="Generated diagram"
                   className="w-full block cursor-zoom-in"
                   onClick={() => imgSrc && lbOpen(imgSrc, 'Quick Generated', curFile!, 'quick')} />
              {regenLoading && (
                <div className="absolute inset-0 bg-slate-50/[.88] flex flex-col items-center justify-center gap-2.5"
                     style={{ backdropFilter: 'blur(3px)' }}>
                  <div className="w-9 h-9 rounded-full border-[3px] border-violet-200 border-t-violet-700"
                       style={{ animation: 'spin .75s linear infinite' }} />
                  <span className="text-xs text-violet-700 font-semibold">Regenerating image…</span>
                </div>
              )}
            </div>
            <div className="p-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <strong className="text-[.68rem] uppercase tracking-wide text-slate-400">
                  Stage 2 Prompt (from Gemini) — edit &amp; regenerate
                </strong>
                <textarea value={curPrompt} onChange={e => setCurPrompt(e.target.value)} rows={5}
                          className="w-full border border-slate-200 rounded-md px-3 py-2 text-xs
                                     font-[inherit] text-slate-500 leading-relaxed bg-slate-50 resize-y
                                     focus:outline-none focus:border-violet-500 focus:bg-white" />
              </div>
              <div className="flex gap-2">
                <button onClick={regenImage} disabled={regenLoading}
                        className="flex-none px-3 py-2.5 bg-slate-100 border border-slate-200 text-slate-500
                                   rounded-lg text-xs font-semibold cursor-pointer flex items-center gap-1
                                   hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed">
                  ↺ Regenerate
                </button>
                <button onClick={addToBucket} disabled={bucketAdded}
                        className={`flex-1 py-2.5 rounded-lg text-xs font-bold cursor-pointer border-none
                          ${bucketAdded
                            ? 'bg-green-500 text-white cursor-default'
                            : 'bg-violet-700 text-white hover:bg-violet-800'}`}>
                  {bucketAdded ? '✓ Added to Bucket' : '+ Add to Bucket'}
                </button>
                <a href={imgSrc ?? '#'} download={curFile ?? ''}
                   className="flex-1 py-2.5 rounded-lg text-xs font-bold bg-blue-500 text-white
                              flex items-center justify-center no-underline hover:bg-blue-600">
                  ⬇ Download
                </a>
                <button onClick={reset}
                        className="flex-none px-3 py-2.5 bg-slate-100 border border-slate-200 text-slate-500
                                   rounded-lg text-xs font-semibold cursor-pointer hover:bg-slate-200">
                  New
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
