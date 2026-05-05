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

type Phase = 'idle' | 's1_loading' | 's1_done' | 's2_loading' | 'done'

export default function QuickGenerateClient() {
  const [desc,        setDesc]        = useState('')
  const [diagType,    setDiagType]    = useState('')
  const [phase,       setPhase]       = useState<Phase>('idle')
  const [curPrompt,   setCurPrompt]   = useState('')
  const [promptEdited, setPromptEdited] = useState(false)
  const [curFile,     setCurFile]     = useState<string | null>(null)
  const [errMsg,      setErrMsg]      = useState('')
  const [bucketAdded, setBucketAdded] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function reset() {
    setDesc(''); setDiagType(''); setPhase('idle')
    setCurPrompt(''); setPromptEdited(false)
    setCurFile(null); setErrMsg(''); setBucketAdded(false)
    if (pollRef.current) clearInterval(pollRef.current)
  }

  // Step 1 — run Stage 1, get prompt
  async function generatePrompt() {
    if (!desc.trim()) return
    setPhase('s1_loading')
    setErrMsg('')
    setCurPrompt('')
    setPromptEdited(false)
    setCurFile(null)

    try {
      const res  = await fetch('/api/quick-stage1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc, diagram_type: diagType }),
      })
      const data = await res.json() as { prompt?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Stage 1 failed')
      setCurPrompt(data.prompt ?? '')
      setPhase('s1_done')
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e))
      setPhase('idle')
    }
  }

  // Step 2 — run Stage 2 with current prompt
  async function generateImage() {
    if (!curPrompt.trim()) return
    setPhase('s2_loading')
    setErrMsg('')
    setBucketAdded(false)

    const res  = await fetch('/api/quick-regen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nb_prompt: curPrompt }),
    })
    const { job_id, error } = await res.json() as { job_id?: string; error?: string }
    if (!res.ok) {
      setErrMsg(error ?? 'Failed to start')
      setPhase('s1_done')
      return
    }

    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const s = await fetch(`/api/quick-status/${job_id}`).then(r => r.json()) as QuickJobStatus
      if (s.status === 'done') {
        clearInterval(pollRef.current!)
        setCurFile(s.image_file ?? null)
        setPromptEdited(false)
        setPhase('done')
      } else if (s.status === 'error') {
        clearInterval(pollRef.current!)
        setErrMsg(s.error ?? 'Generation failed')
        setPhase('s1_done')
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
    else        showToast('Failed to add to bucket', true)
  }

  const imgSrc  = curFile ? `/api/quick-images/${curFile}?v=${Date.now()}` : null
  const isIdle  = phase === 'idle'
  const isS1    = phase === 's1_loading'
  const isS2    = phase === 's2_loading'
  const hasProm = phase === 's1_done' || phase === 's2_loading' || phase === 'done'
  const hasImg  = phase === 's2_loading' || phase === 'done'

  return (
    <div className="grid min-h-[calc(100vh-52px)]" style={{ gridTemplateColumns: '400px 1fr' }}>

      {/* ── Left panel ── */}
      <div className="bg-white border-r border-slate-200 p-7 flex flex-col gap-5 overflow-y-auto">
        <div>
          <h2 className="text-[1.15rem] font-black text-[#0f172a] mb-1">Quick Generate Diagram</h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            Describe your topic → review the AI-crafted prompt → generate the image.
          </p>
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Describe what you want</label>
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            rows={4}
            disabled={!isIdle}
            placeholder={"e.g. The water cycle showing evaporation…\ne.g. India's demographic dividend…"}
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-[inherit]
                       text-slate-800 leading-relaxed resize-y focus:outline-none focus:border-violet-500
                       disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
          />
        </div>

        {/* Diagram type */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">
            Diagram Type <span className="font-normal normal-case tracking-normal">(optional)</span>
          </label>
          <select
            value={diagType}
            onChange={e => setDiagType(e.target.value)}
            disabled={!isIdle}
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-[inherit]
                       text-slate-800 bg-white focus:outline-none focus:border-violet-500 cursor-pointer
                       disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
          >
            <option value="">Any — let AI decide</option>
            {DIAGRAM_TYPES.map(({ group, options }) => (
              <optgroup key={group} label={group}>
                {options.map(o => <option key={o} value={o}>{o}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Step 1 button */}
        {(isIdle || isS1) && (
          <button
            onClick={generatePrompt}
            disabled={isS1 || !desc.trim()}
            className="w-full py-3 bg-violet-700 text-white border-none rounded-xl text-[.95rem]
                       font-black cursor-pointer flex items-center justify-center gap-2
                       hover:bg-violet-800 disabled:bg-violet-400 disabled:cursor-not-allowed"
          >
            {isS1 ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white"
                      style={{ animation: 'spin .75s linear infinite' }} />
                Crafting prompt…
              </>
            ) : '⚡ Generate Prompt'}
          </button>
        )}

        {isS1 && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs text-slate-500 flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full border-2 border-violet-600/30 border-t-violet-600 shrink-0"
                  style={{ animation: 'spin .75s linear infinite' }} />
            Stage 1 — Gemini is crafting your image prompt…
          </div>
        )}

        {/* Generated prompt — editable before Stage 2 */}
        {hasProm && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                Stage 1 Output — Image Prompt
              </label>
              {promptEdited && (
                <span className="text-[.68rem] text-amber-600 font-semibold">edited</span>
              )}
            </div>
            <p className="text-[.72rem] text-slate-400 -mt-0.5">
              Review and edit freely before generating the image.
            </p>
            <textarea
              value={curPrompt}
              onChange={e => { setCurPrompt(e.target.value); setPromptEdited(true) }}
              rows={8}
              className={`border rounded-lg px-3 py-2.5 text-xs font-[inherit] leading-relaxed
                          resize-y focus:outline-none transition-colors
                          ${promptEdited
                            ? 'border-amber-400 bg-amber-50 text-slate-700 focus:border-amber-500'
                            : 'border-slate-200 bg-slate-50 text-slate-600 focus:border-violet-500 focus:bg-white'}`}
            />
          </div>
        )}

        {/* Step 2 button */}
        {hasProm && (
          <button
            onClick={generateImage}
            disabled={isS2 || !curPrompt.trim()}
            className="w-full py-3 bg-blue-600 text-white border-none rounded-xl text-[.95rem]
                       font-black cursor-pointer flex items-center justify-center gap-2
                       hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
          >
            {isS2 ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white"
                      style={{ animation: 'spin .75s linear infinite' }} />
                Generating image…
              </>
            ) : phase === 'done' ? '↺ Regenerate Image' : '⚡ Generate Image'}
          </button>
        )}

        {isS2 && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs text-slate-500 flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full border-2 border-blue-600/30 border-t-blue-600 shrink-0"
                  style={{ animation: 'spin .75s linear infinite' }} />
            Stage 2 — Generating your diagram…
          </div>
        )}

        {/* Error */}
        {errMsg && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-600 leading-relaxed">
            {errMsg}
          </div>
        )}

        {/* Start over */}
        {!isIdle && !isS1 && (
          <button
            onClick={reset}
            className="text-xs text-slate-400 hover:text-slate-600 bg-transparent border-none
                       cursor-pointer text-left font-medium"
          >
            ← Start over
          </button>
        )}
      </div>

      {/* ── Right panel ── */}
      <div className="bg-slate-100 flex flex-col items-center justify-center p-8 gap-5">
        {!hasImg ? (
          <div className="flex flex-col items-center gap-4 text-slate-400 text-center">
            <svg className="w-20 h-20 stroke-slate-300" viewBox="0 0 24 24" fill="none" strokeWidth="1"
                 strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <path d="M21 15l-5-5L5 21"/>
            </svg>
            <p className="text-sm max-w-xs leading-relaxed">
              {hasProm
                ? 'Prompt ready — click "Generate Image" to create your diagram.'
                : 'Your diagram will appear here once generated.'}
            </p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden w-full"
               style={{ boxShadow: '0 4px 20px rgba(0,0,0,.08)' }}>
            <div className="relative w-full aspect-[4/3] overflow-hidden bg-slate-50">
              {imgSrc && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imgSrc}
                  alt="Generated diagram"
                  className="w-full h-full object-contain block cursor-zoom-in"
                  onClick={() => imgSrc && lbOpen(imgSrc, 'Quick Generated', curFile!, 'quick')}
                />
              )}
              {isS2 && (
                <div className="absolute inset-0 bg-slate-50/[.88] flex flex-col items-center justify-center gap-2.5"
                     style={{ backdropFilter: 'blur(3px)' }}>
                  <div className="w-9 h-9 rounded-full border-[3px] border-blue-200 border-t-blue-600"
                       style={{ animation: 'spin .75s linear infinite' }} />
                  <span className="text-xs text-blue-700 font-semibold">Generating image…</span>
                </div>
              )}
            </div>

            {phase === 'done' && curFile && (
              <div className="p-4 flex gap-2">
                <button
                  onClick={addToBucket}
                  disabled={bucketAdded}
                  className={`flex-1 py-2.5 rounded-lg text-xs font-bold cursor-pointer border-none
                    ${bucketAdded ? 'bg-green-500 text-white cursor-default' : 'bg-violet-700 text-white hover:bg-violet-800'}`}
                >
                  {bucketAdded ? '✓ In Bucket' : '+ Add to Bucket'}
                </button>
                <a
                  href={imgSrc ?? '#'}
                  download={curFile}
                  className="flex-1 py-2.5 rounded-lg text-xs font-bold bg-blue-500 text-white
                             flex items-center justify-center no-underline hover:bg-blue-600"
                >
                  ⬇ Download
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
